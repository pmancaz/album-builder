// Save into a temporary sibling first. Renaming the finished file is atomic:
// a reader sees either the complete old version or the complete new version.
use serde::de::DeserializeOwned;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
// Recovery must not race with a save of the same record. The project-level
// lock separately protects longer read/change/write operations such as archive.
static JSON_OPERATIONS: Mutex<()> = Mutex::new(());

pub fn unique_suffix() -> String {
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{}-{}-{}",
        time,
        std::process::id(),
        FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".bak");
    PathBuf::from(name)
}

fn sibling_path(path: &Path, label: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(".{label}-{}", unique_suffix()));
    PathBuf::from(name)
}

// Keeping the writer as a small callback lets a test simulate a disk error
// halfway through a write without damaging a real album or filling the disk.
fn prepare_and_replace(
    path: &Path,
    writer: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let temporary = sibling_path(path, "tmp");
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            // Licence backups receive the same owner-only permissions.
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        writer(&mut file)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        // Best effort: the completed file is already committed. A directory
        // sync failure must not turn a successful save into a misleading error.
        if let Some(parent) = path.parent() {
            if let Ok(directory) = File::open(parent) {
                let _ = directory.sync_all();
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn write_json(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let _operation = JSON_OPERATIONS.lock().map_err(|_| {
        "A local file operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    // A corrupt old file must never replace a useful recovery copy.
    let previous = match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Could not read the existing {} before saving: {}. The file was not changed.",
                path.display(),
                error
            ))
        }
    };
    if let Some(previous) = previous {
        if serde_json::from_slice::<serde_json::Value>(&previous)
            .is_ok_and(|value| value.is_object())
        {
            prepare_and_replace(&backup_path(path), |file| file.write_all(&previous))
                .map_err(|error| format!("Could not preserve the previous save: {error}"))?;
        }
    }
    prepare_and_replace(path, |file| file.write_all(bytes))
        .map_err(|error| format!("Could not save {}: {error}", path.display()))
}

pub fn read_json<T: DeserializeOwned>(
    path: &Path,
    validate: impl Fn(&T) -> Result<(), String>,
) -> Result<T, String> {
    read_json_guarded(path, |_| Ok(()), validate)
}

// A valid record written by a newer app is incompatible, not damaged. Check
// compatibility under the same lock/read as recovery so it can never silently
// replace newer work with a readable but older backup.
pub fn read_json_guarded<T: DeserializeOwned>(
    path: &Path,
    compatible: impl Fn(&T) -> Result<(), String>,
    validate: impl Fn(&T) -> Result<(), String>,
) -> Result<T, String> {
    enum DecodeError {
        Incompatible(String),
        Damaged(String),
    }
    let _operation = JSON_OPERATIONS.lock().map_err(|_| {
        "A local file operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    let decode = |bytes: &[u8]| -> Result<T, DecodeError> {
        let value = serde_json::from_slice(bytes)
            .map_err(|error| DecodeError::Damaged(error.to_string()))?;
        compatible(&value).map_err(DecodeError::Incompatible)?;
        validate(&value).map_err(DecodeError::Damaged)?;
        Ok(value)
    };
    let primary = match fs::read(path) {
        Ok(bytes) => Ok(bytes),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Err(error.to_string()),
        Err(error) => return Err(format!("Could not read {}: {}. The file was not changed; check access or reconnect its drive before retrying.", path.display(), error)),
    };
    let original_error = match &primary {
        Ok(bytes) => match decode(bytes) {
            Ok(value) => return Ok(value),
            Err(DecodeError::Incompatible(error)) => {
                return Err(format!(
                    "Could not open {}: {} The file was not changed.",
                    path.display(),
                    error
                ))
            }
            Err(DecodeError::Damaged(error)) => error,
        },
        Err(error) => error.clone(),
    };
    let backup = backup_path(path);
    if let Ok(bytes) = fs::read(&backup) {
        if let Ok(value) = decode(&bytes) {
            // Retain the damaged input for inspection, then restore the good
            // backup without replacing it with that damaged input.
            if let Ok(damaged) = primary {
                let recovery = sibling_path(path, "corrupt");
                prepare_and_replace(&recovery, |file| file.write_all(&damaged)).map_err(
                    |error| format!("Could not preserve damaged {}: {error}", path.display()),
                )?;
            }
            prepare_and_replace(path, |file| file.write_all(&bytes)).map_err(|error| {
                format!(
                    "Could not restore {} from its backup: {error}",
                    path.display()
                )
            })?;
            return Ok(value);
        }
    }
    Err(format!(
        "Could not read {}: {}. No usable backup was found. Keep this file and restore a known good copy before trying again.",
        path.display(), original_error
    ))
}

pub fn delete_json(path: &Path) -> Result<(), String> {
    let _operation = JSON_OPERATIONS.lock().map_err(|_| {
        "A local file operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    // Recovery copies belong to the same record. Remove them before the main
    // file so a deliberate deletion cannot bring the record back on reopening.
    if let (Some(parent), Some(name)) = (
        path.parent(),
        path.file_name().and_then(|name| name.to_str()),
    ) {
        for entry in fs::read_dir(parent).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let child = entry.file_name();
            let child = child.to_string_lossy();
            if child.starts_with(&format!("{name}.corrupt-"))
                || child.starts_with(&format!("{name}.tmp-"))
            {
                fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
            }
        }
    }
    for file in [backup_path(path), path.to_owned()] {
        match fs::remove_file(file) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn folder() -> PathBuf {
        let path = std::env::temp_dir().join(format!("album-storage-test-{}", unique_suffix()));
        fs::create_dir(&path).unwrap();
        path
    }
    #[cfg(unix)]
    #[test]
    fn wash_save_does_not_replace_an_unreadable_existing_record() {
        use std::os::unix::fs::PermissionsExt;
        let folder = folder();
        let path = folder.join("album.json");
        fs::write(&path, br#"{"name":"keep primary"}"#).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        let outcome = write_json(&path, br#"{"name":"replacement"}"#);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(
            outcome.is_err(),
            "Saving must fail rather than discard an unreadable record"
        );
        assert_eq!(fs::read(&path).unwrap(), br#"{"name":"keep primary"}"#);
        fs::remove_dir_all(folder).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn wash_recovery_does_not_replace_an_unreadable_primary_with_older_backup() {
        use std::os::unix::fs::PermissionsExt;
        let folder = folder();
        let path = folder.join("album.json");
        fs::write(&path, br#"{"name":"newest"}"#).unwrap();
        fs::write(backup_path(&path), br#"{"name":"older"}"#).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        let outcome = read_json::<serde_json::Value>(&path, |_| Ok(()));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(
            outcome.is_err(),
            "An I/O failure is not evidence of damaged JSON"
        );
        assert_eq!(fs::read(&path).unwrap(), br#"{"name":"newest"}"#);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn interrupted_write_preserves_complete_previous_file_and_cleans_temp() {
        let folder = folder();
        let path = folder.join("album.json");
        fs::write(&path, br#"{"name":"previous"}"#).unwrap();
        let result = prepare_and_replace(&path, |file| {
            file.write_all(b"partial new data")?;
            Err(io::Error::new(io::ErrorKind::Other, "synthetic full disk"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), br#"{"name":"previous"}"#);
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn corrupt_primary_recovers_backup_without_destroying_either_evidence() {
        let folder = folder();
        let path = folder.join("album.json");
        write_json(&path, br#"{"name":"previous"}"#).unwrap();
        write_json(&path, br#"{"name":"latest"}"#).unwrap();
        fs::write(&path, b"interrupted {").unwrap();
        let value: serde_json::Value = read_json(&path, |_| Ok(())).unwrap();
        assert_eq!(value["name"], "previous");
        assert_eq!(
            fs::read(&path).unwrap(),
            fs::read(backup_path(&path)).unwrap()
        );
        assert!(fs::read_dir(&folder).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".corrupt-")));
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn missing_primary_can_be_restored_and_invalid_shapes_can_use_backup() {
        let folder = folder();
        let path = folder.join("album.json");
        fs::write(backup_path(&path), br#"{"name":"recoverable"}"#).unwrap();
        let validate = |value: &serde_json::Value| {
            if value.is_object() {
                Ok(())
            } else {
                Err("Expected an album object".into())
            }
        };
        let first: serde_json::Value = read_json(&path, validate).unwrap();
        fs::write(&path, b"42").unwrap();
        let second: serde_json::Value = read_json(&path, validate).unwrap();
        assert_eq!(first, second);
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn unrecoverable_json_reports_the_file_instead_of_disappearing() {
        let folder = folder();
        let path = folder.join("broken-album.json");
        fs::write(&path, b"{").unwrap();
        let error = read_json::<serde_json::Value>(&path, |_| Ok(())).unwrap_err();
        assert!(error.contains("broken-album.json") && error.contains("No usable backup"));
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn deliberate_delete_removes_recovery_copies_and_keeps_other_records() {
        let folder = folder();
        let path = folder.join("album.json");
        write_json(&path, br#"{"name":"first"}"#).unwrap();
        write_json(&path, br#"{"name":"second"}"#).unwrap();
        fs::write(&path, b"broken").unwrap();
        let _: serde_json::Value = read_json(&path, |_| Ok(())).unwrap();
        fs::write(folder.join("different.json"), b"keep").unwrap();
        delete_json(&path).unwrap();
        delete_json(&path).unwrap();
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
        assert_eq!(fs::read(folder.join("different.json")).unwrap(), b"keep");
        fs::remove_dir_all(folder).unwrap();
    }
}
