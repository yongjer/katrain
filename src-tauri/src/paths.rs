//! Resolves the "katrain/..." resource paths used in KaTrain configs to real files.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Map a config path to a file: "katrain/..." refers to bundled resources, "~" to the home folder.
pub fn resolve_resource(app: &AppHandle, path: &str) -> PathBuf {
    let normalized = path.replace('\\', "/");
    if let Some(rel) = normalized.strip_prefix("katrain/") {
        if let Ok(dir) = app.path().resource_dir() {
            let bundled = dir.join(rel);
            if bundled.exists() {
                return bundled;
            }
        }
        // `tauri dev`: fall back to the sources in the repository.
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("katrain").join(rel);
        if cfg!(debug_assertions) && dev.exists() {
            return dev;
        }
        return app.path().resource_dir().map(|d| d.join(rel)).unwrap_or(dev);
    }
    if let Some(rest) = normalized.strip_prefix("~/") {
        if let Ok(home) = app.path().home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

/// Look for an executable on PATH (plus Homebrew locations, which GUI apps on macOS do not inherit).
pub fn find_in_path(name: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    let names: Vec<String> = if cfg!(target_os = "windows") && !name.to_lowercase().ends_with(".exe") {
        vec![format!("{name}.exe"), name.to_string()]
    } else {
        vec![name.to_string()]
    };
    dirs.iter()
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}
