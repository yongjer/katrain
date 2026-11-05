//! KataGo model files: list what is on disk and download new ones (the "Download Models" button).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

use crate::paths;

/// Downloads in flight, by file name, so a second click does not start the same download twice.
#[derive(Default)]
pub struct Downloads(Mutex<BTreeSet<String>>);

#[derive(Serialize)]
pub struct ModelFile {
    /// Absolute path (or a "katrain/..." path for the bundled model).
    path: String,
    name: String,
    size: u64,
}

#[derive(Clone, Serialize)]
struct Progress {
    name: String,
    received: u64,
    total: Option<u64>,
    done: bool,
    error: Option<String>,
    path: Option<String>,
}

/// Where downloaded models go: <app data>/models.
fn download_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn is_model(p: &Path) -> bool {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    (name.ends_with(".bin.gz") || name.ends_with(".txt.gz")) && !name.contains(".part")
}

/// Models in the bundled models folder, the download folder, the Python KaTrain data folder (~/.katrain),
/// and next to any model paths currently configured.
#[tauri::command]
pub fn list_models(app: AppHandle, extra_paths: Vec<String>) -> Result<Vec<ModelFile>, String> {
    let mut dirs: Vec<(PathBuf, bool)> = vec![(paths::resolve_resource(&app, "katrain/models"), true)];
    dirs.push((download_dir(&app)?, false));
    if let Ok(home) = app.path().home_dir() {
        dirs.push((home.join(".katrain"), false));
    }
    for p in extra_paths.iter().filter(|p| !p.trim().is_empty()) {
        let resolved = paths::resolve_resource(&app, p.trim());
        let dir = if resolved.is_dir() { resolved } else { resolved.parent().map(Path::to_path_buf).unwrap_or(resolved) };
        dirs.push((dir, p.trim().starts_with("katrain")));
    }
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for (dir, bundled) in dirs {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || !is_model(&path) {
                continue;
            }
            let canonical = path.canonicalize().unwrap_or(path.clone());
            if !seen.insert(canonical) {
                continue;
            }
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
            let shown = if bundled && dir == paths::resolve_resource(&app, "katrain/models") {
                format!("katrain/models/{name}")
            } else {
                path.to_string_lossy().into_owned()
            };
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(ModelFile { path: shown, name, size });
        }
    }
    Ok(out)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Katraineo/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// Resolve katagotraining.org's "latest"/"strongest" endpoints to a model URL.
#[tauri::command]
pub async fn resolve_model_endpoint(url: String) -> Result<String, String> {
    if !url.starts_with("https://katagotraining.org/") {
        return Err("only katagotraining.org endpoints are supported".into());
    }
    let res = client()?.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("{url} returned {}", res.status()));
    }
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    json.get("model_file")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| format!("{url} did not return a model_file"))
}

/// Allowed download hosts: the ones KaTrain's model list points at.
fn allowed(url: &str) -> bool {
    [
        "https://github.com/lightvector/KataGo/releases/download/",
        "https://media.katagotraining.org/",
        "https://d3dndmfyhecmj0.cloudfront.net/",
    ]
    .iter()
    .any(|prefix| url.starts_with(prefix))
}

/// Download a model into the download folder, reporting progress as "model-download" events.
/// Returns the saved path.
#[tauri::command]
pub async fn download_model(app: AppHandle, state: State<'_, Downloads>, name: String, url: String) -> Result<String, String> {
    if !allowed(&url) {
        return Err(format!("Refusing to download from {url}"));
    }
    let file_name = url.rsplit('/').next().unwrap_or_default().to_string();
    if file_name.is_empty() || file_name.contains("..") || !(file_name.ends_with(".bin.gz") || file_name.ends_with(".txt.gz")) {
        return Err(format!("Unexpected model file name in {url}"));
    }
    {
        let mut active = state.0.lock().map_err(|e| e.to_string())?;
        if !active.insert(file_name.clone()) {
            return Err(format!("{file_name} is already downloading"));
        }
    }
    let result = do_download(&app, &name, &url, &file_name).await;
    if let Ok(mut active) = state.0.lock() {
        active.remove(&file_name);
    }
    let report = |done: bool, error: Option<String>, path: Option<String>| {
        let _ = app.emit("model-download", Progress { name: name.clone(), received: 0, total: None, done, error, path });
    };
    match &result {
        Ok(path) => report(true, None, Some(path.clone())),
        Err(e) => report(true, Some(e.clone()), None),
    }
    result
}

async fn do_download(app: &AppHandle, name: &str, url: &str, file_name: &str) -> Result<String, String> {
    let dir = download_dir(app)?;
    let target = dir.join(file_name);
    let part = dir.join(format!("{file_name}.part"));
    let res = client()?.get(url).send().await.map_err(|e| format!("Download of {name} failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Download of {name} failed: HTTP {}", res.status()));
    }
    let total = res.content_length();
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| format!("Could not create {}: {e}", part.display()))?;
    let mut received: u64 = 0;
    let mut last_report: u64 = 0;
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(format!("Download of {name} failed: {e}"));
            }
        };
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if received - last_report > 1 << 20 {
            last_report = received;
            let _ = app.emit(
                "model-download",
                Progress { name: name.into(), received, total, done: false, error: None, path: None },
            );
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&part, &target).await.map_err(|e| format!("Could not move {}: {e}", part.display()))?;
    Ok(target.to_string_lossy().into_owned())
}
