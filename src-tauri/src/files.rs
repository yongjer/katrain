//! File access for game records and the user config.

use std::path::{Path, PathBuf};

use encoding_rs::{Encoding, UTF_8};
use tauri::{AppHandle, Manager};

/// Decode a game record the way pysgf does: Fox/GIB/NGF are UTF-8, otherwise trust the SGF CA[] property,
/// and fall back to statistical detection.
pub fn decode_game_bytes(bytes: &[u8], filename: &str) -> String {
    let lower = filename.to_lowercase();
    let forced_utf8 = lower.ends_with(".gib") || lower.ends_with(".ngf") || contains(bytes, b"AP[foxwq]");
    let encoding: &'static Encoding = if forced_utf8 {
        UTF_8
    } else if let Some(label) = charset_property(bytes) {
        Encoding::for_label(label.trim().as_bytes()).unwrap_or_else(|| guess(bytes))
    } else {
        guess(bytes)
    };
    let (text, _, _) = encoding.decode(bytes);
    text.into_owned()
}

fn guess(bytes: &[u8]) -> &'static Encoding {
    if std::str::from_utf8(bytes).is_ok() {
        return UTF_8;
    }
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    detector.guess(None, true)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn charset_property(bytes: &[u8]) -> Option<String> {
    let pos = bytes.windows(3).position(|w| w == b"CA[")?;
    let rest = &bytes[pos + 3..];
    let end = rest.iter().position(|&b| b == b']')?;
    Some(String::from_utf8_lossy(&rest[..end]).into_owned())
}

#[tauri::command]
pub fn read_game_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(decode_game_bytes(&bytes, &path))
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
        }
    }
    std::fs::write(p, contents).map_err(|e| format!("Could not write {path}: {e}"))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

/// The saved user config, or None on first start.
#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<Option<String>, String> {
    let path = config_path(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

#[tauri::command]
pub fn save_config(app: AppHandle, contents: String) -> Result<(), String> {
    let path = config_path(&app)?;
    write_text_file(path.to_string_lossy().into_owned(), contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_and_charset() {
        assert_eq!(decode_game_bytes("(;PB[李])".as_bytes(), "a.sgf"), "(;PB[李])");
        let (gbk, _, _) = encoding_rs::GBK.encode("(;CA[GB2312]PB[李昌镐])");
        assert_eq!(decode_game_bytes(&gbk, "a.sgf"), "(;CA[GB2312]PB[李昌镐])");
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("(;PB[井山裕太]PW[張栩];B[pd];W[dp];B[pp];W[dd])");
        assert!(decode_game_bytes(&sjis, "a.sgf").contains("井山裕太"));
    }
}
