// Every export gets a fresh folder. Previous exports and source recordings
// are never overwritten, even when a source came from an earlier export.
use crate::{
    append_metadata, ffmpeg_path, metadata_text, safe_file_stem, storage, ExportFailure,
    ExportRequest, ExportResult, ExportTrack,
};
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    process::Command,
};

fn new_export_folder(parent: &Path, title: &str) -> Result<PathBuf, String> {
    if !parent.is_dir() {
        return Err("Choose an existing export folder.".to_owned());
    }
    let parent = parent.canonicalize().map_err(|error| error.to_string())?;
    let stem = safe_file_stem(title);
    for attempt in 1..=10000 {
        let name = if attempt == 1 {
            stem.clone()
        } else {
            format!("{stem} ({attempt})")
        };
        let folder = parent.join(name);
        // create_dir is exclusive: simultaneous exports cannot claim the same
        // directory, and a symbolic link counts as an existing destination.
        match fs::create_dir(&folder) {
            Ok(()) => return Ok(folder),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create an export folder: {error}")),
        }
    }
    Err("There are too many exports with this album name. Choose another folder.".to_owned())
}

fn same_file(left: &Path, right: &Path) -> bool {
    if let (Ok(left_path), Ok(right_path)) = (left.canonicalize(), right.canonicalize()) {
        if left_path == right_path {
            return true;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(left_info), Ok(right_info)) = (fs::metadata(left), fs::metadata(right)) {
            return left_info.dev() == right_info.dev() && left_info.ino() == right_info.ino();
        }
    }
    false
}

fn copy_new(source: &Path, destination: &Path) -> Result<(), String> {
    if same_file(source, destination) {
        return Err(
            "The export destination is the source recording. Choose another folder.".to_owned(),
        );
    }
    let mut input =
        File::open(source).map_err(|error| format!("Could not read source: {error}"))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("Could not create a new export file: {error}"))?;
    if let Err(error) = io::copy(&mut input, &mut output).and_then(|_| output.sync_all()) {
        // Only this newly created partial file is removed. An earlier export
        // would have failed create_new and would never reach this cleanup.
        let _ = fs::remove_file(destination);
        return Err(format!("Could not finish writing the export: {error}"));
    }
    Ok(())
}

fn supports_embedded_art(extension: &str) -> bool {
    matches!(extension, "mp3" | "m4a" | "flac" | "aif" | "aiff")
}

