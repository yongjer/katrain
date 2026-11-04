//! Owns the KataGo analysis engine: a local process, or a WebSocket connection to a remote KataGo analysis
//! engine. The frontend (src/core/engine.ts) does all query bookkeeping, including reconnecting to a remote
//! engine; this module only spawns the process or opens the socket, forwards query lines, and streams the
//! response lines back as events.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::paths;

#[derive(Default)]
pub struct EngineState {
    running: Mutex<Option<Running>>,
    generation: AtomicU64,
}

enum Running {
    Process { child: Child, stdin: ChildStdin },
    Remote { sender: mpsc::UnboundedSender<String>, reader: tauri::async_runtime::JoinHandle<()> },
}

/// Subset of the `engine` config section the backend needs to build the command line.
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct EngineLaunch {
    pub backend: String,
    pub katago: String,
    pub altcommand: String,
    pub remote_url: String,
    pub model: String,
    pub humanlike_model: String,
    pub config: String,
}

impl Default for EngineLaunch {
    fn default() -> Self {
        Self {
            backend: String::new(),
            katago: String::new(),
            altcommand: String::new(),
            remote_url: String::new(),
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
    /// A remote engine is ready as soon as the socket is open (there is no startup output to wait for).
    remote: bool,
}

/// Which engine to use, as resolve_engine_backend in katrain/core/engine.py: the explicit `backend` setting,
/// or for older configs a remote_url means remote and an altcommand means custom.
pub fn resolve_backend(launch: &EngineLaunch) -> &'static str {
    match launch.backend.trim().to_lowercase().as_str() {
        "local" => return "local",
        "remote" => return "remote",
        "custom" => return "custom",
        _ => {}
    }
    if !launch.remote_url.trim().is_empty() {
        "remote"
    } else if !launch.altcommand.trim().is_empty() {
        "custom"
    } else {
        "local"
    }
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

    if resolve_backend(launch) == "custom" {
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
    match running.take() {
        Some(Running::Process { mut child, .. }) => {
            let _ = child.kill();
            let _ = child.wait();
        }
        // Dropping the sender makes the writer send a close frame; the reader stops right away.
        Some(Running::Remote { reader, .. }) => reader.abort(),
        None => {}
    }
}

fn emit_exit(app: &AppHandle, generation: u64, code: Option<i32>) {
    let _ = app.emit("katago-exit", ExitPayload { generation, code });
}

/// Start (or restart) KataGo. Returns a generation number that tags all events from this process or connection.
#[tauri::command]
pub async fn engine_start(app: AppHandle, settings: EngineLaunch) -> Result<StartResult, String> {
    let state = app.state::<EngineState>();
    let generation = {
        let mut guard = state.running.lock().map_err(|e| e.to_string())?;
        kill(&mut guard);
        state.generation.fetch_add(1, Ordering::SeqCst) + 1
    };
    if resolve_backend(&settings) == "remote" {
        return start_remote(app.clone(), generation, settings.remote_url.trim().to_string()).await;
    }
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;

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
                    Some(Running::Process { child, .. }) if ours => {
                        let status = child.wait().ok();
                        *guard = None;
                        status.and_then(|s| s.code())
                    }
                    _ => None,
                }
            }
            Err(_) => None,
        };
        emit_exit(&app_out, generation, code);
    });

    let app_err = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let _ = app_err.emit("katago-stderr", LinePayload { generation, line });
        }
    });

    *guard = Some(Running::Process { child, stdin });
    Ok(StartResult { generation, command: display, remote: false })
}

/// Connect to a remote KataGo analysis engine that speaks the same JSON lines over a WebSocket.
async fn start_remote(app: AppHandle, generation: u64, url: String) -> Result<StartResult, String> {
    if url.is_empty() {
        return Err("Remote KataGo URL is empty".into());
    }
    if !(url.starts_with("ws://") || url.starts_with("wss://")) {
        return Err("Remote KataGo URL must start with ws:// or wss://".into());
    }
    let connect = tokio::time::timeout(Duration::from_secs(30), tokio_tungstenite::connect_async(url.as_str()));
    let (socket, _) = match connect.await {
        Ok(Ok(s)) => s,
        // The frontend wraps these in the translated "Connecting to remote KataGo failed" message.
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => return Err("timed out".into()),
    };
    let (mut write, mut read) = socket.split();
    let (sender, mut queue) = mpsc::unbounded_channel::<String>();

    tauri::async_runtime::spawn(async move {
        while let Some(line) = queue.recv().await {
            if write.send(Message::text(line)).await.is_err() {
                return;
            }
        }
        let _ = write.close().await;
    });

    let app_read = app.clone();
    let reader = tauri::async_runtime::spawn(async move {
        let reason = loop {
            let text = match read.next().await {
                Some(Ok(Message::Text(t))) => t.to_string(),
                Some(Ok(Message::Binary(b))) => String::from_utf8_lossy(&b).into_owned(),
                Some(Ok(Message::Close(frame))) => {
                    break frame.map(|f| f.reason.to_string()).filter(|r| !r.is_empty()).unwrap_or_else(|| "closed by remote".into())
                }
                Some(Ok(_)) => continue, // ping/pong
                Some(Err(e)) => break e.to_string(),
                None => break "connection closed".into(),
            };
            // A frame may hold several newline-separated responses.
            for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
                let _ = app_read.emit("katago-stdout", LinePayload { generation, line: line.to_string() });
            }
        };
        let state = app_read.state::<EngineState>();
        if state.generation.load(Ordering::SeqCst) == generation {
            if let Ok(mut guard) = state.running.lock() {
                *guard = None;
            }
            let _ = app_read.emit("katago-stderr", LinePayload { generation, line: format!("Remote KataGo disconnected: {reason}") });
        }
        emit_exit(&app_read, generation, None);
    });

    let state = app.state::<EngineState>();
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    if state.generation.load(Ordering::SeqCst) != generation {
        reader.abort(); // stopped or restarted while connecting
        return Err("Connection superseded".into());
    }
    *guard = Some(Running::Remote { sender, reader });
    Ok(StartResult { generation, command: vec![url], remote: true })
}

#[tauri::command]
pub fn engine_send(state: State<'_, EngineState>, line: String) -> Result<(), String> {
    let mut guard = state.running.lock().map_err(|e| e.to_string())?;
    match guard.as_mut().ok_or("KataGo is not running")? {
        Running::Process { stdin, .. } => stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("Exception in writing to KataGo: {e}")),
        Running::Remote { sender, .. } => sender.send(line).map_err(|_| "Remote KataGo is disconnected".to_string()),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn launch(backend: &str, remote_url: &str, altcommand: &str) -> EngineLaunch {
        EngineLaunch { backend: backend.into(), remote_url: remote_url.into(), altcommand: altcommand.into(), ..Default::default() }
    }

    #[test]
    fn backend_resolution_matches_python() {
        assert_eq!(resolve_backend(&launch("", "", "")), "local");
        assert_eq!(resolve_backend(&launch("", "ws://x", "")), "remote");
        assert_eq!(resolve_backend(&launch("", "", "katago gtp")), "custom");
        assert_eq!(resolve_backend(&launch("", "ws://x", "katago gtp")), "remote");
        assert_eq!(resolve_backend(&launch("Local", "ws://x", "katago gtp")), "local");
        assert_eq!(resolve_backend(&launch("custom", "ws://x", "katago gtp")), "custom");
        assert_eq!(resolve_backend(&launch("bogus", "", "")), "local");
    }
}
