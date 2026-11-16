// Disposable derived data only. No audio, project decisions or credentials.
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
const LIMIT: u64 = 4 * 1024 * 1024;
fn valid_key(kind: &str, key: &str) -> bool {
    matches!(kind, "waveform" | "spectrum")
        && key.len() == 64
        && key
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn folder(library: &Path, create: bool) -> Result<PathBuf, String> {
    let mut path = library.to_path_buf();
    for name in ["Analysis", "v1"] {
        path.push(name);
        if create && !path.exists() {
            fs::create_dir(&path)
                .or_else(|e| {
                    if e.kind() == std::io::ErrorKind::AlreadyExists {
                        Ok(())
                    } else {
                        Err(e)
                    }
                })
                .map_err(|e| e.to_string())?;
        }
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err("Analysis cache must be a regular folder.".into());
        }
    }
    Ok(path)
}
pub fn read(library: &Path, kind: &str, key: &str) -> Option<Value> {
    if !valid_key(kind, key) {
        return None;
    }
    let file = folder(library, false)
        .ok()?
        .join(format!("{kind}-{key}.json"));
    let meta = fs::symlink_metadata(&file).ok()?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > LIMIT {
        return None;
    }
    let bytes = fs::read(file).ok()?;
    if bytes.len() as u64 > LIMIT {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}
pub fn write(library: &Path, kind: &str, key: &str, value: &Value) -> Result<(), String> {
    if !valid_key(kind, key) || !value.is_object() {
        return Err("Invalid analysis cache record.".into());
    }
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("Analysis cache record is too large.".into());
    }
    let directory = folder(library, true)?;
    let target = directory.join(format!("{kind}-{key}.json"));
    if fs::symlink_metadata(&target).is_ok_and(|m| !m.is_file() || m.file_type().is_symlink()) {
        return Err("Invalid cache destination.".into());
    }
    let temp = directory.join(format!(".tmp-{}", crate::storage::unique_suffix()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e: std::io::Error| e.to_string())
}
pub fn copy_library(source: &Path, destination: &Path) {
    // Cache failures cannot block moving the actual albums. Bad/missing entries
    // simply regenerate next time. Originals are always retained.
    let Ok(directory) = folder(source, false) else {
        return;
    };
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some((kind, key)) = name.strip_suffix(".json").and_then(|s| s.split_once('-')) else {
            continue;
        };
        if read(destination, kind, key).is_some() {
            continue;
        }
        if let Some(value) = read(source, kind, key) {
            let _ = write(destination, kind, key, &value);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_round_trip_relocation_and_corruption_are_disposable() {
        let root =
            std::env::temp_dir().join(format!("album-cache-{}", crate::storage::unique_suffix()));
        let a = root.join("a");
        let b = root.join("b");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        let key = "a".repeat(64);
        let value = serde_json::json!({"duration":2,"waveform":[[-0.2,0.2]]});
        assert!(read(&a, "waveform", &key).is_none());
        write(&a, "waveform", &key, &value).unwrap();
        assert_eq!(read(&a, "waveform", &key), Some(value.clone()));
        copy_library(&a, &b);
        assert_eq!(read(&b, "waveform", &key), Some(value));
        fs::write(
            b.join(format!("Analysis/v1/waveform-{key}.json")),
            b"broken",
        )
        .unwrap();
        assert!(read(&b, "waveform", &key).is_none());
        assert!(write(&a, "../../bad", &key, &serde_json::json!({})).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn cache_rejects_symlink_folders_and_files() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!(
            "album-cache-links-{}",
            crate::storage::unique_suffix()
        ));
        fs::create_dir_all(root.join("outside")).unwrap();
        symlink(root.join("outside"), root.join("Analysis")).unwrap();
        let key = "b".repeat(64);
        assert!(write(&root, "waveform", &key, &serde_json::json!({})).is_err());
        fs::remove_file(root.join("Analysis")).unwrap();
        write(&root, "waveform", &key, &serde_json::json!({})).unwrap();
        let path = root.join(format!("Analysis/v1/waveform-{key}.json"));
        fs::remove_file(&path).unwrap();
        let outside = root.join("outside/private");
        fs::write(&outside, b"private").unwrap();
        symlink(&outside, &path).unwrap();
        assert!(read(&root, "waveform", &key).is_none());
        assert!(write(&root, "waveform", &key, &serde_json::json!({})).is_err());
        assert_eq!(fs::read(&outside).unwrap(), b"private");
        fs::remove_dir_all(root).unwrap();
    }
}
