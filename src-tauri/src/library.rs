// The pointer stays on this Mac; only the album library changes location.
// Copy before switching, never overwrite a different album or remove originals.
use crate::storage;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    library_path: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryLocation {
    pub path: PathBuf,
    pub default_path: PathBuf,
    pub is_default: bool,
}

fn settings(data: &Path) -> Result<Settings, String> {
    let file = data.join("settings.json");
    if !file.try_exists().map_err(|e| e.to_string())? && !storage::backup_path(&file).exists() {
        return Ok(Settings::default());
    }
    storage::read_json(&file, |settings: &Settings| {
        if settings
            .library_path
            .as_ref()
            .is_some_and(|path| !path.is_absolute())
        {
            return Err("The configured album library must use an absolute folder path.".into());
        }
        Ok(())
    })
}

pub fn location(data: &Path) -> Result<LibraryLocation, String> {
    let default_path = data.join("projects");
    let path = settings(data)?
        .library_path
        .unwrap_or_else(|| default_path.clone());
    Ok(LibraryLocation {
        is_default: path == default_path,
        path,
        default_path,
    })
}

pub fn projects_dir(data: &Path) -> Result<PathBuf, String> {
    let location = location(data)?;
    if location.is_default {
        fs::create_dir_all(&location.path).map_err(|e| e.to_string())?;
    } else if !location.path.is_dir() {
        return Err(format!("Your album library is unavailable at {}. Reconnect the drive before continuing. The library location is shown in Settings.", location.path.display()));
    }
    Ok(location.path)
}

