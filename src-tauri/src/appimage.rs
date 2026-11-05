//! Inside an AppImage, the AppImage's launcher points LD_LIBRARY_PATH, PATH, PYTHONHOME and others at the libraries
//! and tools it bundles. Those are for KaTrain itself. Programs it starts must not inherit them: with the bundled
//! libsystemd on LD_LIBRARY_PATH, even the host's `readlink` and `env` fail to start, and with them KataGo's launcher.

use std::process::Command;

/// How to change the inherited environment so that nothing points into the AppImage: the variable to change, and
/// its new value (None removes it). Entries of `:`-separated lists that are outside the AppImage are kept.
fn host_env_changes(appdir: &str, vars: impl Iterator<Item = (String, String)>) -> Vec<(String, Option<String>)> {
    if appdir.is_empty() {
        return Vec::new();
    }
    let inside = |entry: &str| entry == appdir || entry.strip_prefix(appdir).is_some_and(|rest| rest.starts_with('/'));
    vars.filter(|(_, value)| value.split(':').any(inside))
        .map(|(name, value)| {
            let kept: Vec<&str> = value.split(':').filter(|e| !e.is_empty() && !inside(e)).collect();
            (name, if kept.is_empty() { None } else { Some(kept.join(":")) })
        })
        .collect()
}

/// Give a program started from inside an AppImage the environment of the host system. Does nothing elsewhere.
pub fn restore_host_env(cmd: &mut Command) {
    if !cfg!(target_os = "linux") {
        return;
    }
    let Ok(appdir) = std::env::var("APPDIR") else { return };
    let vars = std::env::vars_os().filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)));
    for (name, value) in host_env_changes(&appdir, vars) {
        match value {
            Some(value) => cmd.env(name, value),
            None => cmd.env_remove(name),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn changes(vars: &[(&str, &str)]) -> Vec<(String, Option<String>)> {
        let owned = vars.iter().map(|(k, v)| (k.to_string(), v.to_string()));
        host_env_changes("/tmp/.mount_KaTrain", owned)
    }

    #[test]
    fn removes_variables_that_only_point_into_the_appimage() {
        let result = changes(&[
            ("LD_LIBRARY_PATH", "/tmp/.mount_KaTrain/usr/lib/:/tmp/.mount_KaTrain/lib/"),
            ("PYTHONPATH", "/tmp/.mount_KaTrain/usr/share/pyshared/:"),
            ("GTK_DATA_PREFIX", "/tmp/.mount_KaTrain"),
            ("APPDIR", "/tmp/.mount_KaTrain"),
        ]);
        assert_eq!(result.len(), 4);
        assert!(result.iter().all(|(_, value)| value.is_none()));
    }

    #[test]
    fn keeps_the_entries_of_a_list_that_are_outside_the_appimage() {
        let result = changes(&[("PATH", "/tmp/.mount_KaTrain/usr/bin/:/usr/local/bin:/tmp/.mount_KaTrain/bin/:/usr/bin")]);
        assert_eq!(result, vec![("PATH".to_string(), Some("/usr/local/bin:/usr/bin".to_string()))]);
    }

    #[test]
    fn leaves_everything_else_alone() {
        let result = changes(&[
            ("HOME", "/home/user"),
            ("PATH", "/usr/bin:/bin"),
            ("GTK_THEME", "Adwaita:dark"),
            ("APPIMAGE", "/home/user/KaTrain.AppImage"),
            ("OTHER", "/tmp/.mount_KaTrain2/usr/lib"),
        ]);
        assert!(result.is_empty());
    }

    #[test]
    fn does_nothing_without_an_appdir() {
        let vars = [("LD_LIBRARY_PATH".to_string(), "/usr/lib".to_string())];
        assert!(host_env_changes("", vars.into_iter()).is_empty());
    }
}
