//! Owns the KataGo analysis process. The frontend (src/core/engine.ts) does all query bookkeeping;
//! this module only spawns the process, forwards stdin, and streams stdout/stderr lines back as events.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::paths;

#[derive(Default)]
pub struct EngineState {
    running: Mutex<Option<Running>>,
    generation: AtomicU64,
}

struct Running {
    child: Child,
    stdin: ChildStdin,
}

/// Subset of the `engine` config section the backend needs to build the command line.
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct EngineLaunch {
    pub katago: String,
    pub altcommand: String,
    pub model: String,
    pub humanlike_model: String,
    pub config: String,
}

impl Default for EngineLaunch {
    fn default() -> Self {
        Self {
            katago: String::new(),
            altcommand: String::new(),
            model: "katrain/models/b10c384h6nbttflrs.bin.gz".into(),
            humanlike_model: String::new(),
            config: "katrain/KataGo/analysis_config.cfg".into(),
        }
    }
}

#[derive(Clone, Serialize)]
struct LinePayload {
    generation: u64,
    line: String,
}

#[derive(Clone, Serialize)]
struct ExitPayload {
    generation: u64,
    code: Option<i32>,
}

#[derive(Serialize)]
pub struct StartResult {
    generation: u64,
    command: Vec<String>,
}

/// Default KataGo executable for this platform: bundled on Windows/Linux, PATH (e.g. Homebrew) on macOS.
fn default_katago(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(target_os = "windows") {
        return Ok(paths::resolve_resource(app, "katrain/KataGo/katago.exe"));
    }
    if cfg!(target_os = "linux") {
        return Ok(paths::resolve_resource(app, "katrain/KataGo/katago"));
    }
    let bundled = paths::resolve_resource(app, "katrain/KataGo/katago-osx");
    if bundled.is_file() {
        return Ok(bundled);
    }
    paths::find_in_path("katago").ok_or_else(|| {
        "KataGo was not found. Install it (e.g. `brew install katago`) or set its path in the engine settings.".into()
    })
}

fn build_command(app: &AppHandle, launch: &EngineLaunch) -> Result<(Command, Vec<String>), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Could not create {}: {e}", data_dir.display()))?;

    if !launch.altcommand.trim().is_empty() {
        let cmdline = launch.altcommand.trim().to_string();
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.args(["/C", &cmdline]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &cmdline]);
            c
        };
        cmd.current_dir(&data_dir);
        return Ok((cmd, vec![cmdline]));
    }

    let exe = if launch.katago.trim().is_empty() {
        default_katago(app)?
    } else {
        let p = paths::resolve_resource(app, launch.katago.trim());
        if p.components().count() == 1 {
            paths::find_in_path(launch.katago.trim()).unwrap_or(p)
        } else {
            p
        }
    };
    if !exe.is_file() {
        return Err(format!("KataGo executable not found at {}", exe.display()));
    }
    let model = paths::resolve_resource(app, &launch.model);
    if !model.is_file() {
        return Err(format!("KataGo model not found at {}", model.display()));
    }
    let config = paths::resolve_resource(app, &launch.config);
    if !config.is_file() {
        return Err(format!("KataGo config not found at {}", config.display()));
    }

    let mut args: Vec<String> = vec!["analysis".into(), "-model".into(), path_str(&model)];
    if !launch.humanlike_model.trim().is_empty() {
        let human = paths::resolve_resource(app, launch.humanlike_model.trim());
        if human.is_file() {
            args.extend(["-human-model".into(), path_str(&human)]);
        } else {
            return Err(format!("Human-like model not found at {}", human.display()));
        }
    }
    args.extend([
        "-config".into(),
        path_str(&config),
        "-override-config".into(),
        format!("homeDataDir={}", path_str(&data_dir)),
    ]);
    let mut cmd = Command::new(&exe);
    cmd.args(&args);
    // KataGo looks for DLLs and certificates next to itself.
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    let mut display = vec![path_str(&exe)];
    display.extend(args);
    Ok((cmd, display))
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn kill(running: &mut Option<Running>) {
    if let Some(mut r) = running.take() {
        let _ = r.child.kill();
        let _ = r.child.wait();
    }
}

/// Start (or restart) KataGo. Returns a generation number that tags all events from this process.
#[tauri::command]
pub fn engine_start(app: AppHandle, state: State<'_, EngineState>, settings: EngineLaunch) -> Result<StartResult, String> {
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    kill(&mut guard);
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;

    let (mut cmd, display) = build_command(&app, &settings)?;
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Starting KataGo failed: {e} (command: {})", display.join(" ")))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    let app_out = app.clone();
    thread::spawn(move || {
        let reader = BufReader::with_capacity(1 << 20, stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let _ = app_out.emit("katago-stdout", LinePayload { generation, line });
        }
        // stdout closed: the process is gone (or about to be). Report how it ended.
        let state = app_out.state::<EngineState>();
        let code = match state.running.lock() {
            Ok(mut guard) => {
                let ours = state.generation.load(Ordering::SeqCst) == generation;
                match guard.as_mut() {
                    Some(r) if ours => {
                        let status = r.child.wait().ok();
                        *guard = None;
                        status.and_then(|s| s.code())
                    }
                    _ => None,
                }
            }
            Err(_) => None,
        };
        let _ = app_out.emit("katago-exit", ExitPayload { generation, code });
    });

    let app_err = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let _ = app_err.emit("katago-stderr", LinePayload { generation, line });
        }
    });

    *guard = Some(Running { child, stdin });
    Ok(StartResult { generation, command: display })
}

#[tauri::command]
pub fn engine_send(state: State<'_, EngineState>, line: String) -> Result<(), String> {
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    let running = guard.as_mut().ok_or("KataGo is not running")?;
    running
        .stdin
        .write_all(line.as_bytes())
        .and_then(|_| running.stdin.write_all(b"\n"))
        .and_then(|_| running.stdin.flush())
        .map_err(|e| format!("Exception in writing to KataGo: {e}"))
}

#[tauri::command]
pub fn engine_stop(state: State<'_, EngineState>) -> Result<(), String> {
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    state.generation.fetch_add(1, Ordering::SeqCst);
    kill(&mut guard);
    Ok(())
}

/// Called when the app exits so KataGo never outlives the window.
pub fn shutdown(app: &AppHandle) {
    let state = app.state::<EngineState>();
    if let Ok(mut guard) = state.running.lock() {
        kill(&mut guard);
    };
}