pub fn change_location(data: &Path, selected: Option<PathBuf>) -> Result<LibraryLocation, String> {
    let source = projects_dir(data)?;
    let destination = selected.unwrap_or_else(|| data.join("projects"));
    if !destination.is_absolute() {
        return Err("Choose an absolute folder path.".into());
    }
    // Default is app-owned and may not exist yet. Custom folders come from the picker.
    if destination == data.join("projects") {
        fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    }
    let destination = destination
        .canonicalize()
        .map_err(|e| format!("Cannot open the selected library folder: {e}"))?;
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    if destination == source {
        return location(data);
    }
    let data_real = data.canonicalize().map_err(|e| e.to_string())?;
    if destination == data_real
        || destination.starts_with(&source)
        || source.starts_with(&destination)
    {
        return Err(
            "Choose a separate library folder, outside the current library and its parent folders."
                .into(),
        );
    }
    // Validate both libraries before copying anything, including recovery of .bak files.
    crate::list_projects_in(&source)?;
    crate::list_projects_in(&destination)?;
    let mut copies = Vec::new();
    for entry in fs::read_dir(&source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let label = name.to_string_lossy();
        if !(label.ends_with(".json")
            || label.ends_with(".json.bak")
            || label.contains(".json.corrupt-"))
        {
            continue;
        }
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
            return Err(format!(
                "{} is not a regular album file. The library has not changed.",
                label
            ));
        }
        let bytes = fs::read(entry.path()).map_err(|e| e.to_string())?;
        let target = destination.join(&name);
        if target.try_exists().map_err(|e| e.to_string())? {
            if fs::read(&target).map_err(|e| e.to_string())? != bytes {
                return Err(format!("{} already contains a different copy of {}. Choose an empty folder to keep both versions safe.", destination.display(), label));
            }
        } else {
            copies.push((target, bytes));
        }
    }
    let probe = destination.join(format!(
        ".album-builder-write-check-{}",
        storage::unique_suffix()
    ));
    let mut created = Vec::new();
    let result = (|| {
        let check = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map_err(|e| format!("The selected folder is not writable: {e}"))?;
        created.push(probe.clone());
        check.sync_all().map_err(|e| e.to_string())?;
        fs::remove_file(&probe).map_err(|e| e.to_string())?;
        for (target, bytes) in &copies {
            // Exclusive creation also protects against another process adding a file after preflight.
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)
                .map_err(|e| e.to_string())?;
            created.push(target.clone());
            file.write_all(bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            if fs::read(target).map_err(|e| e.to_string())? != *bytes {
                return Err("A copied album could not be verified.".into());
            }
        }
        crate::list_projects_in(&destination)?;
        crate::analysis_cache::copy_library(&source, &destination);
        let new_settings = Settings {
            library_path: if destination == data_real.join("projects") {
                None
            } else {
                Some(destination.clone())
            },
        };
        let bytes = serde_json::to_vec_pretty(&new_settings).map_err(|e| e.to_string())?;
        storage::write_json(&data.join("settings.json"), &bytes)?;
        Ok(())
    })();
    if let Err(error) = result {
        for file in created.iter().rev() {
            let _ = fs::remove_file(file);
        }
        return Err(error);
    }
    location(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (PathBuf, PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("album-library-test-{}", storage::unique_suffix()));
        let data = root.join("app-data");
        let custom = root.join("custom");
        fs::create_dir_all(data.join("projects")).unwrap();
        fs::create_dir(&custom).unwrap();
        (root, data, custom)
    }
    fn album(data: &Path) {
        let file = data.join("projects/one.json");
        let bytes =
            br#"{"id":"one","name":"Personal album","tracks":[],"materials":[],"references":[]}"#;
        storage::write_json(&file, bytes).unwrap();
        storage::write_json(&file, bytes).unwrap();
    }
    #[test]
    fn wash_relative_configured_library_path_is_rejected() {
        let (root, data, _) = setup();
        fs::write(
            data.join("settings.json"),
            br#"{"libraryPath":"relative/library"}"#,
        )
        .unwrap();
        assert!(
            location(&data).is_err(),
            "Relative settings must not redirect the library through the process working directory"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn relocation_keeps_originals_and_backups_and_persists_across_reopen() {
        let (root, data, custom) = setup();
        album(&data);
        fs::write(data.join("license.json"), b"private licence").unwrap();
        let key = "c".repeat(64);
        let cached = serde_json::json!({"duration": 3});
        crate::analysis_cache::write(&data.join("projects"), "waveform", &key, &cached).unwrap();
        let before = fs::read(data.join("projects/one.json")).unwrap();
        assert!(
            !change_location(&data, Some(custom.clone()))
                .unwrap()
                .is_default
        );
        assert_eq!(projects_dir(&data).unwrap(), custom.canonicalize().unwrap());
        assert_eq!(fs::read(custom.join("one.json")).unwrap(), before);
        assert!(custom.join("one.json.bak").exists());
        assert_eq!(
            crate::analysis_cache::read(&custom, "waveform", &key),
            Some(cached.clone())
        );
        assert!(!custom.join("license.json").exists());
        assert_eq!(fs::read(data.join("projects/one.json")).unwrap(), before);
        assert!(change_location(&data, None).unwrap().is_default);
        assert_eq!(
            crate::analysis_cache::read(&data.join("projects"), "waveform", &key),
            Some(cached)
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn conflict_never_overwrites_either_library_or_changes_pointer() {
        let (root, data, custom) = setup();
        album(&data);
        let different =
            br#"{"id":"one","name":"Different album","tracks":[],"materials":[],"references":[]}"#;
        fs::write(custom.join("one.json"), different).unwrap();
        assert!(change_location(&data, Some(custom.clone()))
            .unwrap_err()
            .contains("different copy"));
        assert!(location(&data).unwrap().is_default);
        assert_eq!(fs::read(custom.join("one.json")).unwrap(), different);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn disconnected_library_does_not_silently_create_an_empty_replacement() {
        let (root, data, custom) = setup();
        album(&data);
        change_location(&data, Some(custom.clone())).unwrap();
        fs::rename(&custom, root.join("disconnected")).unwrap();
        assert!(projects_dir(&data).unwrap_err().contains("unavailable"));
        assert!(!custom.exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_or_nested_destination_preserves_source_and_settings() {
        let (root, data, custom) = setup();
        album(&data);
        fs::write(custom.join("invalid.json"), b"{").unwrap();
        assert!(change_location(&data, Some(custom.clone())).is_err());
        assert!(!custom.join("one.json").exists());
        let nested = data.join("projects/nested");
        fs::create_dir(&nested).unwrap();
        assert!(change_location(&data, Some(nested)).is_err());
        assert!(location(&data).unwrap().is_default);
        fs::remove_dir_all(root).unwrap();
    }
}