fn export_track(
    request: &ExportRequest,
    track: &ExportTrack,
    index: usize,
    folder: &Path,
) -> Result<(), String> {
    let source = PathBuf::from(&track.path);
    if !source.is_file() {
        return Err("The source audio file is missing or is not a regular file.".to_owned());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(
        extension.as_str(),
        "wav" | "mp3" | "m4a" | "aac" | "flac" | "aif" | "aiff" | "ogg" | "opus"
    ) {
        return Err(format!(
            "The .{extension} audio format is not supported for export."
        ));
    }
    let output = folder.join(format!(
        "{index:02} - {}.{extension}",
        safe_file_stem(&track.title)
    ));
    if extension == "wav" {
        return copy_new(&source, &output);
    }
    let temporary = folder.join(format!(".audio-{}.{extension}", storage::unique_suffix()));
    let mut command = Command::new(ffmpeg_path());
    command
        .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-i"])
        .arg(&source);
    let artwork = request
        .artwork_path
        .as_ref()
        .filter(|_| supports_embedded_art(&extension));
    if let Some(artwork) = artwork {
        command.arg("-i").arg(artwork);
    }
    command.args(["-map_metadata", "-1", "-map", "0:a:0"]);
    if artwork.is_some() {
        command.args([
            "-map",
            "1:v:0",
            "-c:v",
            "mjpeg",
            "-disposition:v:0",
            "attached_pic",
        ]);
    }
    command.args(["-c:a", "copy"]);
    if extension == "mp3" {
        command.args(["-id3v2_version", "3", "-write_id3v1", "1"]);
    }
    // AIFF needs an explicit ID3 chunk or FFmpeg can silently discard album
    // tags and artwork while still reporting a successful file export.
    if matches!(extension.as_str(), "aif" | "aiff") {
        command.args(["-write_id3v2", "1"]);
    }
    let numbered = ExportTrack {
        path: track.path.clone(),
        title: track.title.clone(),
        index,
    };
    append_metadata(
        &mut command,
        &request.metadata,
        &numbered,
        request.tracks.len(),
    );
    command.arg(&temporary);
    let result = match command.output() {
        Ok(result) if result.status.success() => copy_new(&temporary, &output),
        Ok(result) => {
            let details: String = String::from_utf8_lossy(&result.stderr)
                .chars()
                .take(3000)
                .collect();
            Err(format!(
                "FFmpeg could not export this track: {}",
                if details.trim().is_empty() {
                    result.status.to_string()
                } else {
                    details.trim().to_owned()
                }
            ))
        }
        Err(error) => Err(format!(
            "Could not run FFmpeg. Check that FFmpeg is installed: {error}"
        )),
    };
    let _ = fs::remove_file(temporary);
    result
}

pub(super) fn export_to_folder(request: ExportRequest) -> Result<ExportResult, String> {
    if request.tracks.is_empty() {
        return Err("Add at least one track before exporting.".to_owned());
    }
    if let Some(artwork) = &request.artwork_path {
        if !Path::new(artwork).is_file() {
            return Err("The selected artwork file is missing. Choose it again or clear the artwork before exporting.".to_owned());
        }
    }
    let folder = new_export_folder(Path::new(&request.output_dir), &request.metadata.title)?;
    let mut result = ExportResult {
        exported: 0,
        failed: 0,
        failures: Vec::new(),
        warnings: Vec::new(),
        output_dir: folder.to_string_lossy().into_owned(),
    };
    // Keep a standalone cover too; Ogg, Opus, AAC and WAV do not all support
    // the same attached-picture mechanism, but the release still needs its art.
    if let Some(artwork) = &request.artwork_path {
        let source = Path::new(artwork);
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("image");
        let cover = folder.join(format!("album-artwork.{}", safe_file_stem(extension)));
        if let Err(error) = copy_new(source, &cover) {
            result.warnings.push(format!(
                "The standalone artwork could not be copied: {error}"
            ));
        }
    }
    for (position, track) in request.tracks.iter().enumerate() {
        match export_track(&request, track, position + 1, &folder) {
            Ok(()) => result.exported += 1,
            Err(message) => result.failures.push(ExportFailure {
                path: track.path.clone(),
                message,
            }),
        }
        let extension = Path::new(&track.path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase();
        let warning = if matches!(extension.as_str(), "wav" | "aac") {
            Some("WAV and raw AAC copies keep release metadata in album-metadata.txt; their embedded tags are not changed.")
        } else if request.artwork_path.is_some() && !supports_embedded_art(&extension) {
            Some("Ogg and Opus exports keep their cover as a separate album-artwork file rather than an attached picture.")
        } else {
            None
        };
        if let Some(warning) = warning {
            if !result.warnings.iter().any(|item| item == warning) {
                result.warnings.push(warning.to_owned());
            }
        }
    }
    result.failed = result.failures.len();
    let numbered: Vec<ExportTrack> = request
        .tracks
        .iter()
        .enumerate()
        .map(|(index, track)| ExportTrack {
            path: track.path.clone(),
            title: track.title.clone(),
            index: index + 1,
        })
        .collect();
    let mut text = metadata_text(&request.metadata, &numbered);
    if !result.warnings.is_empty() {
        text.push_str("\nExport notes:\n");
        text.push_str(&result.warnings.join("\n"));
        text.push('\n');
    }
    if !result.failures.is_empty() {
        text.push_str("\nFiles that could not be exported:\n");
        for failure in &result.failures {
            text.push_str(&format!("{}: {}\n", failure.path, failure.message));
        }
    }
    use std::io::Write;
    let metadata_path = folder.join("album-metadata.txt");
    let written = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&metadata_path)
        .and_then(|mut file| {
            file.write_all(text.as_bytes())
                .and_then(|_| file.sync_all())
        });
    if let Err(error) = written {
        result.warnings.push(format!(
            "Audio export finished, but album-metadata.txt could not be written: {error}"
        ));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ExportMetadata;
    fn folder() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("album-export-test-{}", storage::unique_suffix()));
        fs::create_dir(&path).unwrap();
        path
    }
    fn request(parent: &Path, source: &Path) -> ExportRequest {
        ExportRequest {
            output_dir: parent.to_string_lossy().into_owned(),
            artwork_path: None,
            metadata: ExportMetadata {
                title: "Album".into(),
                ..Default::default()
            },
            tracks: vec![ExportTrack {
                path: source.to_string_lossy().into_owned(),
                title: "Track".into(),
                index: 1,
            }],
        }
    }
    #[test]
    fn reexport_of_exported_wav_keeps_source_and_previous_album_untouched() {
        let parent = folder();
        let old = parent.join("Album");
        fs::create_dir(&old).unwrap();
        let source = old.join("01 - Track.wav");
        fs::write(&source, b"original source audio").unwrap();
        let result = export_to_folder(request(&parent, &source)).unwrap();
        assert_eq!(result.exported, 1);
        assert_eq!(result.failed, 0);
        assert_eq!(
            Path::new(&result.output_dir).file_name().unwrap(),
            "Album (2)"
        );
        assert_eq!(fs::read(&source).unwrap(), b"original source audio");
        assert_eq!(
            fs::read(Path::new(&result.output_dir).join("01 - Track.wav")).unwrap(),
            b"original source audio"
        );
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn export_folder_is_contained_for_dot_empty_unicode_and_separator_titles() {
        let parent = folder();
        for title in ["..", ".", "", "   ", "../Album", "海辺のアルバム", "a\\b"] {
            let output = new_export_folder(&parent, title).unwrap();
            assert_eq!(output.parent().unwrap(), parent.canonicalize().unwrap());
        }
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn copy_rejects_same_file_existing_file_and_hardlink_without_truncation() {
        let parent = folder();
        let source = parent.join("source.wav");
        fs::write(&source, b"preserve me").unwrap();
        assert!(copy_new(&source, &source).is_err());
        let existing = parent.join("existing.wav");
        fs::write(&existing, b"previous export").unwrap();
        assert!(copy_new(&source, &existing).is_err());
        assert_eq!(fs::read(&existing).unwrap(), b"previous export");
        let link = parent.join("linked.wav");
        fs::hard_link(&source, &link).unwrap();
        assert!(copy_new(&source, &link).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"preserve me");
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn missing_audio_has_a_specific_failure_and_does_not_leave_partial_output() {
        let parent = folder();
        let missing = parent.join("missing.wav");
        let result = export_to_folder(request(&parent, &missing)).unwrap();
        assert_eq!(result.failed, 1);
        assert_eq!(result.exported, 0);
        assert_eq!(result.failures[0].path, missing.to_string_lossy());
        assert!(result.failures[0].message.contains("missing"));
        assert!(!Path::new(&result.output_dir)
            .join("01 - Track.wav")
            .exists());
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn empty_export_does_not_create_any_output() {
        let parent = folder();
        let mut empty = request(&parent, &parent.join("unused.wav"));
        empty.tracks.clear();
        assert!(export_to_folder(empty).is_err());
        assert_eq!(fs::read_dir(&parent).unwrap().count(), 0);
        fs::remove_dir_all(parent).unwrap();
    }
    #[test]
    fn ffmpeg_exports_supported_formats_with_artwork_and_reports_broken_audio() {
        // Run the real encoder only against generated audio. On a machine
        // without FFmpeg, the filesystem safety tests above still run.
        if Command::new(ffmpeg_path())
            .arg("-version")
            .output()
            .is_err()
        {
            eprintln!("FFmpeg format test skipped: FFmpeg is not installed.");
            return;
        }
        let parent = folder();
        let source = parent.join("tone.wav");
        let samples = 24000u32;
        let mut wav = Vec::new();
        wav.extend(b"RIFF");
        wav.extend((36 + samples * 2).to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16u32.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(24000u32.to_le_bytes());
        wav.extend(48000u32.to_le_bytes());
        wav.extend(2u16.to_le_bytes());
        wav.extend(16u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend((samples * 2).to_le_bytes());
        for index in 0..samples {
            let sample =
                (6000.0 * (index as f64 * 220.0 * std::f64::consts::TAU / 24000.0).sin()) as i16;
            wav.extend(sample.to_le_bytes());
        }
        fs::write(&source, wav).unwrap();
        let artwork = parent.join("cover.ppm");
        let mut pixels = b"P6\n16 16\n255\n".to_vec();
        pixels.extend([190, 130, 60].repeat(256));
        fs::write(&artwork, pixels).unwrap();
        for (extension, codec) in [
            ("mp3", "libmp3lame"),
            ("m4a", "aac"),
            ("aiff", "pcm_s16be"),
            ("flac", "flac"),
            ("ogg", "vorbis"),
            ("opus", "opus"),
            ("aac", "aac"),
        ] {
            let input = parent.join(format!("tone.{extension}"));
            let fixture = Command::new(ffmpeg_path())
                .args(["-v", "error", "-n", "-i"])
                .arg(&source)
                .args(["-ac", "2", "-c:a", codec, "-strict", "-2"])
                .arg(&input)
                .output()
                .unwrap();
            assert!(
                fixture.status.success(),
                "Could not prepare {extension}: {}",
                String::from_utf8_lossy(&fixture.stderr)
            );
            let mut request = request(&parent, &input);
            request.artwork_path = Some(artwork.to_string_lossy().into_owned());
            let result = export_to_folder(request).unwrap();
            assert_eq!(
                result.exported,
                1,
                "Failed {extension}: {:?}",
                result
                    .failures
                    .iter()
                    .map(|item| &item.message)
                    .collect::<Vec<_>>()
            );
            assert_eq!(result.failed, 0);
            assert!(
                fs::metadata(Path::new(&result.output_dir).join(format!("01 - Track.{extension}")))
                    .unwrap()
                    .len()
                    > 0
            );
            let probe_path = Path::new(ffmpeg_path()).with_file_name("ffprobe");
            let probe = Command::new(&probe_path)
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format_tags:stream=codec_type:stream_tags",
                    "-of",
                    "json",
                ])
                .arg(Path::new(&result.output_dir).join(format!("01 - Track.{extension}")))
                .output()
                .unwrap();
            assert!(probe.status.success());
            let details: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
            let streams = details["streams"].as_array().unwrap();
            assert_eq!(
                streams.iter().any(|stream| stream["codec_type"] == "video"),
                supports_embedded_art(extension)
            );
            if extension != "aac" {
                assert!(
                    details["format"]["tags"]["album"] == "Album"
                        || streams
                            .iter()
                            .any(|stream| stream["tags"]["album"] == "Album"),
                    "Album tag missing for {extension}"
                );
            }
            assert!(!fs::read_dir(&result.output_dir).unwrap().any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".audio-")));
        }
        let broken = parent.join("broken.mp3");
        fs::write(&broken, b"not audio").unwrap();
        let result = export_to_folder(request(&parent, &broken)).unwrap();
        assert_eq!(result.failed, 1);
        assert!(result.failures[0].message.contains("FFmpeg"));
        assert!(!Path::new(&result.output_dir)
            .join("01 - Track.mp3")
            .exists());
        fs::remove_dir_all(parent).unwrap();
    }
}
