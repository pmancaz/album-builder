// Release Preparer 0.1.29 media pipeline, integrated into Album Builder.
// Project persistence is owned exclusively by the album library.
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
#[cfg(test)]
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

#[derive(Default, Deserialize, Serialize, Clone)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackMetadata {
    title: String,
    artist: String,
    album: String,
    album_artist: String,
    year: String,
    genre: String,
    composer: String,
    track_number: String,
    disc_number: String,
    label: String,
    catalogue: String,
    isrc: String,
    copyright: String,
    comment: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioInfo {
    path: String,
    file_name: String,
    extension: String,
    duration_seconds: f64,
    format_name: String,
    metadata: TrackMetadata,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileDataUrl {
    file_name: String,
    data_url: String,
}

#[derive(Default, Deserialize)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseMetadata {
    album: String,
    album_artist: String,
    year: String,
    genre: String,
    label: String,
    catalogue: String,
    copyright: String,
    upc: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportTrack {
    id: String,
    path: String,
    output_file_name: String,
    metadata: TrackMetadata,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextFile {
    relative_path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NonMusicUpdateRequest {
    output_dir: String,
    folder_name: String,
    text_files: Vec<TextFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NonMusicUpdateResult {
    destination: String,
    updated: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportRequest {
    output_dir: String,
    folder_name: String,
    artwork_data_url: String,
    artwork_file_name: String,
    web_artwork_file_name: String,
    release: ReleaseMetadata,
    tracks: Vec<ExportTrack>,
    text_files: Vec<TextFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportResult {
    destination: String,
    exported: usize,
    failed: usize,
    mp3_exported: usize,
    mp3_failed: usize,
    web_artwork_path: String,
    web_artwork_bytes: u64,
    prepared_tracks: Vec<PreparedTrack>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedTrack {
    id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenAiDraftRequest {
    model: String,
    instructions: String,
    input: String,
    schema: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiKeyStatus {
    saved: bool,
    hint: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoMedia {
    uses_artwork: bool,
    path: String,
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoTrack {
    path: String,
    output_file_name: String,
    duration_seconds: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoExportRequest {
    export_id: String,
    output_dir: String,
    folder_name: String,
    artwork_data_url: String,
    logo_data_url: String,
    foreground: VideoMedia,
    background: VideoMedia,
    background_blur: f64,
    background_opacity: f64,
    foreground_size: f64,
    foreground_shadow_enabled: bool,
    foreground_shadow_intensity: f64,
    logo_enabled: bool,
    logo_opacity: f64,
    logo_size: f64,
    logo_x: f64,
    logo_y: f64,
    tracks: Vec<VideoTrack>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CanvasVariant {
    output_file_name: String,
    seed: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CanvasExportRequest {
    export_id: String,
    output_dir: String,
    folder_name: String,
    artwork_data_url: String,
    source: VideoMedia,
    composition_mode: String,
    background_treatment: String,
    background_color: String,
    position_x: f64,
    position_y: f64,
    image_scale: f64,
    preset: String,
    film_format: String,
    film_condition: String,
    seed: u32,
    intensity: f64,
    grain_amount: f64,
    grain_size: f64,
    grain_clumping: f64,
    exposure_flicker: f64,
    colour_instability: f64,
    horizontal_weave: f64,
    vertical_jitter: f64,
    rotation: f64,
    scale_breathing: f64,
    optical_softness: f64,
    halation: f64,
    vignette: f64,
    dust_amount: f64,
    scratch_probability: f64,
    scratch_persistence: f64,
    hair_probability: f64,
    damage_probability: f64,
    light_leak_probability: f64,
    cue_marks: String,
    monochrome: bool,
    duration_seconds: f64,
    film_frame_rate: u32,
    output_frame_rate: u32,
    variants: Vec<CanvasVariant>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoExportResult {
    destination: String,
    exported: usize,
    failed: usize,
    message: String,
    encoder: String,
    cancelled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VideoExportProgress {
    export_id: String,
    completed: usize,
    total: usize,
    current_track: String,
    phase: String,
    track_percent: f64,
}

// Each running export owns one small cancellation flag. The command invoked by
// the Cancel button only flips that flag; the worker then stops FFmpeg safely
// at its next progress update and removes the unfinished temporary video.
static VIDEO_EXPORT_CANCELLATIONS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    OnceLock::new();

fn video_export_cancellations() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    VIDEO_EXPORT_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

struct ActiveVideoExport {
    id: String,
    cancel: Arc<AtomicBool>,
}

impl ActiveVideoExport {
    fn register(id: &str) -> Result<Self, String> {
        if id.trim().is_empty() {
            return Err("The video export needs a unique identifier.".to_owned());
        }
        let mut registry = video_export_cancellations()
            .lock()
            .map_err(|_| "Could not prepare video-export cancellation.".to_owned())?;
        if registry.contains_key(id) {
            return Err("This video export is already running.".to_owned());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        registry.insert(id.to_owned(), Arc::clone(&cancel));
        Ok(Self {
            id: id.to_owned(),
            cancel,
        })
    }
}

impl Drop for ActiveVideoExport {
    fn drop(&mut self) {
        if let Ok(mut registry) = video_export_cancellations().lock() {
            if registry
                .get(&self.id)
                .is_some_and(|flag| Arc::ptr_eq(flag, &self.cancel))
            {
                registry.remove(&self.id);
            }
        }
    }
}

const VIDEO_EXPORT_CANCELLED: &str = "Video export cancelled.";

const OPENAI_KEYRING_SERVICE: &str = "com.patrickcarroll.release-preparer.openai";
const OPENAI_KEYRING_ACCOUNT: &str = "openai-api-key";

fn is_supported_audio_preview(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "wav" | "wave" | "aif" | "aiff" | "flac" | "mp3" | "m4a"
            )
        })
        .unwrap_or(false)
}

fn allow_audio_preview(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let requested = PathBuf::from(path);
    if !requested.is_file() || !is_supported_audio_preview(&requested) {
        return Err("The selected master is missing or is not a supported audio file.".to_owned());
    }
    let canonical = requested
        .canonicalize()
        .map_err(|error| error.to_string())?;
    // Only this exact user-selected master is exposed to the WebView for playback.
    app.asset_protocol_scope()
        .allow_file(&canonical)
        .map_err(|error| error.to_string())?;
    Ok(canonical.to_string_lossy().into_owned())
}

fn is_supported_visual(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "mp4" | "mov" | "m4v"
            )
        })
        .unwrap_or(false)
}

fn allow_visual_preview(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let requested = PathBuf::from(path);
    if !requested.is_file() || !is_supported_visual(&requested) {
        return Err("The selected image or video is missing or unsupported.".to_owned());
    }
    let canonical = requested
        .canonicalize()
        .map_err(|error| error.to_string())?;
    // Only the exact file chosen for this video layer becomes visible to the
    // preview. The app never grants the WebView access to an entire folder.
    app.asset_protocol_scope()
        .allow_file(&canonical)
        .map_err(|error| error.to_string())?;
    Ok(canonical.to_string_lossy().into_owned())
}

fn reveal_file_in_finder(path: String) -> Result<(), String> {
    let requested = PathBuf::from(path);
    if !requested.is_file() {
        return Err("This master file is missing from its saved location.".to_owned());
    }
    let canonical = requested
        .canonicalize()
        .map_err(|error| error.to_string())?;
    // macOS open -R asks Finder to reveal and select one exact file. Passing
    // arguments directly avoids using a shell or interpreting the file name.
    let status = Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&canonical)
        .status()
        .map_err(|error| format!("Could not open Finder: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Finder could not reveal this master file.".to_owned())
    }
}

fn safe_file_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            ) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        "Untitled".to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn ffmpeg_path() -> &'static str {
    // Packaged macOS apps do not inherit the normal Terminal PATH, so common Homebrew locations are checked explicitly.
    if Path::new("/opt/homebrew/bin/ffmpeg").exists() {
        "/opt/homebrew/bin/ffmpeg"
    } else if Path::new("/usr/local/bin/ffmpeg").exists() {
        "/usr/local/bin/ffmpeg"
    } else {
        "ffmpeg"
    }
}

fn ffprobe_path() -> &'static str {
    if Path::new("/opt/homebrew/bin/ffprobe").exists() {
        "/opt/homebrew/bin/ffprobe"
    } else if Path::new("/usr/local/bin/ffprobe").exists() {
        "/usr/local/bin/ffprobe"
    } else {
        "ffprobe"
    }
}

fn find_tag(tags: &HashMap<String, String>, names: &[&str]) -> String {
    for name in names {
        if let Some((_, value)) = tags.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)) {
            return value.clone();
        }
    }
    String::new()
}

fn parse_track_metadata(tags: &HashMap<String, String>) -> TrackMetadata {
    TrackMetadata {
        title: find_tag(tags, &["title"]),
        artist: find_tag(tags, &["artist"]),
        album: find_tag(tags, &["album"]),
        album_artist: find_tag(tags, &["album_artist", "albumartist"]),
        year: find_tag(tags, &["date", "year"]),
        genre: find_tag(tags, &["genre"]),
        composer: find_tag(tags, &["composer"]),
        track_number: find_tag(tags, &["track", "tracknumber"]),
        disc_number: find_tag(tags, &["disc", "discnumber"]),
        label: find_tag(tags, &["publisher", "label"]),
        catalogue: find_tag(tags, &["catalognumber", "catalogue", "catalog"]),
        isrc: find_tag(tags, &["isrc"]),
        copyright: find_tag(tags, &["copyright"]),
        comment: find_tag(tags, &["comment", "description"]),
    }
}

fn local_media_file(path: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|_| {
        format!(
            "The source media file is missing from its saved location: {}",
            path.display()
        )
    })?;
    if !canonical.is_file() {
        return Err(format!(
            "Choose a regular local media file: {}",
            path.display()
        ));
    }
    // An absolute filesystem path also prevents a legitimate filename with a
    // colon or leading dash from being interpreted as an FFmpeg protocol/flag.
    Ok(canonical)
}

fn inspect_audio(paths: Vec<String>) -> Result<Vec<AudioInfo>, String> {
    let mut inspected = Vec::new();
    for source in paths {
        let path = PathBuf::from(&source);
        let local_path = local_media_file(&path)?;
        let output = Command::new(ffprobe_path())
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration,format_name:format_tags",
                "-of",
                "json",
            ])
            .arg(&local_path)
            .output()
            .map_err(|error| format!("Could not start ffprobe: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Could not inspect {}: {}",
                path.display(),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let value: Value =
            serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        let format = value.get("format").cloned().unwrap_or(Value::Null);
        let tags: HashMap<String, String> = format
            .get("tags")
            .and_then(Value::as_object)
            .map(|object| {
                object
                    .iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|text| (key.clone(), text.to_owned()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        inspected.push(AudioInfo {
            path: source,
            file_name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("Untitled audio")
                .to_owned(),
            extension: path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("audio")
                .to_lowercase(),
            duration_seconds: format
                .get("duration")
                .and_then(Value::as_str)
                .and_then(|text| text.parse().ok())
                .unwrap_or(0.0),
            format_name: format
                .get("format_name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            metadata: parse_track_metadata(&tags),
        });
    }
    Ok(inspected)
}

fn read_file_data_url(path: String) -> Result<FileDataUrl, String> {
    let source = PathBuf::from(&path);
    let bytes = fs::read(&source).map_err(|error| error.to_string())?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };
    Ok(FileDataUrl {
        file_name: source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("image")
            .to_owned(),
        data_url: format!("data:{mime};base64,{}", BASE64.encode(bytes)),
    })
}

fn openai_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(OPENAI_KEYRING_SERVICE, OPENAI_KEYRING_ACCOUNT)
        .map_err(|error| format!("Could not open macOS Keychain: {error}"))
}

fn read_openai_key() -> Result<Option<String>, String> {
    // A missing key is a normal setup state. Other Keychain failures are kept
    // separate so the settings screen can explain the real problem.
    match openai_keyring_entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read macOS Keychain: {error}")),
    }
}

fn saved_openai_key() -> Result<String, String> {
    read_openai_key()?.ok_or_else(|| "No OpenAI API key is saved yet.".to_owned())
}

fn openai_api_key_status() -> Result<ApiKeyStatus, String> {
    match read_openai_key()? {
        Some(key) => Ok(ApiKeyStatus {
            saved: true,
            hint: format!(
                "••••{}",
                key.chars()
                    .rev()
                    .take(4)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect::<String>()
            ),
        }),
        None => Ok(ApiKeyStatus {
            saved: false,
            hint: String::new(),
        }),
    }
}

fn save_openai_api_key(api_key: String) -> Result<ApiKeyStatus, String> {
    let key = api_key.trim();
    if key.len() < 20 {
        return Err("Enter a complete OpenAI API key.".to_owned());
    }
    openai_keyring_entry()?
        .set_password(key)
        .map_err(|error| format!("Could not save the API key in macOS Keychain: {error}"))?;
    // Read the key back before reporting success. This prevents the interface
    // from saying "Drafting is ready" when secure storage was not persistent.
    let stored = saved_openai_key()?;
    if stored != key {
        return Err("macOS Keychain did not return the key that was just saved.".to_owned());
    }
    openai_api_key_status()
}

fn remove_openai_api_key() -> Result<ApiKeyStatus, String> {
    let entry = openai_keyring_entry()?;
    match entry.get_password() {
        Ok(_) => entry.delete_credential().map_err(|error| {
            format!("Could not remove the API key from macOS Keychain: {error}")
        })?,
        Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(format!("Could not read macOS Keychain: {error}")),
    }
    openai_api_key_status()
}

async fn generate_release_copy(request: OpenAiDraftRequest) -> Result<Value, String> {
    let api_key = saved_openai_key()?;
    let body = json!({
        "model": request.model,
        "reasoning": { "effort": "medium" },
        "instructions": request.instructions,
        "input": request.input,
        "store": false,
        "max_output_tokens": 12000,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "release_preparer_copy",
                "strict": true,
                "schema": request.schema
            }
        }
    });
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not reach the OpenAI API: {error}"))?;
    let status = response.status();
    let response_body: Value = response
        .json()
        .await
        .map_err(|error| format!("The OpenAI API returned an unreadable response: {error}"))?;
    if !status.is_success() {
        let message = response_body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("The OpenAI API rejected the request.");
        return Err(message.to_owned());
    }
    if response_body.get("status").and_then(Value::as_str) != Some("completed") {
        return Err("The draft did not complete. Try refreshing it again.".to_owned());
    }

    let mut output_text = None;
    for item in response_body
        .get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for content in item
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if content.get("type").and_then(Value::as_str) == Some("refusal") {
                return Err(content
                    .get("refusal")
                    .and_then(Value::as_str)
                    .unwrap_or("The model declined this drafting request.")
                    .to_owned());
            }
            if content.get("type").and_then(Value::as_str) == Some("output_text") {
                output_text = content.get("text").and_then(Value::as_str);
            }
        }
    }
    let text = output_text.ok_or_else(|| "The model returned no release copy.".to_owned())?;
    serde_json::from_str(text)
        .map_err(|error| format!("The drafted copy was not valid JSON: {error}"))
}

fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    // Sending the text through standard input avoids putting the release prompt
    // into a shell command. It also bypasses WebView clipboard permissions,
    // which can be unavailable even when the user presses a visible copy button.
    let mut child = Command::new("/usr/bin/pbcopy")
        // Packaged macOS apps may start without a text locale. Declaring UTF-8
        // prevents punctuation such as em dashes and curly quotes becoming mojibake.
        .env("LANG", "en_US.UTF-8")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not open the macOS clipboard: {error}"))?;
    let mut input = child
        .stdin
        .take()
        .ok_or_else(|| "Could not send text to the macOS clipboard.".to_owned())?;
    input
        .write_all(text.as_bytes())
        .map_err(|error| format!("Could not write to the macOS clipboard: {error}"))?;
    drop(input);
    let status = child
        .wait()
        .map_err(|error| format!("Could not finish copying the text: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("The macOS clipboard did not accept the text.".to_owned())
    }
}

fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let (_, encoded) = data_url
        .split_once(',')
        .ok_or("Artwork data is not a valid data URL.")?;
    BASE64
        .decode(encoded.trim())
        .map_err(|error| error.to_string())
}

fn safe_relative_path(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(format!("Unsafe package path: {relative}"));
    }
    Ok(base.join(path))
}

// A chosen parent may itself be a Finder alias/symlink. Resolve that explicit
// choice, but never follow links inside the generated package: an old or
// imported package must not redirect an update into unrelated user files.
fn package_root(output_dir: &str, folder_name: &str, create: bool) -> Result<PathBuf, String> {
    let parent = Path::new(output_dir)
        .canonicalize()
        .map_err(|error| format!("Could not open the export folder: {error}"))?;
    if !parent.is_dir() {
        return Err("Choose an existing export folder.".into());
    }
    let root = parent.join(safe_file_name(folder_name));
    match fs::symlink_metadata(&root) {
        Ok(info) if info.file_type().is_symlink() || !info.is_dir() => {
            return Err(
                "The release package is not a regular folder. Choose a different export location."
                    .into(),
            )
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
            fs::create_dir(&root).map_err(|error| error.to_string())?;
        }
        Err(error) => return Err(format!("The release package is unavailable: {error}")),
    }
    Ok(root)
}

fn checked_package_file(
    root: &Path,
    relative: &str,
    create_parents: bool,
) -> Result<PathBuf, String> {
    let destination = safe_relative_path(root, relative)?;
    let root_info = fs::symlink_metadata(root).map_err(|error| error.to_string())?;
    if root_info.file_type().is_symlink() || !root_info.is_dir() {
        return Err("The release package is not a regular folder.".into());
    }
    let mut current = root.to_path_buf();
    let components: Vec<_> = Path::new(relative).components().collect();
    for (index, component) in components.iter().enumerate() {
        current.push(component.as_os_str());
        let last = index + 1 == components.len();
        match fs::symlink_metadata(&current) {
            Ok(info) => {
                if info.file_type().is_symlink()
                    || if last {
                        !info.is_file()
                    } else {
                        !info.is_dir()
                    }
                {
                    return Err(format!("Unsafe package destination: {}. Move the linked or incompatible item before exporting.", current.display()));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !last && create_parents {
                    fs::create_dir(&current).map_err(|error| error.to_string())?;
                }
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(destination)
}

fn package_text_path(root: &Path, relative: &str, create_parents: bool) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    let mut parts = path.components();
    let first = parts.next();
    let allowed_folder =
        matches!(first, Some(Component::Normal(name)) if name == "Copy" || name == "Admin");
    let allowed_extension = path.extension().and_then(|value| value.to_str()) == Some("txt")
        || relative == "Admin/Release Data.json";
    if !allowed_folder || !allowed_extension || parts.next().is_none() {
        return Err(format!(
            "Only generated Copy/Admin documents can be updated: {relative}"
        ));
    }
    checked_package_file(root, relative, create_parents)
}

fn write_file_atomically(destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = temporary_audio_path(destination);
    let _cleanup = TemporaryFile(temporary.clone());
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temporary, destination).map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn same_file(left: &Path, right: &Path) -> bool {
    if let (Ok(left), Ok(right)) = (left.canonicalize(), right.canonicalize()) {
        if left == right {
            return true;
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(left), Ok(right)) = (fs::metadata(left), fs::metadata(right)) {
            return left.dev() == right.dev() && left.ino() == right.ino();
        }
    }
    false
}

fn protect_source_files(
    destinations: &[(PathBuf, Option<usize>)],
    sources: &[PathBuf],
) -> Result<(), String> {
    for (destination, allowed_self) in destinations {
        for (index, source) in sources.iter().enumerate() {
            if same_file(destination, source) && *allowed_self != Some(index) {
                return Err(format!("The export would replace an input file at {}. Choose another folder or filename.", source.display()));
            }
        }
    }
    Ok(())
}

// All temporary media and frames are removed on success, error or cancellation.
struct ScratchDirectory(PathBuf, bool);
impl ScratchDirectory {
    fn new(label: &str) -> Result<Self, String> {
        let path =
            std::env::temp_dir().join(format!("{label}-{}", crate::storage::unique_suffix()));
        fs::create_dir(&path).map_err(|error| error.to_string())?;
        Ok(Self(path, false))
    }

    fn keep(mut self) -> PathBuf {
        self.1 = true;
        self.0.clone()
    }
}
impl Drop for ScratchDirectory {
    fn drop(&mut self) {
        if !self.1 {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn add_tag(command: &mut Command, key: &str, value: &str) {
    if !value.trim().is_empty() {
        command
            .arg("-metadata")
            .arg(format!("{key}={}", value.trim()));
    }
}

fn append_track_metadata(command: &mut Command, release: &ReleaseMetadata, track: &TrackMetadata) {
    add_tag(command, "title", &track.title);
    add_tag(command, "artist", &track.artist);
    add_tag(command, "album", &release.album);
    add_tag(command, "album_artist", &release.album_artist);
    add_tag(command, "date", &release.year);
    add_tag(
        command,
        "genre",
        if track.genre.is_empty() {
            &release.genre
        } else {
            &track.genre
        },
    );
    add_tag(command, "composer", &track.composer);
    add_tag(command, "track", &track.track_number);
    add_tag(command, "disc", &track.disc_number);
    add_tag(command, "publisher", &release.label);
    add_tag(command, "CATALOGNUMBER", &release.catalogue);
    add_tag(command, "ISRC", &track.isrc);
    add_tag(command, "copyright", &release.copyright);
    add_tag(command, "comment", &track.comment);
    add_tag(command, "BARCODE", &release.upc);
}

fn ffmpeg_error(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .lines()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" | ")
}

fn temporary_audio_path(destination: &Path) -> PathBuf {
    let stamp = crate::storage::unique_suffix();
    let stem = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("master");
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("audio");
    destination.with_file_name(format!(".{stem}.release-preparer-{stamp}.{extension}"))
}

fn replace_audio_atomically<F>(destination: &Path, write_temporary: F) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    // FFmpeg always writes to a hidden neighbour first. This keeps an earlier
    // good export intact if encoding fails, and it also lets a later export
    // safely read from the same prepared file that it is about to replace.
    let temporary = temporary_audio_path(destination);
    let _cleanup = TemporaryFile(temporary.clone());
    if let Err(error) = write_temporary(&temporary) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    fs::rename(&temporary, destination).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not replace the prepared audio file: {error}")
    })
}

fn export_master_to_path(
    source: &Path,
    destination: &Path,
    artwork: &Path,
    release: &ReleaseMetadata,
    track: &TrackMetadata,
) -> Result<(), String> {
    let source = local_media_file(source)?;
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let supports_embedded_art = matches!(extension.as_str(), "mp3" | "m4a" | "flac");
    let mut command = Command::new(ffmpeg_path());
    command.arg("-y").arg("-i").arg(&source);
    if supports_embedded_art {
        command.arg("-i").arg(artwork);
    }
    command.args(["-map_metadata", "-1", "-map", "0:a:0", "-c:a", "copy"]);
    if supports_embedded_art {
        command.args(["-map", "1:v:0", "-disposition:v:0", "attached_pic"]);
        if extension == "mp3" {
            command.args(["-c:v", "mjpeg", "-id3v2_version", "3", "-write_id3v1", "1"]);
        } else {
            command.args(["-c:v", "copy"]);
        }
    }
    // WAV/AIFF tagging support varies between players, but FFmpeg writes the supported internal text chunks without changing audio samples.
    append_track_metadata(&mut command, release, track);
    command.arg(destination);
    let output = command
        .output()
        .map_err(|error| format!("Could not start ffmpeg: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(ffmpeg_error(&output.stderr))
    }
}

fn export_master(
    source: &Path,
    destination: &Path,
    artwork: &Path,
    release: &ReleaseMetadata,
    track: &TrackMetadata,
) -> Result<(), String> {
    replace_audio_atomically(destination, |temporary| {
        export_master_to_path(source, temporary, artwork, release, track)
    })
}

fn should_encode_mp3(source: &Path) -> bool {
    source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "wav" | "wave" | "aif" | "aiff" | "flac"
            )
        })
        .unwrap_or(false)
}

fn prepared_mp3_file_name(output_name: &str) -> String {
    Path::new(output_name)
        .with_extension("mp3")
        .file_name()
        .and_then(|value| value.to_str())
        .map(safe_file_name)
        .unwrap_or_else(|| "Prepared master.mp3".to_owned())
}

fn export_mp3_to_path(
    source: &Path,
    destination: &Path,
    artwork: &Path,
    release: &ReleaseMetadata,
    track: &TrackMetadata,
) -> Result<(), String> {
    let source = local_media_file(source)?;
    let mut command = Command::new(ffmpeg_path());
    command
        .arg("-y")
        .arg("-i")
        .arg(&source)
        .arg("-i")
        .arg(artwork)
        .args([
            "-map_metadata",
            "-1",
            "-map",
            "0:a:0",
            "-map",
            "1:v:0",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "320k",
            "-compression_level",
            "0",
            "-c:v",
            "mjpeg",
            "-q:v",
            "2",
            "-disposition:v:0",
            "attached_pic",
            "-metadata:s:v",
            "title=Album cover",
            "-metadata:s:v",
            "comment=Cover (Front)",
            "-id3v2_version",
            "3",
        ]);
    append_track_metadata(&mut command, release, track);
    command.arg(destination);
    let output = command
        .output()
        .map_err(|error| format!("Could not start the LAME MP3 encoder: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(ffmpeg_error(&output.stderr))
    }
}

fn export_mp3(
    source: &Path,
    destination: &Path,
    artwork: &Path,
    release: &ReleaseMetadata,
    track: &TrackMetadata,
) -> Result<(), String> {
    replace_audio_atomically(destination, |temporary| {
        export_mp3_to_path(source, temporary, artwork, release, track)
    })
}

fn export_web_artwork(source: &Path, destination: &Path) -> Result<u64, String> {
    const MAX_WEB_ARTWORK_BYTES: u64 = 2_000_000;
    // Start with a high-quality 1600px JPEG. Noisy artwork may compress less
    // efficiently, so later attempts gently reduce quality and dimensions until
    // the result is safely below the common 2 MB upload limit.
    let attempts = [
        (1600, 2),
        (1600, 4),
        (1600, 6),
        (1400, 4),
        (1200, 5),
        (1000, 6),
        (800, 8),
        (600, 10),
    ];
    let temporary = temporary_audio_path(destination);
    let _cleanup = TemporaryFile(temporary.clone());
    let mut last_error = String::new();

    for (size, quality) in attempts {
        let scale = format!("scale={size}:{size}:force_original_aspect_ratio=decrease");
        let quality_text = quality.to_string();
        let output = Command::new(ffmpeg_path())
            .arg("-y")
            .arg("-i")
            .arg(source)
            .args([
                "-vf",
                &scale,
                "-frames:v",
                "1",
                "-c:v",
                "mjpeg",
                "-q:v",
                &quality_text,
                "-pix_fmt",
                "yuvj420p",
            ])
            .arg(&temporary)
            .output()
            .map_err(|error| format!("Could not start the web-artwork encoder: {error}"))?;
        if !output.status.success() {
            last_error = ffmpeg_error(&output.stderr);
            let _ = fs::remove_file(&temporary);
            continue;
        }
        let byte_count = fs::metadata(&temporary)
            .map_err(|error| format!("Could not measure the web artwork: {error}"))?
            .len();
        if byte_count < MAX_WEB_ARTWORK_BYTES {
            fs::rename(&temporary, destination).map_err(|error| {
                let _ = fs::remove_file(&temporary);
                format!("Could not replace the web artwork: {error}")
            })?;
            return Ok(byte_count);
        }
    }

    let _ = fs::remove_file(&temporary);
    Err(format!(
        "Could not create artwork below 2 MB{}",
        if last_error.is_empty() {
            ".".to_owned()
        } else {
            format!(": {last_error}")
        }
    ))
}

fn add_video_layer_input(command: &mut Command, media: &VideoMedia, path: &Path) {
    // Still images need to be held for the whole song. Imported videos loop
    // silently until the master audio ends.
    if media.kind == "video" {
        command.args(["-stream_loop", "-1"]);
    } else {
        command.args(["-loop", "1", "-framerate", "30"]);
    }
    command.arg("-i").arg(path);
}

fn gaussian_sigma_from_control(blur_control: f64) -> f64 {
    // The UI control is an artistic strength scale, not source pixels. At the
    // new maximum, 400px of apparent 4K sigma gives a genuinely drastic blur.
    blur_control.clamp(0.0, 200.0) * 2.0
}

#[derive(Debug, PartialEq)]
pub(crate) struct GaussianBlurPlan {
    width: u32,
    height: u32,
    sigma_per_pass: f64,
    passes: usize,
}

fn gaussian_blur_working_plan(
    blur_control: f64,
    dynamic_background: bool,
) -> Option<GaussianBlurPlan> {
    let sigma_at_4k = gaussian_sigma_from_control(blur_control);
    if sigma_at_4k <= 0.0 {
        return None;
    }

    // Still backgrounds are composited only once, so they can keep a detailed
    // 1920 × 1080, 16-bit working image. Moving backgrounds use a slightly
    // smaller frame at extreme strengths so they remain practical at 30 fps.
    let (width, height) = if dynamic_background && blur_control > 100.0 {
        (960, 540)
    } else if dynamic_background {
        (1280, 720)
    } else {
        (1920, 1080)
    };
    let working_sigma = sigma_at_4k * f64::from(width) / 3840.0;
    // Gaussian variances add. Repeating safe <=28px passes therefore creates
    // one much larger smooth Gaussian without triggering gblur colour faults.
    let passes = ((working_sigma / 28.0).powi(2).ceil() as usize).max(1);
    Some(GaussianBlurPlan {
        width,
        height,
        sigma_per_pass: working_sigma / (passes as f64).sqrt(),
        passes,
    })
}

fn video_filter(
    request: &VideoExportRequest,
    logo_input_index: Option<usize>,
    dynamic_background: bool,
) -> (String, String) {
    let background_opacity = (request.background_opacity / 100.0).clamp(0.0, 1.0);
    let foreground_size = (request.foreground_size / 100.0).clamp(0.2, 1.0);
    let foreground_width = (3840.0 * foreground_size).round() as u32;
    let foreground_height = (2160.0 * foreground_size).round() as u32;
    let background_chain = if let Some(plan) =
        gaussian_blur_working_plan(request.background_blur, dynamic_background)
    {
        // The cover scale expands until both canvas dimensions are filled and
        // crops only the overflow; it never stretches the source aspect ratio.
        let mut chain = format!(
            "scale={}:{}:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd+full_chroma_int,crop={}:{},setsar=1,format=gbrp16le",
            plan.width, plan.height, plan.width, plan.height
        );
        for _ in 0..plan.passes {
            chain.push_str(&format!(",gblur=sigma={:.2}:steps=3", plan.sigma_per_pass));
        }
        // gradfun adds extremely subtle dithering while converting the smooth
        // 16-bit gradient back to delivery colour, preventing visible bands.
        chain.push_str(
            ",scale=3840:2160:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv444p,gradfun=strength=1.2:radius=16,format=rgba",
        );
        chain
    } else {
        "scale=3840:2160:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd+full_chroma_int,crop=3840:2160,setsar=1,format=rgba".to_owned()
    };
    let mut filter = format!(
        "color=c=black:s=3840x2160:r=30[base];\
         [0:v]{background_chain},format=rgba,colorchannelmixer=aa={background_opacity:.3}[bg];\
         [base][bg]overlay=shortest=1[scene];\
         [1:v]scale={foreground_width}:{foreground_height}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int,setsar=1,format=rgba[fg]"
    );
    let shadow_intensity = (request.foreground_shadow_intensity / 100.0).clamp(0.0, 1.0);
    if request.foreground_shadow_enabled && shadow_intensity > 0.0 {
        let shadow_opacity = shadow_intensity * 0.8;
        let shadow_sigma = 8.0 + shadow_intensity * 27.0;
        let shadow_offset_y = (4.0 + shadow_intensity * 28.0).round() as i32;
        let shadow_padding = (shadow_sigma * 3.0).ceil() as u32;
        filter.push_str(&format!(
            ";[fg]split=2[fg-shadow-source][fg-main];\
             [fg-shadow-source]pad=iw+{padding}:ih+{padding}:{half}:{half}:color=black@0,colorchannelmixer=rr=0:gg=0:bb=0:aa={shadow_opacity:.3},gblur=sigma={shadow_sigma:.2}:steps=3[shadow];\
             [scene][shadow]overlay=(W-w)/2:(H-h)/2+{shadow_offset_y}[shadowed];\
             [shadowed][fg-main]overlay=(W-w)/2:(H-h)/2[foreground]",
            padding = shadow_padding * 2,
            half = shadow_padding,
        ));
    } else {
        filter.push_str(";[scene][fg]overlay=(W-w)/2:(H-h)/2[foreground]");
    }
    if let Some(input_index) = logo_input_index {
        let logo_width = (3840.0 * (request.logo_size / 100.0).clamp(0.02, 0.3)).round() as u32;
        let logo_opacity = (request.logo_opacity / 100.0).clamp(0.0, 1.0);
        let logo_x = (request.logo_x / 100.0).clamp(0.0, 1.0);
        let logo_y = (request.logo_y / 100.0).clamp(0.0, 1.0);
        filter.push_str(&format!(
            ";[{input_index}:v]scale={logo_width}:-1,format=rgba,colorchannelmixer=aa={logo_opacity:.3}[logo];\
             [foreground][logo]overlay=(W-w)*{logo_x:.3}:(H-h)*{logo_y:.3}[finished]"
        ));
        (filter, "[finished]".to_owned())
    } else {
        (filter, "[foreground]".to_owned())
    }
}

fn render_static_video_frame(
    background: &Path,
    foreground: &Path,
    logo: Option<&Path>,
    destination: &Path,
    request: &VideoExportRequest,
) -> Result<(), String> {
    // Still artwork does not change from frame to frame. Compositing it once
    // avoids recalculating the 4K scale, crop, Gaussian blur, and overlays for
    // every frame of every song on the release.
    let mut command = Command::new(ffmpeg_path());
    command
        .arg("-y")
        .arg("-i")
        .arg(background)
        .arg("-i")
        .arg(foreground);
    if let Some(logo_path) = logo {
        command.arg("-i").arg(logo_path);
    }
    let (filter, output_label) = video_filter(request, logo.map(|_| 2), false);
    let output = command
        .args([
            "-filter_complex",
            &filter,
            "-map",
            &output_label,
            "-frames:v",
            "1",
            "-update",
            "1",
        ])
        .arg(destination)
        .output()
        .map_err(|error| format!("Could not prepare the reusable 4K video frame: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let _ = fs::remove_file(destination);
        Err(ffmpeg_error(&output.stderr))
    }
}

fn supports_video_toolbox() -> bool {
    Command::new(ffmpeg_path())
        .args(["-hide_banner", "-h", "encoder=h264_videotoolbox"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn rec709_delivery_filter() -> &'static str {
    // The preview canvas is displayed as ordinary full-range sRGB. FFmpeg can
    // otherwise choose an older television matrix while turning that RGB image
    // into YUV video, then merely label the result as Rec.709. That mismatch is
    // visible in macOS video players as a small green or magenta colour cast.
    // This filter performs the conversion explicitly and leaves complete colour
    // information on every frame for the H.264 encoder and MP4 container.
    // No final dithering is added here: the blur pipeline already debands its
    // gradients, and changing the dither pattern on every repeated still frame
    // would make a visually static video unnecessarily large.
    "format=gbrp,colorspace=ispace=gbr:itrc=srgb:iprimaries=bt709:irange=pc:space=bt709:trc=bt709:primaries=bt709:range=tv:format=yuv420p"
}

pub(crate) struct VideoVisualSources<'a> {
    background: (&'a VideoMedia, &'a Path),
    foreground: (&'a VideoMedia, &'a Path),
    logo: Option<&'a Path>,
    static_frame: Option<&'a Path>,
    use_video_toolbox: bool,
}

fn export_track_video<F>(
    visual: &VideoVisualSources<'_>,
    audio: (&Path, f64),
    destination: &Path,
    request: &VideoExportRequest,
    cancel: &AtomicBool,
    mut report_progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    if cancel.load(Ordering::Relaxed) {
        return Err(VIDEO_EXPORT_CANCELLED.to_owned());
    }
    let audio_source = local_media_file(audio.0)?;
    let mut command = Command::new(ffmpeg_path());
    command.arg("-y");
    let (video_map, audio_map, filter) = if let Some(frame) = visual.static_frame {
        command
            .args(["-loop", "1", "-framerate", "30"])
            .arg("-i")
            .arg(frame);
        command.arg("-i").arg(&audio_source);
        (
            "[delivery]".to_owned(),
            "1:a:0".to_owned(),
            Some(format!("[0:v]{}[delivery]", rec709_delivery_filter())),
        )
    } else {
        add_video_layer_input(&mut command, visual.background.0, visual.background.1);
        add_video_layer_input(&mut command, visual.foreground.0, visual.foreground.1);
        command.arg("-i").arg(&audio_source);
        if let Some(logo_path) = visual.logo {
            command
                .args(["-loop", "1", "-framerate", "30"])
                .arg("-i")
                .arg(logo_path);
        }
        let (mut filter, output_label) = video_filter(request, visual.logo.map(|_| 3), true);
        // Moving-image projects use the same final colour conversion as the
        // optimized still-frame path, after all artwork and logo layers have
        // been combined into one RGB picture.
        filter.push_str(&format!(
            ";{output_label}{}[delivery]",
            rec709_delivery_filter()
        ));
        ("[delivery]".to_owned(), "2:a:0".to_owned(), Some(filter))
    };

    let temporary = temporary_audio_path(destination);
    let _cleanup = TemporaryFile(temporary.clone());
    if let Some(filter) = &filter {
        command.args(["-filter_complex", filter]);
    }
    command.args(["-map", &video_map, "-map", &audio_map]);
    if visual.use_video_toolbox {
        // Apple Silicon performs this encode in dedicated media hardware. The
        // bitrate range is suitable for a high-quality 4K YouTube upload.
        command.args([
            "-c:v",
            "h264_videotoolbox",
            "-profile:v",
            "high",
            "-level:v",
            "5.1",
            "-b:v",
            "35M",
            "-maxrate",
            "45M",
            "-bufsize",
            "70M",
            "-coder",
            "cabac",
            "-spatial_aq",
            "1",
            "-prio_speed",
            "0",
            "-allow_sw",
            "1",
        ]);
    } else if visual.static_frame.is_some() {
        // CRF encoding lets the one detailed artwork frame use the data it
        // needs while repeated unchanged frames stay tiny. This is sharper and
        // usually much smaller than forcing a high constant 4K bitrate.
        command.args([
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "stillimage",
            "-crf",
            "16",
        ]);
    } else {
        // Keep a capable software fallback for FFmpeg builds without Apple's
        // encoder, but avoid the old slow preset that took hours at 4K.
        command.args(["-c:v", "libx264", "-preset", "fast", "-crf", "18"]);
    }
    let mut child = command
        .args([
            "-pix_fmt",
            "yuv420p",
            "-color_range",
            "tv",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-r",
            "30",
            "-c:a",
            "aac",
            "-b:a",
            "320k",
            "-movflags",
            "+faststart+write_colr",
            "-shortest",
            // FFmpeg writes machine-readable elapsed-time updates to stdout.
            // This is separate from its error output, so the app can show a
            // real percentage without scraping human-oriented console text.
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(&temporary)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the 4K video encoder: {error}"))?;

    // Error output is drained on its own small thread. If it filled its pipe,
    // FFmpeg could otherwise pause while the main worker reads progress.
    let stderr = child.stderr.take();
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stream) = stderr {
            let _ = stream.read_to_end(&mut bytes);
        }
        bytes
    });
    let mut was_cancelled = false;
    if let Some(stdout) = child.stdout.take() {
        let total_microseconds = (audio.1.max(0.001) * 1_000_000.0).max(1.0);
        let mut last_percent = -1.0;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                was_cancelled = true;
                break;
            }
            if let Some(value) = line.strip_prefix("out_time_us=") {
                if let Ok(microseconds) = value.parse::<f64>() {
                    // Keep the final 100% for a successful process exit and
                    // atomic rename, since encoding output alone is not enough.
                    let percent = (microseconds / total_microseconds * 100.0).clamp(0.0, 99.5);
                    if percent - last_percent >= 0.25 {
                        last_percent = percent;
                        report_progress(percent);
                    }
                }
            }
        }
    }
    if cancel.load(Ordering::Relaxed) && !was_cancelled {
        let _ = child.kill();
        was_cancelled = true;
    }
    let status = child
        .wait()
        .map_err(|error| format!("Could not wait for the 4K video encoder: {error}"))?;
    let stderr = stderr_reader.join().unwrap_or_default();
    if was_cancelled {
        let _ = fs::remove_file(&temporary);
        return Err(VIDEO_EXPORT_CANCELLED.to_owned());
    }
    if !status.success() {
        let _ = fs::remove_file(&temporary);
        return Err(ffmpeg_error(&stderr));
    }
    report_progress(100.0);
    fs::rename(&temporary, destination).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not finish the video file: {error}")
    })
}

fn export_track_videos_with_cancel<F>(
    request: VideoExportRequest,
    cancel: Arc<AtomicBool>,
    mut report_progress: F,
) -> Result<VideoExportResult, String>
where
    F: FnMut(VideoExportProgress),
{
    if request.tracks.is_empty() {
        return Err("Add at least one master before exporting videos.".to_owned());
    }
    let total = request.tracks.len();
    report_progress(VideoExportProgress {
        export_id: request.export_id.clone(),
        completed: 0,
        total,
        current_track: String::new(),
        phase: "preparing".to_owned(),
        track_percent: 0.0,
    });
    let root = package_root(&request.output_dir, &request.folder_name, true)?;
    let videos_dir = root.join("Videos");
    let mut sources: Vec<_> = request
        .tracks
        .iter()
        .map(|track| PathBuf::from(&track.path))
        .collect();
    for media in [&request.foreground, &request.background] {
        if !media.uses_artwork {
            sources.push(PathBuf::from(&media.path));
        }
    }
    let mut destinations = Vec::new();
    for track in &request.tracks {
        destinations.push((
            checked_package_file(
                &root,
                &format!("Videos/{}", safe_file_name(&track.output_file_name)),
                false,
            )?,
            None,
        ));
    }
    protect_source_files(&destinations, &sources)?;
    checked_package_file(&root, "Videos/.directory-check", true)?;

    let scratch = ScratchDirectory::new("release-preparer-video")?;
    let temporary_dir = &scratch.0;
    let artwork_path = temporary_dir.join("album-artwork.png");
    fs::write(&artwork_path, decode_data_url(&request.artwork_data_url)?)
        .map_err(|error| error.to_string())?;
    let logo_path = if request.logo_enabled && !request.logo_data_url.is_empty() {
        let path = temporary_dir.join("label-logo.png");
        fs::write(&path, decode_data_url(&request.logo_data_url)?)
            .map_err(|error| error.to_string())?;
        Some(path)
    } else {
        None
    };
    let layer_path = |media: &VideoMedia| -> Result<PathBuf, String> {
        let path = if media.uses_artwork {
            artwork_path.clone()
        } else {
            PathBuf::from(&media.path)
        };
        local_media_file(&path)
    };
    let background_path = layer_path(&request.background)?;
    let foreground_path = layer_path(&request.foreground)?;
    if cancel.load(Ordering::Relaxed) {
        let _ = fs::remove_dir_all(&temporary_dir);
        return Ok(VideoExportResult {
            destination: videos_dir.to_string_lossy().into_owned(),
            exported: 0,
            failed: 0,
            message: VIDEO_EXPORT_CANCELLED.to_owned(),
            encoder: String::new(),
            cancelled: true,
        });
    }
    let static_frame = if request.background.kind != "video" && request.foreground.kind != "video" {
        report_progress(VideoExportProgress {
            export_id: request.export_id.clone(),
            completed: 0,
            total,
            current_track: "Reusable 4K artwork frame".to_owned(),
            phase: "compositing".to_owned(),
            track_percent: 0.0,
        });
        let path = temporary_dir.join("video-frame.png");
        render_static_video_frame(
            &background_path,
            &foreground_path,
            logo_path.as_deref(),
            &path,
            &request,
        )?;
        if cancel.load(Ordering::Relaxed) {
            let _ = fs::remove_dir_all(&temporary_dir);
            return Ok(VideoExportResult {
                destination: videos_dir.to_string_lossy().into_owned(),
                exported: 0,
                failed: 0,
                message: VIDEO_EXPORT_CANCELLED.to_owned(),
                encoder: String::new(),
                cancelled: true,
            });
        }
        Some(path)
    } else {
        None
    };
    // Hardware acceleration remains best for moving visual sources. For a
    // reusable still frame, libx264's still-image mode retains far more detail
    // at a smaller file size and remains comfortably faster than real time.
    let use_video_toolbox = static_frame.is_none() && supports_video_toolbox();
    let visual = VideoVisualSources {
        background: (&request.background, &background_path),
        foreground: (&request.foreground, &foreground_path),
        logo: logo_path.as_deref(),
        static_frame: static_frame.as_deref(),
        use_video_toolbox,
    };

    let mut exported = 0;
    let mut failed = 0;
    let mut cancelled = false;
    let mut errors = Vec::new();
    let mut output_names = HashMap::new();
    for track in &request.tracks {
        let output_name = safe_file_name(&track.output_file_name);
        *output_names
            .entry(output_name.to_lowercase())
            .or_insert(0usize) += 1;
    }
    for (index, track) in request.tracks.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let source = PathBuf::from(&track.path);
        let output_name = safe_file_name(&track.output_file_name);
        report_progress(VideoExportProgress {
            export_id: request.export_id.clone(),
            completed: index,
            total,
            current_track: output_name.clone(),
            phase: "encoding".to_owned(),
            track_percent: 0.0,
        });
        if output_names
            .get(&output_name.to_lowercase())
            .copied()
            .unwrap_or_default()
            > 1
        {
            failed += 1;
            errors.push(format!("{output_name}: duplicate video filename"));
            report_progress(VideoExportProgress {
                export_id: request.export_id.clone(),
                completed: index + 1,
                total,
                current_track: output_name,
                phase: "processed".to_owned(),
                track_percent: 100.0,
            });
            continue;
        }
        let destination = checked_package_file(&root, &format!("Videos/{output_name}"), true)?;
        match export_track_video(
            &visual,
            (&source, track.duration_seconds),
            &destination,
            &request,
            &cancel,
            |track_percent| {
                report_progress(VideoExportProgress {
                    export_id: request.export_id.clone(),
                    completed: index,
                    total,
                    current_track: output_name.clone(),
                    phase: "encoding".to_owned(),
                    track_percent,
                });
            },
        ) {
            Ok(()) => exported += 1,
            Err(error) if error == VIDEO_EXPORT_CANCELLED => {
                cancelled = true;
                break;
            }
            Err(error) => {
                failed += 1;
                errors.push(format!("{output_name}: {error}"));
            }
        }
        report_progress(VideoExportProgress {
            export_id: request.export_id.clone(),
            completed: index + 1,
            total,
            current_track: output_name,
            phase: "processed".to_owned(),
            track_percent: 100.0,
        });
    }
    let _ = fs::remove_dir_all(temporary_dir);
    let result = VideoExportResult {
        destination: videos_dir.to_string_lossy().into_owned(),
        exported,
        failed,
        message: if cancelled {
            VIDEO_EXPORT_CANCELLED.to_owned()
        } else {
            errors.join("; ")
        },
        encoder: if use_video_toolbox {
            "Apple VideoToolbox hardware H.264".to_owned()
        } else if static_frame.is_some() {
            "libx264 high-quality still-image H.264".to_owned()
        } else {
            "libx264 software H.264 fallback".to_owned()
        },
        cancelled,
    };
    report_progress(VideoExportProgress {
        export_id: request.export_id,
        completed: if cancelled { exported + failed } else { total },
        total,
        current_track: String::new(),
        phase: if cancelled { "cancelled" } else { "finished" }.to_owned(),
        track_percent: 100.0,
    });
    Ok(result)
}

#[cfg(test)]
fn export_track_videos_with_progress<F>(
    request: VideoExportRequest,
    report_progress: F,
) -> Result<VideoExportResult, String>
where
    F: FnMut(VideoExportProgress),
{
    export_track_videos_with_cancel(request, Arc::new(AtomicBool::new(false)), report_progress)
}

async fn export_track_videos(
    app: tauri::AppHandle,
    request: VideoExportRequest,
) -> Result<VideoExportResult, String> {
    // FFmpeg is deliberately moved off Tauri's command thread. This keeps the
    // app responsive so progress events can repaint while a long 4K encode is
    // running instead of making the whole window appear frozen.
    let active = ActiveVideoExport::register(&request.export_id)?;
    let cancel = Arc::clone(&active.cancel);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        export_track_videos_with_cancel(request, cancel, |progress| {
            let _ = app.emit("release-preparer://video-export-progress", progress);
        })
    })
    .await;
    outcome.map_err(|error| format!("The video export worker stopped unexpectedly: {error}"))?
}

fn cancel_video_export(export_id: String) -> Result<bool, String> {
    let registry = video_export_cancellations()
        .lock()
        .map_err(|_| "Could not access the active video export.".to_owned())?;
    let Some(cancel) = registry.get(&export_id) else {
        return Ok(false);
    };
    cancel.store(true, Ordering::Relaxed);
    Ok(true)
}

pub(crate) struct CanvasRandom(u32);

impl CanvasRandom {
    fn new(seed: u32) -> Self {
        Self(seed.max(1))
    }

    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        f64::from(self.0) / f64::from(u32::MAX)
    }
}

fn safe_canvas_colour(value: &str) -> String {
    let value = value.trim().trim_start_matches('#');
    if value.len() == 6 && value.chars().all(|character| character.is_ascii_hexdigit()) {
        format!("0x{value}")
    } else {
        "0x111315".to_owned()
    }
}

fn even_dimension(value: f64) -> u32 {
    ((value.max(2.0).round() as u32) / 2) * 2
}

fn canvas_composition_filter(request: &CanvasExportRequest) -> String {
    // The composition is first made at 648 × 1152. That 12.5% margin is the
    // physical-film overscan used later for weave and rotation, so black edges
    // cannot enter the final 576 × 1024 crop.
    const WIDTH: u32 = 648;
    const HEIGHT: u32 = 1152;
    let position_x = (request.position_x / 100.0).clamp(0.0, 1.0);
    let position_y = (request.position_y / 100.0).clamp(0.0, 1.0);
    let scale = (request.image_scale / 100.0).clamp(0.8, 1.6);
    if matches!(request.composition_mode.as_str(), "fill" | "crop") {
        let fill_scale = scale.max(1.0);
        return format!(
            "[0:v]scale={target_width}:{target_height}:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd+full_chroma_int,crop={WIDTH}:{HEIGHT}:x='(in_w-{WIDTH})*{position_x:.6}':y='(in_h-{HEIGHT})*{position_y:.6}',setsar=1[composed]",
            target_width = even_dimension(f64::from(WIDTH) * fill_scale),
            target_height = even_dimension(f64::from(HEIGHT) * fill_scale),
        );
    }

    let artwork_mode = request.composition_mode == "artwork-background";
    let foreground_width =
        even_dimension(f64::from(WIDTH) * if artwork_mode { 0.84 } else { 0.94 } * scale);
    let foreground_height =
        even_dimension(f64::from(HEIGHT) * if artwork_mode { 0.74 } else { 0.94 } * scale);
    let foreground = format!(
        "scale={foreground_width}:{foreground_height}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int,setsar=1[fg]"
    );
    let overlay = format!(
        "[bg][fg]overlay=x='(main_w-overlay_w)*{position_x:.6}':y='(main_h-overlay_h)*{position_y:.6}':shortest=1[composed]"
    );
    match request.background_treatment.as_str() {
        "solid" => format!(
            "color=c={colour}:s={WIDTH}x{HEIGHT}:r={rate}:d={duration:.6}[bg];[0:v]{foreground};{overlay}",
            colour = safe_canvas_colour(&request.background_color),
            rate = request.film_frame_rate,
            duration = request.duration_seconds,
        ),
        "darkened" => format!(
            "[0:v]split=2[bg-source][fg-source];[bg-source]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop={WIDTH}:{HEIGHT},eq=brightness=-0.26:saturation=0.72[bg];[fg-source]{foreground};{overlay}"
        ),
        _ => format!(
            "[0:v]split=2[bg-source][fg-source];[bg-source]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop={WIDTH}:{HEIGHT},gblur=sigma=26:steps=3,eq=brightness=-0.16:saturation=0.80[bg];[fg-source]{foreground};{overlay}"
        ),
    }
}

fn wrapped_event_enable(birth: f64, lifespan: f64, duration: f64) -> String {
    format!("lt(mod(t-{birth:.6}+{duration:.6}\\,{duration:.6})\\,{lifespan:.6})")
}

fn append_canvas_events(
    filter: &mut String,
    request: &CanvasExportRequest,
    seed: u32,
    duration: f64,
) {
    let mut random = CanvasRandom::new(seed ^ request.seed);
    let film_rate = f64::from(request.film_frame_rate.max(1));
    let dust_amount = (request.dust_amount / 100.0).clamp(0.0, 1.0);
    let dust_count = (duration * (1.4 + dust_amount * 7.4)).round() as usize;
    // Each mark has a circular lifespan. A speck born near the last frame can
    // continue into the first frames instead of being cut off by the seam.
    for _ in 0..dust_count.min(56) {
        let birth = random.next() * duration;
        let frames = if random.next() < 0.74 {
            1.0
        } else {
            2.0 + (random.next() * 3.0).floor()
        };
        let lifespan = frames / film_rate;
        let x = 10 + (random.next() * 556.0).round() as u32;
        let y = 10 + (random.next() * 1004.0).round() as u32;
        let size = 1 + (random.next() * (1.0 + dust_amount * 4.0)).round() as u32;
        let opacity = 0.06 + random.next() * (0.09 + dust_amount * 0.12);
        let colour = if random.next() < 0.36 {
            "black"
        } else {
            "ivory"
        };
        let enable = wrapped_event_enable(birth, lifespan, duration);
        filter.push_str(&format!(
            ",drawbox=x={x}:y={y}:w={width}:h={height}:color={colour}@{opacity:.4}:t=fill:enable='{enable}'",
            width = size + 1,
            height = size.max(1),
        ));
    }

    if random.next() < (request.scratch_probability / 100.0).clamp(0.0, 1.0) {
        let birth = random.next() * duration;
        let lifespan_frames = 4.0 + (request.scratch_persistence / 100.0).clamp(0.0, 1.0) * 26.0;
        let enable = wrapped_event_enable(birth, lifespan_frames / film_rate, duration);
        let x = 42 + (random.next() * 492.0).round() as u32;
        let opacity = 0.035 + random.next() * 0.09;
        for section in 0..5 {
            let y = 36 + section * 198 + ((random.next() - 0.5) * 18.0).round() as i32;
            let offset = ((random.next() - 0.5) * 3.0).round() as i32;
            filter.push_str(&format!(
                ",drawbox=x={scratch_x}:y={y}:w=1:h={height}:color=ivory@{opacity:.4}:t=fill:enable='{enable}'",
                scratch_x = i64::from(x) + i64::from(offset),
                height = 108 + (random.next() * 42.0).round() as u32,
            ));
        }
    }

    // The remaining events are deliberately probabilistic and disabled by the
    // subtle presets. They are fragments rather than large stock overlays.
    if random.next() < (request.hair_probability / 100.0 * 0.45).clamp(0.0, 1.0) {
        let enable = wrapped_event_enable(random.next() * duration, 14.0 / film_rate, duration);
        let base_x = 80 + (random.next() * 410.0).round() as u32;
        for section in 0..5 {
            filter.push_str(&format!(
                ",drawbox=x={x}:y={y}:w=1:h=150:color=black@0.10:t=fill:enable='{enable}'",
                x = base_x + section * 5,
                y = section * 170,
            ));
        }
    }
    if random.next() < (request.damage_probability / 100.0 * 0.35).clamp(0.0, 1.0) {
        let enable = wrapped_event_enable(random.next() * duration, 4.0 / film_rate, duration);
        let x = 30 + (random.next() * 500.0).round() as u32;
        let y = 30 + (random.next() * 920.0).round() as u32;
        for fragment in 0..4 {
            filter.push_str(&format!(
                ",drawbox=x={fragment_x}:y={fragment_y}:w={width}:h={height}:color=ivory@0.08:t=fill:enable='{enable}'",
                fragment_x = x + fragment * 7,
                fragment_y = y + (fragment % 2) * 6,
                width = 7 + fragment * 3,
                height = 3 + (fragment % 3) * 4,
            ));
        }
    }
    if random.next() < (request.light_leak_probability / 100.0 * 0.5).clamp(0.0, 1.0) {
        let enable = wrapped_event_enable(random.next() * duration, 12.0 / film_rate, duration);
        let left = random.next() < 0.5;
        filter.push_str(&format!(
            ",drawbox=x={x}:y=0:w=86:h=1024:color=orange@0.045:t=fill:enable='{enable}'",
            x = if left { 0 } else { 490 },
        ));
    }
    let cue_probability = match request.cue_marks.as_str() {
        "always" => 1.0,
        "rare" => 0.2,
        _ => 0.0,
    };
    if random.next() < cue_probability {
        let enable = wrapped_event_enable(random.next() * duration, 4.0 / film_rate, duration);
        for (x, y, w, h) in [
            (468, 112, 28, 2),
            (468, 138, 28, 2),
            (468, 112, 2, 28),
            (494, 112, 2, 28),
        ] {
            filter.push_str(&format!(
                ",drawbox=x={x}:y={y}:w={w}:h={h}:color=ivory@0.13:t=fill:enable='{enable}'"
            ));
        }
    }
}

fn canvas_effect_filter(request: &CanvasExportRequest, seed: u32) -> String {
    let duration = request.duration_seconds.clamp(3.0, 8.0);
    let intensity = (request.intensity / 100.0).clamp(0.0, 1.0);
    let low_activity = 0.34 + intensity * 0.86;
    let format_factor = match request.film_format.as_str() {
        "35mm" => 0.78,
        "8mm" => 1.32,
        _ => 1.0,
    };
    let condition_factor = match request.film_condition.as_str() {
        "clean" => 0.72,
        "worn" => 1.18,
        "aged" => 1.28,
        "damaged" => 1.48,
        _ => 1.0,
    };
    let horizontal =
        (0.22 + request.horizontal_weave / 100.0 * 2.6) * low_activity * condition_factor;
    let vertical = (0.26 + request.vertical_jitter / 100.0 * 3.3) * low_activity * condition_factor;
    let rotation = (0.008 + request.rotation / 100.0 * 0.14) * low_activity * condition_factor;
    let scale_breathing = (0.0002 + request.scale_breathing / 100.0 * 0.0012) * low_activity;
    let flicker = (0.003 + request.exposure_flicker / 100.0 * 0.022) * low_activity;
    let phase = f64::from(seed % 100_000) / 100_000.0 * std::f64::consts::TAU;
    let phase_two = phase * 0.617 + 0.73;
    let phase_three = phase * 1.371 + 1.19;
    let composition = canvas_composition_filter(request);
    let mut filter = format!(
        "{composition};[composed]format=gbrp,scale=w='iw*(1+{scale_breathing:.8}*(0.62*sin(2*PI*t/{duration:.6}+{phase:.6})+0.38*sin(4*PI*t/{duration:.6}+{phase_two:.6})))':h='ih*(1+{scale_breathing:.8}*(0.62*sin(2*PI*t/{duration:.6}+{phase:.6})+0.38*sin(4*PI*t/{duration:.6}+{phase_two:.6})))':eval=frame:flags=lanczos[breathing];[breathing]rotate='{rotation:.8}*(0.58*sin(2*PI*t/{duration:.6}+{phase:.6})+0.28*sin(4*PI*t/{duration:.6}+{phase_two:.6})+0.14*sin(8*PI*t/{duration:.6}+{phase_three:.6}))*PI/180':ow=iw:oh=ih:c=black,crop=576:1024:x='(in_w-out_w)/2+{horizontal:.6}*(0.57*sin(2*PI*t/{duration:.6}+{phase:.6})+0.29*sin(4*PI*t/{duration:.6}+{phase_two:.6})+0.14*sin(10*PI*t/{duration:.6}+{phase_three:.6}))':y='(in_h-out_h)/2+{vertical:.6}*(0.55*sin(2*PI*t/{duration:.6}+{phase_two:.6})+0.30*sin(6*PI*t/{duration:.6}+{phase:.6})+0.15*sin(14*PI*t/{duration:.6}+{phase_three:.6}))'[registered];[registered]eq=brightness='{flicker:.8}*(0.50*sin(2*PI*t/{duration:.6}+{phase:.6})+0.28*sin(4*PI*t/{duration:.6}+{phase_two:.6})+0.14*sin(12*PI*t/{duration:.6}+{phase_three:.6})+0.08*sin(34*PI*t/{duration:.6}+{phase_two:.6}))':contrast={contrast:.6}:eval=frame[exposed]",
        contrast = 1.0 + intensity * 0.018,
    );
    if request.monochrome {
        filter.push_str(";[exposed]hue=s=0[toned]");
    } else {
        let hue = (request.colour_instability / 100.0).clamp(0.0, 1.0) * 0.55;
        filter.push_str(&format!(
            ";[exposed]hue=h='{hue:.6}*(0.65*sin(2*PI*t/{duration:.6}+{phase_two:.6})+0.35*sin(4*PI*t/{duration:.6}+{phase_three:.6}))':s={saturation:.6}[toned]",
            saturation = 1.0 - intensity * 0.025,
        ));
    }
    let softness = 0.18
        + (request.optical_softness / 100.0).clamp(0.0, 1.0) * 0.72
        + (format_factor - 0.78) * 0.18;
    filter.push_str(&format!(
        ";[toned]gblur=sigma={softness:.5}:steps=1[softened]"
    ));
    let halation = (request.halation / 100.0).clamp(0.0, 1.0) * 0.06;
    if halation > 0.0001 {
        filter.push_str(&format!(
            ";[softened]split=2[film-base][halo-source];[halo-source]lutyuv=y='clip((val-175)*3\\,0\\,255)':u=128:v=128,gblur=sigma={halo_radius:.4}:steps=2,colorbalance=rs=0.045:gs=0.012:bs=-0.018[halo];[film-base][halo]blend=all_mode=screen:all_opacity={halation:.6}[material]",
            halo_radius = 2.0 + request.halation / 100.0 * 5.0,
        ));
    } else {
        filter.push_str(";[softened]null[material]");
    }
    let clumping = (request.grain_clumping / 100.0).clamp(0.0, 1.0);
    let grain = ((request.grain_amount / 100.0).clamp(0.0, 1.0)
        * (0.42 + intensity * 0.86)
        * (12.0 + clumping * 4.0)
        * format_factor
        * condition_factor.min(1.35))
    .round() as u32;
    let grain_softness =
        0.04 + (request.grain_size / 100.0).clamp(0.0, 1.0) * 0.12 + clumping * 0.08;
    let vignette_denominator = 8.4 - (request.vignette / 100.0).clamp(0.0, 1.0) * 3.2;
    filter.push_str(&format!(
        ";[material]noise=alls={grain}:allf=t+u:all_seed={noise_seed},gblur=sigma={grain_softness:.5}:steps=1,vignette=PI/{vignette_denominator:.5}",
        noise_seed = seed ^ request.seed,
    ));
    append_canvas_events(&mut filter, request, seed, duration);
    filter.push(',');
    filter.push_str(rec709_delivery_filter());
    filter.push_str("[canvasout]");
    filter
}

fn validate_canvas_output(path: &Path, duration: f64, frame_rate: u32) -> Result<(), String> {
    let probe = Command::new(ffprobe_path())
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,color_range,color_space,color_transfer,color_primaries:format=duration",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|error| format!("Could not inspect the finished Canvas: {error}"))?;
    if !probe.status.success() {
        return Err(ffmpeg_error(&probe.stderr));
    }
    let details: Value = serde_json::from_slice(&probe.stdout)
        .map_err(|error| format!("Could not read Canvas validation details: {error}"))?;
    let streams = details
        .get("streams")
        .and_then(Value::as_array)
        .ok_or_else(|| "The finished Canvas has no readable video stream.".to_owned())?;
    if streams
        .iter()
        .any(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("audio"))
    {
        return Err("The finished Canvas unexpectedly contains an audio stream.".to_owned());
    }
    let video = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(Value::as_str) == Some("video"))
        .ok_or_else(|| "The finished Canvas has no video stream.".to_owned())?;
    let property = |name: &str| video.get(name).and_then(Value::as_str);
    if video.get("width").and_then(Value::as_u64) != Some(576)
        || video.get("height").and_then(Value::as_u64) != Some(1024)
    {
        return Err(
            "Canvas validation failed: output must be exactly 576 × 1024 (9:16).".to_owned(),
        );
    }
    if property("codec_name") != Some("h264") || property("pix_fmt") != Some("yuv420p") {
        return Err("Canvas validation failed: output must be H.264 yuv420p.".to_owned());
    }
    for (name, expected) in [
        ("color_range", "tv"),
        ("color_space", "bt709"),
        ("color_transfer", "bt709"),
        ("color_primaries", "bt709"),
    ] {
        if property(name) != Some(expected) {
            return Err(format!(
                "Canvas validation failed: {name} must be {expected}."
            ));
        }
    }
    let actual_duration = details
        .pointer("/format/duration")
        .and_then(Value::as_str)
        .and_then(|value| value.parse::<f64>().ok())
        .ok_or_else(|| "Canvas validation could not read the output duration.".to_owned())?;
    let tolerance = 2.0 / f64::from(frame_rate.max(1));
    if (actual_duration - duration).abs() > tolerance || !(3.0..=8.1).contains(&actual_duration) {
        return Err(format!(
            "Canvas validation failed: expected {duration:.2} seconds but encoded {actual_duration:.2} seconds."
        ));
    }
    Ok(())
}

fn export_canvas_variant<F>(
    source: &Path,
    destination: &Path,
    request: &CanvasExportRequest,
    variant: &CanvasVariant,
    cancel: &AtomicBool,
    mut report_progress: F,
) -> Result<(), String>
where
    F: FnMut(f64),
{
    if cancel.load(Ordering::Relaxed) {
        return Err(VIDEO_EXPORT_CANCELLED.to_owned());
    }
    let duration = request.duration_seconds.clamp(3.0, 8.0);
    let film_frame_rate = request.film_frame_rate.clamp(18, 30);
    let output_frame_rate = if request.output_frame_rate == 30 {
        30
    } else {
        24
    };
    let output_frames = (duration * f64::from(output_frame_rate)).round() as u32;
    let temporary = temporary_audio_path(destination);
    let _cleanup = TemporaryFile(temporary.clone());
    let filter = canvas_effect_filter(request, variant.seed);
    let mut child = Command::new(ffmpeg_path())
        .args(["-y", "-loop", "1", "-framerate"])
        .arg(film_frame_rate.to_string())
        .arg("-i")
        .arg(source)
        .args(["-filter_complex", &filter, "-map", "[canvasout]"])
        .args(["-frames:v", &output_frames.to_string()])
        .args([
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-tune",
            "grain",
            "-crf",
            "17",
            "-pix_fmt",
            "yuv420p",
            "-color_range",
            "tv",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-r",
            &output_frame_rate.to_string(),
            "-movflags",
            "+faststart+write_colr",
            "-progress",
            "pipe:1",
            "-nostats",
        ])
        .arg(&temporary)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start the Canvas encoder: {error}"))?;

    // Read errors separately so a full FFmpeg error pipe cannot pause progress.
    let stderr = child.stderr.take();
    let stderr_reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stream) = stderr {
            let _ = stream.read_to_end(&mut bytes);
        }
        bytes
    });
    let mut was_cancelled = false;
    if let Some(stdout) = child.stdout.take() {
        let total_microseconds = (duration * 1_000_000.0).max(1.0);
        let mut last_percent = -1.0;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                was_cancelled = true;
                break;
            }
            if let Some(value) = line.strip_prefix("out_time_us=") {
                if let Ok(microseconds) = value.parse::<f64>() {
                    let percent = (microseconds / total_microseconds * 100.0).clamp(0.0, 99.5);
                    if percent - last_percent >= 0.5 {
                        last_percent = percent;
                        report_progress(percent);
                    }
                }
            }
        }
    }
    if cancel.load(Ordering::Relaxed) && !was_cancelled {
        let _ = child.kill();
        was_cancelled = true;
    }
    let status = child
        .wait()
        .map_err(|error| format!("Could not wait for the Canvas encoder: {error}"))?;
    let stderr = stderr_reader.join().unwrap_or_default();
    if was_cancelled {
        let _ = fs::remove_file(&temporary);
        return Err(VIDEO_EXPORT_CANCELLED.to_owned());
    }
    if !status.success() {
        let _ = fs::remove_file(&temporary);
        return Err(ffmpeg_error(&stderr));
    }
    if let Err(error) = validate_canvas_output(&temporary, duration, output_frame_rate) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    report_progress(100.0);
    fs::rename(&temporary, destination).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not finish the Canvas file: {error}")
    })
}

fn validate_canvas_request(request: &CanvasExportRequest) -> Result<(), String> {
    if !(3.0..=8.0).contains(&request.duration_seconds) {
        return Err("Canvas duration must be between 3 and 8 seconds.".to_owned());
    }
    if !matches!(request.film_frame_rate, 18 | 24 | 30) {
        return Err("Simulated film rate must be 18, 24, or 30 fps.".to_owned());
    }
    if !matches!(request.output_frame_rate, 24 | 30) {
        return Err("Canvas output frame rate must be 24 or 30 fps.".to_owned());
    }
    if !matches!(
        request.composition_mode.as_str(),
        "fill" | "fit" | "artwork-background" | "crop"
    ) {
        return Err("Choose a supported Canvas composition mode.".to_owned());
    }
    if !matches!(
        request.background_treatment.as_str(),
        "blurred" | "darkened" | "solid"
    ) {
        return Err("Choose a supported Canvas background treatment.".to_owned());
    }
    if !matches!(
        request.preset.as_str(),
        "clean-35mm"
            | "used-16mm"
            | "worn-16mm"
            | "aged-8mm"
            | "archival-monochrome"
            | "damaged-projection"
    ) {
        return Err("Choose a supported film preset.".to_owned());
    }
    if !matches!(request.film_format.as_str(), "35mm" | "16mm" | "8mm")
        || !matches!(
            request.film_condition.as_str(),
            "clean" | "used" | "worn" | "aged" | "archival" | "damaged"
        )
    {
        return Err("Choose a supported film format and condition.".to_owned());
    }
    if request.variants.is_empty() {
        return Err("Choose a single Canvas or add masters for per-track export.".to_owned());
    }
    Ok(())
}

fn prepare_canvas_source(
    request: &CanvasExportRequest,
    temporary_dir: &Path,
) -> Result<PathBuf, String> {
    let source = if request.source.uses_artwork {
        let artwork = temporary_dir.join("album-artwork.png");
        fs::write(&artwork, decode_data_url(&request.artwork_data_url)?)
            .map_err(|error| error.to_string())?;
        artwork
    } else {
        PathBuf::from(&request.source.path)
    };
    local_media_file(&source)
}

fn export_canvases_with_cancel<F>(
    request: CanvasExportRequest,
    cancel: Arc<AtomicBool>,
    mut report_progress: F,
) -> Result<VideoExportResult, String>
where
    F: FnMut(VideoExportProgress),
{
    validate_canvas_request(&request)?;
    let total = request.variants.len();
    report_progress(VideoExportProgress {
        export_id: request.export_id.clone(),
        completed: 0,
        total,
        current_track: String::new(),
        phase: "preparing".to_owned(),
        track_percent: 0.0,
    });
    let root = package_root(&request.output_dir, &request.folder_name, true)?;
    let canvases_dir = root.join("Canvases");
    let sources = if request.source.uses_artwork {
        vec![]
    } else {
        vec![PathBuf::from(&request.source.path)]
    };
    let mut destinations = Vec::new();
    for variant in &request.variants {
        destinations.push((
            checked_package_file(
                &root,
                &format!("Canvases/{}", safe_file_name(&variant.output_file_name)),
                false,
            )?,
            None,
        ));
    }
    protect_source_files(&destinations, &sources)?;
    checked_package_file(&root, "Canvases/.directory-check", true)?;

    let scratch = ScratchDirectory::new("release-preparer-canvas")?;
    let temporary_dir = &scratch.0;
    let source = match prepare_canvas_source(&request, &temporary_dir) {
        Ok(path) => path,
        Err(error) => {
            let _ = fs::remove_dir_all(&temporary_dir);
            return Err(error);
        }
    };
    if !source.is_file() {
        let _ = fs::remove_dir_all(&temporary_dir);
        return Err("The selected Canvas image is missing.".to_owned());
    }

    let mut output_names = HashMap::new();
    for variant in &request.variants {
        *output_names
            .entry(safe_file_name(&variant.output_file_name).to_lowercase())
            .or_insert(0usize) += 1;
    }
    let mut exported = 0;
    let mut failed = 0;
    let mut cancelled = false;
    let mut errors = Vec::new();
    for (index, variant) in request.variants.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let output_name = safe_file_name(&variant.output_file_name);
        report_progress(VideoExportProgress {
            export_id: request.export_id.clone(),
            completed: index,
            total,
            current_track: output_name.clone(),
            phase: "encoding".to_owned(),
            track_percent: 0.0,
        });
        if output_names
            .get(&output_name.to_lowercase())
            .copied()
            .unwrap_or_default()
            > 1
        {
            failed += 1;
            errors.push(format!("{output_name}: duplicate Canvas filename"));
            continue;
        }
        let destination = checked_package_file(&root, &format!("Canvases/{output_name}"), true)?;
        match export_canvas_variant(
            &source,
            &destination,
            &request,
            variant,
            &cancel,
            |track_percent| {
                report_progress(VideoExportProgress {
                    export_id: request.export_id.clone(),
                    completed: index,
                    total,
                    current_track: output_name.clone(),
                    phase: "encoding".to_owned(),
                    track_percent,
                });
            },
        ) {
            Ok(()) => exported += 1,
            Err(error) if error == VIDEO_EXPORT_CANCELLED => {
                cancelled = true;
                break;
            }
            Err(error) => {
                failed += 1;
                errors.push(format!("{output_name}: {error}"));
            }
        }
        report_progress(VideoExportProgress {
            export_id: request.export_id.clone(),
            completed: index + 1,
            total,
            current_track: output_name,
            phase: "processed".to_owned(),
            track_percent: 100.0,
        });
    }
    let _ = fs::remove_dir_all(temporary_dir);
    let result = VideoExportResult {
        destination: canvases_dir.to_string_lossy().into_owned(),
        exported,
        failed,
        message: if cancelled {
            "Canvas export cancelled.".to_owned()
        } else {
            errors.join("; ")
        },
        encoder: "libx264 high-quality analogue Canvas H.264".to_owned(),
        cancelled,
    };
    report_progress(VideoExportProgress {
        export_id: request.export_id,
        completed: if cancelled { exported + failed } else { total },
        total,
        current_track: String::new(),
        phase: if cancelled {
            "cancelled".to_owned()
        } else {
            "finished".to_owned()
        },
        track_percent: 100.0,
    });
    Ok(result)
}

#[cfg(test)]
fn export_canvases_with_progress<F>(
    request: CanvasExportRequest,
    report_progress: F,
) -> Result<VideoExportResult, String>
where
    F: FnMut(VideoExportProgress),
{
    export_canvases_with_cancel(request, Arc::new(AtomicBool::new(false)), report_progress)
}

async fn export_canvases(
    app: tauri::AppHandle,
    request: CanvasExportRequest,
) -> Result<VideoExportResult, String> {
    let active = ActiveVideoExport::register(&request.export_id)?;
    let cancel = Arc::clone(&active.cancel);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        export_canvases_with_cancel(request, cancel, |progress| {
            let _ = app.emit("release-preparer://canvas-export-progress", progress);
        })
    })
    .await;
    outcome.map_err(|error| format!("The Canvas export worker stopped unexpectedly: {error}"))?
}

static LAST_CANVAS_PREVIEW: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

fn render_canvas_preview_with_progress<F>(
    request: CanvasExportRequest,
    cancel: Arc<AtomicBool>,
    mut report_progress: F,
) -> Result<String, String>
where
    F: FnMut(VideoExportProgress),
{
    validate_canvas_request(&request)?;
    // Each in-flight preview owns its inputs and unfinished output. A new
    // preview must never remove another worker's directory while it encodes.
    let scratch = ScratchDirectory::new("release-preparer-canvas-preview")?;
    let source = prepare_canvas_source(&request, &scratch.0)?;
    let destination = scratch.0.join("Canvas Compression Preview.mp4");
    let variant = request
        .variants
        .first()
        .ok_or_else(|| "The Canvas preview has no variation seed.".to_owned())?;
    report_progress(VideoExportProgress {
        export_id: request.export_id.clone(),
        completed: 0,
        total: 1,
        current_track: "Compression preview".to_owned(),
        phase: "encoding".to_owned(),
        track_percent: 0.0,
    });
    export_canvas_variant(
        &source,
        &destination,
        &request,
        variant,
        &cancel,
        |track_percent| {
            report_progress(VideoExportProgress {
                export_id: request.export_id.clone(),
                completed: 0,
                total: 1,
                current_track: "Compression preview".to_owned(),
                phase: "encoding".to_owned(),
                track_percent,
            });
        },
    )?;
    // Keep the completed preview for WebView playback, replacing the previous
    // completed artifact only after its successor has encoded successfully.
    let mut last_preview = LAST_CANVAS_PREVIEW
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Could not retain the Canvas preview.".to_owned())?;
    if let Some(previous) = last_preview.replace(scratch.keep()) {
        let _ = fs::remove_dir_all(previous);
    }
    report_progress(VideoExportProgress {
        export_id: request.export_id,
        completed: 1,
        total: 1,
        current_track: "Compression preview".to_owned(),
        phase: "finished".to_owned(),
        track_percent: 100.0,
    });
    Ok(destination.to_string_lossy().into_owned())
}

async fn render_canvas_preview(
    app: tauri::AppHandle,
    request: CanvasExportRequest,
) -> Result<String, String> {
    // Compression preview uses the same renderer and validator as final export.
    let active = ActiveVideoExport::register(&request.export_id)?;
    let cancel = Arc::clone(&active.cancel);
    tauri::async_runtime::spawn_blocking(move || {
        render_canvas_preview_with_progress(request, cancel, |progress| {
            let _ = app.emit("release-preparer://canvas-export-progress", progress);
        })
    })
    .await
    .map_err(|error| format!("The Canvas preview worker stopped unexpectedly: {error}"))?
}

fn project_snapshot_with_prepared_paths(
    content: &str,
    prepared_tracks: &[PreparedTrack],
) -> String {
    let Ok(mut project) = serde_json::from_str::<Value>(content) else {
        return content.to_owned();
    };
    let prepared_by_id: HashMap<&str, &str> = prepared_tracks
        .iter()
        .map(|track| (track.id.as_str(), track.path.as_str()))
        .collect();
    let Some(masters) = project.get_mut("masters").and_then(Value::as_array_mut) else {
        return content.to_owned();
    };

    // The package snapshot should describe the portable prepared files, rather
    // than pointing back to source WAVs that the user may archive after export.
    for master in masters {
        let Some(id) = master.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(path) = prepared_by_id.get(id) else {
            continue;
        };
        master["path"] = Value::String((*path).to_owned());
        if let Some(file_name) = Path::new(path).file_name().and_then(|value| value.to_str()) {
            master["fileName"] = Value::String(file_name.to_owned());
        }
    }

    serde_json::to_string_pretty(&project).unwrap_or_else(|_| content.to_owned())
}

fn export_release(request: ExportRequest) -> Result<ExportResult, String> {
    let root = package_root(&request.output_dir, &request.folder_name, true)?;
    let artwork_name = safe_file_name(&request.artwork_file_name);
    let web_artwork_name = safe_file_name(&request.web_artwork_file_name);
    if artwork_name.eq_ignore_ascii_case(&web_artwork_name) {
        return Err("Full-size and web artwork must have different filenames.".into());
    }
    let artwork_path = checked_package_file(&root, &format!("Artwork/{artwork_name}"), false)?;
    let web_artwork_path =
        checked_package_file(&root, &format!("Artwork/{web_artwork_name}"), false)?;
    let sources: Vec<_> = request
        .tracks
        .iter()
        .map(|track| PathBuf::from(&track.path))
        .collect();
    let mut destinations = vec![
        (artwork_path.clone(), None),
        (web_artwork_path.clone(), None),
    ];
    for (index, track) in request.tracks.iter().enumerate() {
        let name = safe_file_name(&track.output_file_name);
        destinations.push((
            checked_package_file(&root, &format!("Masters/{name}"), false)?,
            Some(index),
        ));
        if should_encode_mp3(Path::new(&name)) {
            destinations.push((
                checked_package_file(
                    &root,
                    &format!("Masters/MP3/{}", prepared_mp3_file_name(&name)),
                    false,
                )?,
                None,
            ));
        }
    }
    for file in &request.text_files {
        destinations.push((package_text_path(&root, &file.relative_path, false)?, None));
    }
    protect_source_files(&destinations, &sources)?;
    let artwork_path = checked_package_file(&root, &format!("Artwork/{artwork_name}"), true)?;
    let web_artwork_path =
        checked_package_file(&root, &format!("Artwork/{web_artwork_name}"), true)?;
    checked_package_file(&root, "Masters/MP3/.directory-check", true)?;
    let artwork_bytes = decode_data_url(&request.artwork_data_url)?;
    let mut web_artwork_bytes = 0;
    // Decode and validate the new image through the web-artwork encoder before
    // replacing the full cover. Invalid imported image data preserves both
    // previous artwork files instead of committing unusable bytes.
    replace_audio_atomically(&artwork_path, |temporary| {
        write_file_atomically(temporary, &artwork_bytes)?;
        web_artwork_bytes = export_web_artwork(temporary, &web_artwork_path)?;
        Ok(())
    })?;

    let mut exported = 0;
    let mut failed = 0;
    let mut mp3_exported = 0;
    let mut mp3_failed = 0;
    let mut prepared_tracks = Vec::new();
    let mut errors = Vec::new();
    let mut master_name_counts: HashMap<String, usize> = HashMap::new();
    let mut mp3_name_counts: HashMap<String, usize> = HashMap::new();

    // The interface normally warns about duplicate prepared filenames. The
    // native layer repeats that check so a partial/incomplete release cannot
    // silently overwrite one master or MP3 with another.
    for track in &request.tracks {
        let output_name = safe_file_name(&track.output_file_name);
        *master_name_counts
            .entry(output_name.to_lowercase())
            .or_default() += 1;
        if should_encode_mp3(Path::new(&output_name)) {
            *mp3_name_counts
                .entry(prepared_mp3_file_name(&output_name).to_lowercase())
                .or_default() += 1;
        }
    }

    for track in &request.tracks {
        let source = PathBuf::from(&track.path);
        let output_name = safe_file_name(&track.output_file_name);
        if master_name_counts
            .get(&output_name.to_lowercase())
            .copied()
            .unwrap_or_default()
            > 1
        {
            failed += 1;
            errors.push(format!(
                "{}: more than one master uses the prepared filename {output_name}",
                source
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("master")
            ));
            continue;
        }
        let destination = checked_package_file(&root, &format!("Masters/{output_name}"), true)?;
        match export_master(
            &source,
            &destination,
            &artwork_path,
            &request.release,
            &track.metadata,
        ) {
            Ok(()) => {
                exported += 1;
                prepared_tracks.push(PreparedTrack {
                    id: track.id.clone(),
                    path: destination.to_string_lossy().into_owned(),
                });
                if should_encode_mp3(&destination) {
                    let mp3_name = prepared_mp3_file_name(&output_name);
                    if mp3_name_counts
                        .get(&mp3_name.to_lowercase())
                        .copied()
                        .unwrap_or_default()
                        > 1
                    {
                        mp3_failed += 1;
                        errors.push(format!(
                            "{output_name} MP3: more than one prepared master would create {mp3_name}"
                        ));
                        continue;
                    }
                    let mp3_destination =
                        checked_package_file(&root, &format!("Masters/MP3/{mp3_name}"), true)?;
                    match export_mp3(
                        &destination,
                        &mp3_destination,
                        &artwork_path,
                        &request.release,
                        &track.metadata,
                    ) {
                        Ok(()) => mp3_exported += 1,
                        Err(error) => {
                            mp3_failed += 1;
                            errors.push(format!(
                                "{} MP3: {error}",
                                source
                                    .file_name()
                                    .and_then(|value| value.to_str())
                                    .unwrap_or("master")
                            ));
                        }
                    }
                }
            }
            Err(error) => {
                failed += 1;
                errors.push(format!(
                    "{}: {error}",
                    source
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("master")
                ));
            }
        }
    }

    write_package_text_files(&root, &request.text_files, &prepared_tracks)?;

    Ok(ExportResult {
        destination: root.to_string_lossy().into_owned(),
        exported,
        failed,
        mp3_exported,
        mp3_failed,
        web_artwork_path: web_artwork_path.to_string_lossy().into_owned(),
        web_artwork_bytes,
        prepared_tracks,
        message: errors.join("; "),
    })
}

fn write_package_text_files(
    root: &Path,
    text_files: &[TextFile],
    prepared_tracks: &[PreparedTrack],
) -> Result<usize, String> {
    for text_file in text_files {
        package_text_path(root, &text_file.relative_path, false)?;
    }
    for text_file in text_files {
        let destination = package_text_path(root, &text_file.relative_path, true)?;
        let content = if text_file.relative_path == "Admin/Release Data.json" {
            project_snapshot_with_prepared_paths(&text_file.content, prepared_tracks)
        } else {
            text_file.content.clone()
        };
        write_file_atomically(&destination, content.as_bytes())?;
    }

    Ok(text_files.len())
}

fn update_non_music_files(request: NonMusicUpdateRequest) -> Result<NonMusicUpdateResult, String> {
    let root = package_root(&request.output_dir, &request.folder_name, false)?;
    if !root.is_dir() {
        return Err(
            "The previous release package could not be found. Export the release again to choose a new location."
                .to_owned(),
        );
    }

    // This deliberately writes only the generated Copy and Admin documents.
    // It does not inspect, copy, retag, or encode any master or artwork file.
    let updated = write_package_text_files(&root, &request.text_files, &[])?;
    Ok(NonMusicUpdateResult {
        destination: root.to_string_lossy().into_owned(),
        updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_ARTWORK_DATA_URL: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_keychain_backend_persists_across_entries() {
        // Two separate Entry values mirror the app's save command followed by
        // its later status/drafting command. The former mock backend failed
        // this exact round trip because each Entry had temporary memory only.
        let account = format!(
            "test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let service = "com.patrickcarroll.release-preparer.keychain-test";
        let writer = keyring::Entry::new(service, &account).unwrap();
        writer.set_password("temporary-test-key").unwrap();

        let reader = keyring::Entry::new(service, &account).unwrap();
        let saved = reader.get_password().unwrap();
        let cleanup = reader.delete_credential();

        assert_eq!(saved, "temporary-test-key");
        cleanup.expect("the temporary Keychain test item should be removed");
    }

    fn test_directory(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("release-preparer-{name}-{stamp}"));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    fn create_silent_wav_for_seconds(destination: &Path, seconds: f64) {
        let generated = Command::new(ffmpeg_path())
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=44100:cl=stereo",
                "-t",
                &format!("{seconds:.3}"),
                "-c:a",
                "pcm_s16le",
            ])
            .arg(destination)
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            ffmpeg_error(&generated.stderr)
        );
    }

    fn create_silent_wav(destination: &Path) {
        // A fraction of a second is enough for most audio encoder tests.
        create_silent_wav_for_seconds(destination, 0.2);
    }

    fn create_test_artwork(destination: &Path) {
        fs::write(destination, decode_data_url(TEST_ARTWORK_DATA_URL).unwrap()).unwrap();
    }

    fn create_blur_test_background(destination: &Path) {
        // Two strongly different blue halves make both blur strength and colour
        // preservation measurable without depending on a person's eyesight.
        let generated = Command::new(ffmpeg_path())
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x10283c:s=1200x900:r=1",
                "-vf",
                "drawbox=x=600:y=0:w=600:h=900:color=0x4a9cc0:t=fill",
                "-frames:v",
                "1",
                "-update",
                "1",
            ])
            .arg(destination)
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            ffmpeg_error(&generated.stderr)
        );
    }

    fn sample_rgb(source: &Path, x: u32, y: u32) -> [u8; 3] {
        let sampled = Command::new(ffmpeg_path())
            .args(["-v", "error", "-i"])
            .arg(source)
            .args([
                "-vf",
                &format!("format=rgb24,crop=1:1:{x}:{y}"),
                "-frames:v",
                "1",
                "-f",
                "rawvideo",
                "pipe:1",
            ])
            .output()
            .unwrap();
        assert!(
            sampled.status.success(),
            "{}",
            ffmpeg_error(&sampled.stderr)
        );
        assert!(sampled.stdout.len() >= 3);
        [sampled.stdout[0], sampled.stdout[1], sampled.stdout[2]]
    }

    fn rgb_distance(left: [u8; 3], right: [u8; 3]) -> u32 {
        left.into_iter()
            .zip(right)
            .map(|(a, b)| u32::from(a.abs_diff(b)))
            .sum()
    }

    fn image_ssim(reference: &Path, candidate: &Path) -> f64 {
        let measured = Command::new(ffmpeg_path())
            .args(["-i"])
            .arg(reference)
            .args(["-i"])
            .arg(candidate)
            .args(["-lavfi", "ssim", "-f", "null", "-"])
            .output()
            .unwrap();
        let report = String::from_utf8_lossy(&measured.stderr);
        let marker = report
            .rfind("All:")
            .expect("FFmpeg should report an SSIM score");
        report[marker + 4..]
            .split_whitespace()
            .next()
            .unwrap()
            .parse::<f64>()
            .unwrap()
    }

    fn test_release() -> ReleaseMetadata {
        ReleaseMetadata {
            album: "Test Album".to_owned(),
            album_artist: "Test Artist".to_owned(),
            year: "2026".to_owned(),
            genre: "Ambient".to_owned(),
            label: "Test Label".to_owned(),
            catalogue: "TEST001".to_owned(),
            copyright: "Copyright Test Artist".to_owned(),
            upc: "123456789012".to_owned(),
        }
    }

    fn test_track(title: &str) -> TrackMetadata {
        TrackMetadata {
            title: title.to_owned(),
            artist: "Test Artist".to_owned(),
            composer: "Test Composer".to_owned(),
            track_number: "1".to_owned(),
            isrc: "AU-ABC-26-00001".to_owned(),
            comment: "Prepared by Release Preparer".to_owned(),
            ..Default::default()
        }
    }

    #[test]
    fn unsafe_file_characters_are_replaced() {
        assert_eq!(
            safe_file_name("PC001: Track/One.wav"),
            "PC001- Track-One.wav"
        );
    }

    #[test]
    fn gaussian_blur_strength_maps_to_a_visible_4k_sigma() {
        assert_eq!(gaussian_sigma_from_control(-10.0), 0.0);
        assert_eq!(gaussian_sigma_from_control(0.0), 0.0);
        assert_eq!(gaussian_sigma_from_control(28.0), 56.0);
        assert_eq!(gaussian_sigma_from_control(200.0), 400.0);
        assert_eq!(gaussian_sigma_from_control(500.0), 400.0);
        let normal = gaussian_blur_working_plan(28.0, false).unwrap();
        assert_eq!(
            (normal.width, normal.height, normal.passes),
            (1920, 1080, 1)
        );
        assert_eq!(normal.sigma_per_pass, 28.0);
        let strong = gaussian_blur_working_plan(80.0, false).unwrap();
        assert_eq!(
            (strong.width, strong.height, strong.passes),
            (1920, 1080, 9)
        );
        let drastic = gaussian_blur_working_plan(200.0, false).unwrap();
        assert_eq!(
            (drastic.width, drastic.height, drastic.passes),
            (1920, 1080, 52)
        );
        assert!(drastic.sigma_per_pass <= 28.0);
        let moving = gaussian_blur_working_plan(200.0, true).unwrap();
        assert_eq!((moving.width, moving.height), (960, 540));
        assert!(moving.sigma_per_pass <= 28.0);
    }

    #[test]
    fn drastic_gaussian_blur_preserves_blue_colour_and_softens_an_edge() {
        let directory = test_directory("video-blur-colour");
        let background = directory.join("blue-halves.png");
        let foreground = directory.join("foreground.png");
        let sharp = directory.join("sharp.png");
        let blurred = directory.join("blurred.png");
        create_blur_test_background(&background);
        create_test_artwork(&foreground);

        let mut request = VideoExportRequest {
            export_id: "blur-test".to_owned(),
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "blur-test".to_owned(),
            artwork_data_url: TEST_ARTWORK_DATA_URL.to_owned(),
            logo_data_url: String::new(),
            foreground: VideoMedia {
                uses_artwork: false,
                path: foreground.to_string_lossy().into_owned(),
                kind: "image".to_owned(),
            },
            background: VideoMedia {
                uses_artwork: false,
                path: background.to_string_lossy().into_owned(),
                kind: "image".to_owned(),
            },
            background_blur: 0.0,
            background_opacity: 100.0,
            foreground_size: 20.0,
            foreground_shadow_enabled: false,
            foreground_shadow_intensity: 35.0,
            logo_enabled: false,
            logo_opacity: 100.0,
            logo_size: 10.0,
            logo_x: 6.0,
            logo_y: 8.0,
            tracks: Vec::new(),
        };
        render_static_video_frame(&background, &foreground, None, &sharp, &request).unwrap();
        request.background_blur = 200.0;
        render_static_video_frame(&background, &foreground, None, &blurred, &request).unwrap();

        // Sample above the small foreground square, on either side of the
        // background's hard central boundary.
        let sharp_left = sample_rgb(&sharp, 1680, 240);
        let sharp_right = sample_rgb(&sharp, 2160, 240);
        let blurred_left = sample_rgb(&blurred, 1680, 240);
        let blurred_right = sample_rgb(&blurred, 2160, 240);
        assert!(rgb_distance(blurred_left, blurred_right) < rgb_distance(sharp_left, sharp_right));
        assert!(
            blurred_left[2] > blurred_left[0] + 10,
            "blur became pink: {blurred_left:?}"
        );
        assert!(
            blurred_right[2] > blurred_right[0] + 10,
            "blur became pink: {blurred_right:?}"
        );
        request.foreground_shadow_enabled = true;
        request.foreground_shadow_intensity = 70.0;
        let (shadow_filter, _) = video_filter(&request, None, false);
        assert!(shadow_filter.contains("[fg-shadow-source]"));
        assert!(shadow_filter.contains("[shadowed]"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn audio_preview_accepts_only_supported_master_formats() {
        assert!(is_supported_audio_preview(Path::new("/tmp/master.WAV")));
        assert!(is_supported_audio_preview(Path::new("/tmp/master.flac")));
        assert!(!is_supported_audio_preview(Path::new(
            "/tmp/release-data.json"
        )));
        assert!(!is_supported_audio_preview(Path::new("/tmp/no-extension")));
        assert!(is_supported_visual(Path::new("/tmp/background.MOV")));
        assert!(is_supported_visual(Path::new("/tmp/foreground.webp")));
        assert!(!is_supported_visual(Path::new("/tmp/master.wav")));
    }

    #[test]
    fn package_text_files_cannot_escape_the_release_folder() {
        let base = Path::new("/tmp/release");
        assert!(safe_relative_path(base, "Copy/Bandcamp.txt").is_ok());
        assert!(safe_relative_path(base, "../outside.txt").is_err());
    }

    #[test]
    fn repeated_export_updates_files_in_the_same_release_folder() {
        // Progressive export deliberately reuses the package so later copy replaces
        // the earlier draft without deleting unrelated files from the folder.
        let directory = test_directory("text-update");
        let request = |content: &str| ExportRequest {
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "TEST001 - Test Artist - Test Album".to_owned(),
            artwork_data_url: TEST_ARTWORK_DATA_URL.to_owned(),
            artwork_file_name: "Cover.png".to_owned(),
            web_artwork_file_name: "Cover - Web.jpg".to_owned(),
            release: ReleaseMetadata::default(),
            tracks: Vec::new(),
            text_files: vec![TextFile {
                relative_path: "Copy/Bandcamp.txt".to_owned(),
                content: content.to_owned(),
            }],
        };

        export_release(request("early draft")).unwrap();
        export_release(request("updated release copy")).unwrap();
        let copy_path = directory
            .join("TEST001 - Test Artist - Test Album")
            .join("Copy/Bandcamp.txt");
        assert_eq!(
            fs::read_to_string(copy_path).unwrap(),
            "updated release copy"
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn non_music_update_rewrites_copy_without_touching_masters() {
        let directory = test_directory("non-music-update");
        let package = directory.join("TEST002 - Copy Update");
        let master = package.join("Masters/01 - Existing Master.wav");
        fs::create_dir_all(master.parent().unwrap()).unwrap();
        fs::write(&master, b"existing master bytes").unwrap();

        let result = update_non_music_files(NonMusicUpdateRequest {
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "TEST002 - Copy Update".to_owned(),
            text_files: vec![
                TextFile {
                    relative_path: "Copy/Bandcamp.txt".to_owned(),
                    content: "new short and long description".to_owned(),
                },
                TextFile {
                    relative_path: "Admin/Release Summary.txt".to_owned(),
                    content: "updated summary".to_owned(),
                },
            ],
        })
        .unwrap();

        assert_eq!(result.updated, 2);
        assert_eq!(
            fs::read_to_string(package.join("Copy/Bandcamp.txt")).unwrap(),
            "new short and long description"
        );
        assert_eq!(
            fs::read_to_string(package.join("Admin/Release Summary.txt")).unwrap(),
            "updated summary"
        );
        assert_eq!(fs::read(&master).unwrap(), b"existing master bytes");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn track_video_export_is_4k_and_keeps_the_source_master() {
        let directory = test_directory("video-export");
        let source = directory.join("source.wav");
        let visual = directory.join("detailed-visual.png");
        let expected_frame = directory.join("expected-frame.png");
        let encoded_frame = directory.join("encoded-frame.png");
        // Ten seconds is long enough to prove the optimized still-artwork path
        // advances through real hardware-encoder progress without making the
        // normal test suite unreasonably slow.
        create_silent_wav_for_seconds(&source, 10.0);
        create_blur_test_background(&visual);
        let original = fs::read(&source).unwrap();
        let mut progress_updates = Vec::new();
        let request = VideoExportRequest {
            export_id: "test-video-export".to_owned(),
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "TEST003 - Video Release".to_owned(),
            artwork_data_url: TEST_ARTWORK_DATA_URL.to_owned(),
            logo_data_url: String::new(),
            foreground: VideoMedia {
                uses_artwork: false,
                path: visual.to_string_lossy().into_owned(),
                kind: "image".to_owned(),
            },
            background: VideoMedia {
                uses_artwork: false,
                path: visual.to_string_lossy().into_owned(),
                kind: "image".to_owned(),
            },
            background_blur: 20.0,
            background_opacity: 70.0,
            foreground_size: 78.0,
            foreground_shadow_enabled: true,
            foreground_shadow_intensity: 40.0,
            logo_enabled: false,
            logo_opacity: 100.0,
            logo_size: 10.0,
            logo_x: 6.0,
            logo_y: 8.0,
            tracks: vec![VideoTrack {
                path: source.to_string_lossy().into_owned(),
                output_file_name: "01 - Test Track.mp4".to_owned(),
                duration_seconds: 10.0,
            }],
        };
        render_static_video_frame(&visual, &visual, None, &expected_frame, &request).unwrap();
        let result = export_track_videos_with_progress(request, |progress| {
            progress_updates.push((
                progress.completed,
                progress.total,
                progress.phase,
                progress.track_percent,
            ))
        })
        .unwrap();
        let video = PathBuf::from(result.destination).join("01 - Test Track.mp4");
        assert_eq!(result.exported, 1);
        assert_eq!(result.encoder, "libx264 high-quality still-image H.264");
        assert!(video.is_file());
        assert_eq!(fs::read(&source).unwrap(), original);
        assert_eq!(
            progress_updates.first(),
            Some(&(0, 1, "preparing".to_owned(), 0.0))
        );
        assert_eq!(
            progress_updates.last(),
            Some(&(1, 1, "finished".to_owned(), 100.0))
        );
        assert!(progress_updates
            .iter()
            .any(|update| { update.2 == "encoding" && update.3 > 0.0 && update.3 <= 100.0 }));
        let probe = Command::new(ffprobe_path())
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries:format=duration",
                "-of",
                "json",
            ])
            .arg(&video)
            .output()
            .unwrap();
        let details: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(
            details
                .pointer("/streams/0/codec_name")
                .and_then(Value::as_str),
            Some("h264")
        );
        assert_eq!(
            details.pointer("/streams/0/width").and_then(Value::as_u64),
            Some(3840)
        );
        assert_eq!(
            details.pointer("/streams/0/height").and_then(Value::as_u64),
            Some(2160)
        );
        // A complete 1-1-1 Rec.709 description prevents QuickTime, Finder,
        // browsers, and upload platforms from guessing different colour rules.
        assert_eq!(
            details
                .pointer("/streams/0/pix_fmt")
                .and_then(Value::as_str),
            Some("yuv420p")
        );
        assert_eq!(
            details
                .pointer("/streams/0/color_range")
                .and_then(Value::as_str),
            Some("tv")
        );
        assert_eq!(
            details
                .pointer("/streams/0/color_space")
                .and_then(Value::as_str),
            Some("bt709")
        );
        assert_eq!(
            details
                .pointer("/streams/0/color_transfer")
                .and_then(Value::as_str),
            Some("bt709")
        );
        assert_eq!(
            details
                .pointer("/streams/0/color_primaries")
                .and_then(Value::as_str),
            Some("bt709")
        );
        let extracted = Command::new(ffmpeg_path())
            .args(["-y", "-ss", "2", "-i"])
            .arg(&video)
            .args(["-frames:v", "1", "-update", "1"])
            .arg(&encoded_frame)
            .output()
            .unwrap();
        assert!(
            extracted.status.success(),
            "{}",
            ffmpeg_error(&extracted.stderr)
        );
        // A raw PNG comparison sees the intentional sRGB-to-Rec.709 transfer
        // curve change even though a colour-managed player reverses it for the
        // screen. This lower guard still catches serious scaling or compression
        // damage while the assertions above verify the important colour tags.
        assert!(
            image_ssim(&expected_frame, &encoded_frame) > 0.90,
            "The encoded 4K frame lost too much visual detail"
        );
        assert!(fs::metadata(&video).unwrap().len() < 15_000_000);
        let video_duration = details
            .pointer("/format/duration")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap();
        assert!((9.8..=10.2).contains(&video_duration));
        let _ = fs::remove_dir_all(directory);
    }

    fn canvas_test_request(preset: &str, composition_mode: &str) -> CanvasExportRequest {
        CanvasExportRequest {
            export_id: "canvas-filter-test".to_owned(),
            output_dir: String::new(),
            folder_name: "Canvas Test".to_owned(),
            artwork_data_url: TEST_ARTWORK_DATA_URL.to_owned(),
            source: VideoMedia {
                uses_artwork: true,
                path: String::new(),
                kind: "image".to_owned(),
            },
            composition_mode: composition_mode.to_owned(),
            background_treatment: "blurred".to_owned(),
            background_color: "#111315".to_owned(),
            position_x: 31.0,
            position_y: 68.0,
            image_scale: 100.0,
            preset: preset.to_owned(),
            film_format: if preset == "clean-35mm" {
                "35mm"
            } else {
                "16mm"
            }
            .to_owned(),
            film_condition: if preset == "clean-35mm" {
                "clean"
            } else {
                "used"
            }
            .to_owned(),
            seed: 271_828,
            intensity: 55.0,
            grain_amount: 42.0,
            grain_size: 42.0,
            grain_clumping: 34.0,
            exposure_flicker: 28.0,
            colour_instability: 12.0,
            horizontal_weave: 28.0,
            vertical_jitter: 24.0,
            rotation: 18.0,
            scale_breathing: 12.0,
            optical_softness: 30.0,
            halation: 16.0,
            vignette: 30.0,
            dust_amount: 28.0,
            scratch_probability: 12.0,
            scratch_persistence: 24.0,
            hair_probability: 0.0,
            damage_probability: 0.0,
            light_leak_probability: 0.0,
            cue_marks: "off".to_owned(),
            monochrome: preset == "archival-monochrome",
            duration_seconds: 8.0,
            film_frame_rate: 24,
            output_frame_rate: 24,
            variants: vec![CanvasVariant {
                output_file_name: "Canvas Test.mp4".to_owned(),
                seed: 7,
            }],
        }
    }

    #[test]
    fn canvas_effects_build_loop_aware_composition_and_film_plans() {
        let artwork =
            canvas_effect_filter(&canvas_test_request("used-16mm", "artwork-background"), 7);
        let fill = canvas_effect_filter(&canvas_test_request("clean-35mm", "fill"), 8);
        let monochrome =
            canvas_effect_filter(&canvas_test_request("archival-monochrome", "fit"), 9);
        assert_ne!(artwork, fill);
        assert!(artwork.contains("split=2[bg-source][fg-source]"));
        assert!(artwork.contains("sin(2*PI*t/8.000000"));
        assert!(artwork.contains("noise=alls="));
        assert!(artwork.contains("drawbox"));
        assert!(fill.contains("force_original_aspect_ratio=increase"));
        assert!(monochrome.contains("hue=s=0"));
        assert!(monochrome.contains(rec709_delivery_filter()));
    }

    #[test]
    fn canvas_composition_modes_execute_as_valid_ffmpeg_graphs() {
        let directory = test_directory("canvas-compositions");
        let visual = directory.join("composition-source.png");
        create_blur_test_background(&visual);
        for (mode, background) in [
            ("fill", "blurred"),
            ("fit", "solid"),
            ("artwork-background", "darkened"),
            ("crop", "blurred"),
        ] {
            let mut request = canvas_test_request("used-16mm", mode);
            request.background_treatment = background.to_owned();
            request.dust_amount = 0.0;
            request.scratch_probability = 0.0;
            let output = Command::new(ffmpeg_path())
                .args(["-v", "error", "-loop", "1", "-framerate", "24", "-i"])
                .arg(&visual)
                .args([
                    "-filter_complex",
                    &canvas_effect_filter(&request, 17),
                    "-map",
                    "[canvasout]",
                    "-frames:v",
                    "1",
                    "-f",
                    "null",
                    "-",
                ])
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{mode}/{background}: {}",
                ffmpeg_error(&output.stderr)
            );
        }
        let mut invalid = canvas_test_request("used-16mm", "fill");
        invalid.duration_seconds = 9.0;
        assert!(validate_canvas_request(&invalid).is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn canvas_export_is_portrait_colour_tagged_and_source_safe() {
        let directory = test_directory("canvas-export");
        let visual = directory.join("canvas-source.png");
        create_blur_test_background(&visual);
        let original = fs::read(&visual).unwrap();
        let mut progress_updates = Vec::new();
        let result = export_canvases_with_progress(
            CanvasExportRequest {
                export_id: "test-canvas-export".to_owned(),
                output_dir: directory.to_string_lossy().into_owned(),
                folder_name: "TEST005 - Canvas Release".to_owned(),
                source: VideoMedia {
                    uses_artwork: false,
                    path: visual.to_string_lossy().into_owned(),
                    kind: "image".to_owned(),
                },
                duration_seconds: 3.0,
                variants: vec![CanvasVariant {
                    output_file_name: "01 - Test Canvas.mp4".to_owned(),
                    seed: 7,
                }],
                ..canvas_test_request("used-16mm", "artwork-background")
            },
            |progress| progress_updates.push((progress.phase, progress.track_percent)),
        )
        .unwrap();
        let video = PathBuf::from(&result.destination).join("01 - Test Canvas.mp4");
        assert_eq!(result.exported, 1);
        assert!(video.is_file());
        assert_eq!(fs::read(&visual).unwrap(), original);
        assert!(progress_updates
            .iter()
            .any(|(phase, percent)| phase == "encoding" && *percent > 0.0));
        let probe = Command::new(ffprobe_path())
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,width,height,pix_fmt,color_range,color_space,color_transfer,color_primaries:format=duration",
                "-of",
                "json",
            ])
            .arg(&video)
            .output()
            .unwrap();
        let details: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(
            details
                .pointer("/streams/0/codec_name")
                .and_then(Value::as_str),
            Some("h264")
        );
        assert_eq!(
            details.pointer("/streams/0/width").and_then(Value::as_u64),
            Some(576)
        );
        assert_eq!(
            details.pointer("/streams/0/height").and_then(Value::as_u64),
            Some(1024)
        );
        for property in ["color_space", "color_transfer", "color_primaries"] {
            assert_eq!(
                details
                    .pointer(&format!("/streams/0/{property}"))
                    .and_then(Value::as_str),
                Some("bt709")
            );
        }
        assert_eq!(
            details
                .pointer("/streams/0/color_range")
                .and_then(Value::as_str),
            Some("tv")
        );
        let duration = details
            .pointer("/format/duration")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap();
        assert!((2.9..=3.1).contains(&duration));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn cancelling_video_export_removes_only_the_unfinished_temporary_file() {
        let directory = test_directory("video-cancel");
        let source = directory.join("source.wav");
        create_silent_wav_for_seconds(&source, 30.0);
        let original = fs::read(&source).unwrap();
        let package = directory.join("TEST004 - Cancelled Video");
        let videos = package.join("Videos");
        fs::create_dir_all(&videos).unwrap();
        let completed_before_export = videos.join("00 - Existing.mp4");
        fs::write(&completed_before_export, b"existing completed video").unwrap();

        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_from_progress = Arc::clone(&cancel);
        let mut phases = Vec::new();
        let result = export_track_videos_with_cancel(
            VideoExportRequest {
                export_id: "test-video-cancel".to_owned(),
                output_dir: directory.to_string_lossy().into_owned(),
                folder_name: "TEST004 - Cancelled Video".to_owned(),
                artwork_data_url: TEST_ARTWORK_DATA_URL.to_owned(),
                logo_data_url: String::new(),
                foreground: VideoMedia {
                    uses_artwork: true,
                    path: String::new(),
                    kind: "image".to_owned(),
                },
                background: VideoMedia {
                    uses_artwork: true,
                    path: String::new(),
                    kind: "image".to_owned(),
                },
                background_blur: 20.0,
                background_opacity: 70.0,
                foreground_size: 78.0,
                foreground_shadow_enabled: false,
                foreground_shadow_intensity: 35.0,
                logo_enabled: false,
                logo_opacity: 100.0,
                logo_size: 10.0,
                logo_x: 6.0,
                logo_y: 8.0,
                tracks: vec![VideoTrack {
                    path: source.to_string_lossy().into_owned(),
                    output_file_name: "01 - Cancel Me.mp4".to_owned(),
                    duration_seconds: 30.0,
                }],
            },
            cancel,
            |progress| {
                if progress.phase == "encoding" && progress.track_percent > 0.0 {
                    cancel_from_progress.store(true, Ordering::Relaxed);
                }
                phases.push(progress.phase);
            },
        )
        .unwrap();

        assert!(result.cancelled);
        assert_eq!((result.exported, result.failed), (0, 0));
        assert_eq!(fs::read(&source).unwrap(), original);
        assert_eq!(
            fs::read(&completed_before_export).unwrap(),
            b"existing completed video"
        );
        assert_eq!(phases.last().map(String::as_str), Some("cancelled"));
        assert!(!videos.join("01 - Cancel Me.mp4").exists());
        assert!(fs::read_dir(&videos).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("release-preparer")
        }));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn prepared_wav_metadata_can_be_read_back() {
        let directory = test_directory("wav-metadata");
        let source = directory.join("source.wav");
        let prepared = directory.join("prepared.wav");
        let unused_artwork = directory.join("cover.png");
        create_silent_wav(&source);
        let release = test_release();
        let track = test_track("Prepared Track");
        export_master(&source, &prepared, &unused_artwork, &release, &track).unwrap();
        let inspected = inspect_audio(vec![prepared.to_string_lossy().into_owned()]).unwrap();
        assert_eq!(inspected[0].metadata.title, "Prepared Track");
        assert_eq!(inspected[0].metadata.artist, "Test Artist");
        assert_eq!(inspected[0].metadata.album, "Test Album");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn prepared_master_can_update_itself_without_touching_the_original() {
        let directory = test_directory("same-path-update");
        let source = directory.join("original.wav");
        let prepared = directory.join("prepared.wav");
        let unused_artwork = directory.join("cover.png");
        create_silent_wav(&source);
        let original_bytes = fs::read(&source).unwrap();
        let release = test_release();

        export_master(
            &source,
            &prepared,
            &unused_artwork,
            &release,
            &test_track("First title"),
        )
        .unwrap();
        export_master(
            &prepared,
            &prepared,
            &unused_artwork,
            &release,
            &test_track("Updated title"),
        )
        .unwrap();

        let inspected = inspect_audio(vec![prepared.to_string_lossy().into_owned()]).unwrap();
        assert_eq!(inspected[0].metadata.title, "Updated title");
        assert_eq!(fs::read(&source).unwrap(), original_bytes);
        assert!(!fs::read_dir(&directory).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".release-preparer-")
        }));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn highest_quality_mp3_contains_tags_and_cover_art() {
        let directory = test_directory("mp3-quality");
        let source = directory.join("source.wav");
        let artwork = directory.join("cover.png");
        let mp3 = directory.join("prepared.mp3");
        create_silent_wav(&source);
        create_test_artwork(&artwork);

        export_mp3(
            &source,
            &mp3,
            &artwork,
            &test_release(),
            &test_track("Encoded Track"),
        )
        .unwrap();

        let probe = Command::new(ffprobe_path())
            .args([
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
            ])
            .arg(&mp3)
            .output()
            .unwrap();
        assert!(probe.status.success());
        let value: Value = serde_json::from_slice(&probe.stdout).unwrap();
        let streams = value["streams"].as_array().unwrap();
        let audio = streams
            .iter()
            .find(|stream| stream["codec_type"] == "audio")
            .unwrap();
        let cover = streams
            .iter()
            .find(|stream| stream["codec_type"] == "video")
            .unwrap();
        assert_eq!(audio["codec_name"], "mp3");
        assert_eq!(audio["bit_rate"].as_str(), Some("320000"));
        assert_eq!(cover["codec_name"], "mjpeg");
        assert_eq!(cover["disposition"]["attached_pic"].as_i64(), Some(1));
        assert_eq!(value["format"]["tags"]["title"], "Encoded Track");
        assert_eq!(value["format"]["tags"]["album"], "Test Album");
        assert_eq!(value["format"]["tags"]["artist"], "Test Artist");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn release_export_returns_prepared_path_and_updates_its_json_snapshot() {
        let directory = test_directory("release-paths");
        let source = directory.join("source.wav");
        create_silent_wav(&source);
        let source_bytes = fs::read(&source).unwrap();
        let snapshot = serde_json::json!({
            "masters": [{
                "id": "track-one",
                "path": source.to_string_lossy(),
                "fileName": "source.wav",
                "metadata": { "title": "Package Track" }
            }]
        });
        let request = ExportRequest {
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "Prepared Release".to_owned(),
            artwork_data_url: TEST_ARTWORK_DATA_URL.to_owned(),
            artwork_file_name: "Cover.png".to_owned(),
            web_artwork_file_name: "Cover - Web.jpg".to_owned(),
            release: test_release(),
            tracks: vec![ExportTrack {
                id: "track-one".to_owned(),
                path: source.to_string_lossy().into_owned(),
                output_file_name: "01 - Test Artist - Package Track.wav".to_owned(),
                metadata: test_track("Package Track"),
            }],
            text_files: vec![TextFile {
                relative_path: "Admin/Release Data.json".to_owned(),
                content: serde_json::to_string_pretty(&snapshot).unwrap(),
            }],
        };

        let result = export_release(request).unwrap();
        assert_eq!(result.exported, 1);
        assert_eq!(result.mp3_exported, 1);
        assert_eq!(result.prepared_tracks.len(), 1);
        let prepared_path = PathBuf::from(&result.prepared_tracks[0].path);
        assert!(prepared_path.is_file());
        assert!(prepared_path
            .parent()
            .unwrap()
            .join("MP3")
            .join("01 - Test Artist - Package Track.mp3")
            .is_file());
        assert!(Path::new(&result.web_artwork_path).is_file());
        assert!(result.web_artwork_bytes < 2_000_000);
        let web_probe = Command::new(ffprobe_path())
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,width,height",
                "-of",
                "json",
            ])
            .arg(&result.web_artwork_path)
            .output()
            .unwrap();
        assert!(web_probe.status.success());
        let web_info: Value = serde_json::from_slice(&web_probe.stdout).unwrap();
        assert_eq!(web_info["streams"][0]["codec_name"], "mjpeg");
        assert!(web_info["streams"][0]["width"].as_u64().unwrap() <= 1600);
        assert!(web_info["streams"][0]["height"].as_u64().unwrap() <= 1600);
        assert_eq!(fs::read(&source).unwrap(), source_bytes);

        let saved_snapshot: Value = serde_json::from_str(
            &fs::read_to_string(
                directory
                    .join("Prepared Release")
                    .join("Admin/Release Data.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            saved_snapshot["masters"][0]["path"].as_str(),
            Some(result.prepared_tracks[0].path.as_str())
        );
        assert_eq!(
            saved_snapshot["masters"][0]["fileName"].as_str(),
            Some("01 - Test Artist - Package Track.wav")
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn colliding_lossless_names_do_not_overwrite_one_mp3() {
        let directory = test_directory("mp3-collision");
        let wav = directory.join("source.wav");
        let flac = directory.join("source.flac");
        create_silent_wav(&wav);
        let flac_result = Command::new(ffmpeg_path())
            .args(["-y", "-i"])
            .arg(&wav)
            .args(["-c:a", "flac"])
            .arg(&flac)
            .output()
            .unwrap();
        assert!(flac_result.status.success());

        let result = export_release(ExportRequest {
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "Collision Test".to_owned(),
            artwork_data_url: TEST_ARTWORK_DATA_URL.to_owned(),
            artwork_file_name: "Cover.png".to_owned(),
            web_artwork_file_name: "Cover - Web.jpg".to_owned(),
            release: test_release(),
            tracks: vec![
                ExportTrack {
                    id: "wav-track".to_owned(),
                    path: wav.to_string_lossy().into_owned(),
                    output_file_name: "Same Name.wav".to_owned(),
                    metadata: test_track("WAV Track"),
                },
                ExportTrack {
                    id: "flac-track".to_owned(),
                    path: flac.to_string_lossy().into_owned(),
                    output_file_name: "Same Name.flac".to_owned(),
                    metadata: test_track("FLAC Track"),
                },
            ],
            text_files: Vec::new(),
        })
        .unwrap();

        assert_eq!(result.exported, 2);
        assert_eq!(result.mp3_exported, 0);
        assert_eq!(result.mp3_failed, 2);
        assert!(!directory
            .join("Collision Test/Masters/MP3/Same Name.mp3")
            .exists());
        let _ = fs::remove_dir_all(directory);
    }
    #[test]
    fn wash_non_music_refresh_rejects_master_paths_before_any_write() {
        let directory = test_directory("wash-refresh-paths");
        let package = directory.join("Package");
        fs::create_dir_all(package.join("Copy")).unwrap();
        fs::create_dir_all(package.join("Masters")).unwrap();
        let copy = package.join("Copy/Bandcamp.txt");
        let master = package.join("Masters/source.wav");
        fs::write(&copy, b"previous copy").unwrap();
        fs::write(&master, b"source audio").unwrap();
        let result = update_non_music_files(NonMusicUpdateRequest {
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "Package".into(),
            text_files: vec![
                TextFile {
                    relative_path: "Copy/Bandcamp.txt".into(),
                    content: "new copy".into(),
                },
                TextFile {
                    relative_path: "Masters/source.wav".into(),
                    content: "not audio".into(),
                },
            ],
        });
        assert!(
            result.is_err(),
            "text-only refresh accepted a master destination"
        );
        assert_eq!(fs::read(&copy).unwrap(), b"previous copy");
        assert_eq!(fs::read(&master).unwrap(), b"source audio");
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn wash_package_sidecars_reject_symlink_escape_and_preserve_outside_data() {
        use std::os::unix::fs::symlink;
        let directory = test_directory("wash-sidecar-symlink");
        let package = directory.join("Package");
        let outside = directory.join("Outside");
        fs::create_dir_all(&package).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let outside_file = outside.join("Bandcamp.txt");
        fs::write(&outside_file, b"outside original").unwrap();
        symlink(&outside, package.join("Copy")).unwrap();
        let result = update_non_music_files(NonMusicUpdateRequest {
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "Package".into(),
            text_files: vec![TextFile {
                relative_path: "Copy/Bandcamp.txt".into(),
                content: "overwritten".into(),
            }],
        });
        assert!(result.is_err(), "followed a package directory symlink");
        assert_eq!(fs::read(&outside_file).unwrap(), b"outside original");
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn wash_package_sidecars_reject_file_symlinks() {
        use std::os::unix::fs::symlink;
        let directory = test_directory("wash-sidecar-file-symlink");
        let package = directory.join("Package");
        fs::create_dir_all(package.join("Copy")).unwrap();
        let outside = directory.join("original.txt");
        fs::write(&outside, b"outside original").unwrap();
        symlink(&outside, package.join("Copy/Bandcamp.txt")).unwrap();
        let result = write_package_text_files(
            &package,
            &[TextFile {
                relative_path: "Copy/Bandcamp.txt".into(),
                content: "changed".into(),
            }],
            &[],
        );
        assert!(result.is_err(), "followed a sidecar file symlink");
        assert_eq!(fs::read(&outside).unwrap(), b"outside original");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn wash_sidecar_update_does_not_truncate_an_aliased_external_file() {
        let directory = test_directory("wash-sidecar-hardlink");
        let package = directory.join("Package");
        fs::create_dir_all(package.join("Copy")).unwrap();
        let outside = directory.join("original.txt");
        fs::write(&outside, b"outside original").unwrap();
        let generated = package.join("Copy/Bandcamp.txt");
        fs::hard_link(&outside, &generated).unwrap();
        write_package_text_files(
            &package,
            &[TextFile {
                relative_path: "Copy/Bandcamp.txt".into(),
                content: "new generated copy".into(),
            }],
            &[],
        )
        .unwrap();
        assert_eq!(fs::read(&outside).unwrap(), b"outside original");
        assert_eq!(fs::read(&generated).unwrap(), b"new generated copy");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn wash_invalid_artwork_preserves_the_previous_cover_and_web_image() {
        let directory = test_directory("wash-artwork-failure");
        let artwork = directory.join("Package/Artwork");
        fs::create_dir_all(&artwork).unwrap();
        fs::write(artwork.join("Cover.png"), b"previous full cover").unwrap();
        fs::write(artwork.join("Cover - Web.jpg"), b"previous web cover").unwrap();
        let result = export_release(ExportRequest {
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "Package".into(),
            artwork_data_url: format!("data:image/png;base64,{}", BASE64.encode(b"invalid image")),
            artwork_file_name: "Cover.png".into(),
            web_artwork_file_name: "Cover - Web.jpg".into(),
            release: ReleaseMetadata::default(),
            tracks: Vec::new(),
            text_files: Vec::new(),
        });
        assert!(result.is_err());
        assert_eq!(
            fs::read(artwork.join("Cover.png")).unwrap(),
            b"previous full cover"
        );
        assert_eq!(
            fs::read(artwork.join("Cover - Web.jpg")).unwrap(),
            b"previous web cover"
        );
        assert_eq!(
            fs::read_dir(&artwork).unwrap().count(),
            2,
            "Failed export leaked temporary artwork"
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn wash_inspection_and_master_export_require_a_real_local_file() {
        let directory = test_directory("wash-local-media");
        let source = directory.join("source.wav");
        let artwork = directory.join("artwork.png");
        let output = directory.join("output.wav");
        create_silent_wav(&source);
        create_test_artwork(&artwork);
        // FFmpeg recognizes concat: as a protocol even though it is not a
        // local filesystem path. This isolated fixture needs no network.
        let protocol = format!("concat:{}", source.display());
        let inspected = inspect_audio(vec![protocol.clone()]);
        let exported = export_master(
            Path::new(&protocol),
            &output,
            &artwork,
            &ReleaseMetadata::default(),
            &TrackMetadata::default(),
        );
        assert!(
            inspected.is_err(),
            "Inspection accepted a non-file protocol"
        );
        assert!(
            exported.is_err(),
            "Master export accepted a non-file protocol"
        );
        assert!(!output.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn wash_export_rejects_cross_track_source_replacement_before_writing_artwork() {
        let directory = test_directory("wash-cross-track-source");
        let package = directory.join("Package");
        fs::create_dir_all(package.join("Masters")).unwrap();
        fs::create_dir_all(package.join("Artwork")).unwrap();
        let first_source = directory.join("first.wav");
        let later_source = package.join("Masters/01.wav");
        fs::write(&first_source, b"first source").unwrap();
        fs::write(&later_source, b"later source").unwrap();
        fs::write(package.join("Artwork/Cover.png"), b"existing cover").unwrap();
        let result = export_release(ExportRequest {
            output_dir: directory.to_string_lossy().into_owned(),
            folder_name: "Package".into(),
            artwork_data_url: TEST_ARTWORK_DATA_URL.into(),
            artwork_file_name: "Cover.png".into(),
            web_artwork_file_name: "Web.jpg".into(),
            release: ReleaseMetadata::default(),
            tracks: vec![
                ExportTrack {
                    id: "first".into(),
                    path: first_source.to_string_lossy().into_owned(),
                    output_file_name: "01.wav".into(),
                    metadata: TrackMetadata::default(),
                },
                ExportTrack {
                    id: "later".into(),
                    path: later_source.to_string_lossy().into_owned(),
                    output_file_name: "02.wav".into(),
                    metadata: TrackMetadata::default(),
                },
            ],
            text_files: Vec::new(),
        });
        assert!(result.is_err_and(|error| error.contains("replace an input file")));
        assert_eq!(fs::read(&first_source).unwrap(), b"first source");
        assert_eq!(fs::read(&later_source).unwrap(), b"later source");
        assert_eq!(
            fs::read(package.join("Artwork/Cover.png")).unwrap(),
            b"existing cover"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn wash_canvas_export_rejects_symlinked_media_directory() {
        use std::os::unix::fs::symlink;
        let directory = test_directory("wash-canvas-symlink");
        let package = directory.join("Package");
        let outside = directory.join("Outside");
        fs::create_dir_all(&package).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, package.join("Canvases")).unwrap();
        let mut request = canvas_test_request("clean-35mm", "fill");
        request.output_dir = directory.to_string_lossy().into_owned();
        request.folder_name = "Package".into();
        assert!(export_canvases_with_progress(request, |_| {}).is_err());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn wash_duplicate_export_ids_cannot_replace_the_first_cancellation_flag() {
        let id = format!("wash-cancel-{}", crate::storage::unique_suffix());
        let first = ActiveVideoExport::register(&id).unwrap();
        assert!(ActiveVideoExport::register(&id).is_err());
        assert!(cancel_video_export(id.clone()).unwrap());
        assert!(first.cancel.load(Ordering::Relaxed));
        drop(first);
        assert!(!cancel_video_export(id.clone()).unwrap());
        assert!(ActiveVideoExport::register(&id).is_ok());
    }

    #[test]
    fn wash_overlapping_canvas_previews_keep_each_workers_inputs_until_completion() {
        use std::sync::mpsc;
        use std::time::Duration;
        let (started_tx, started_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        let make_request = || CanvasExportRequest {
            duration_seconds: 3.0,
            ..canvas_test_request("clean-35mm", "fill")
        };
        let first_request = make_request();
        let first = std::thread::spawn(move || {
            let mut paused = false;
            render_canvas_preview_with_progress(
                first_request,
                Arc::new(AtomicBool::new(false)),
                |progress| {
                    if !paused && progress.phase == "encoding" {
                        paused = true;
                        started_tx.send(()).unwrap();
                        resume_rx.recv_timeout(Duration::from_secs(60)).unwrap();
                    }
                },
            )
        });
        started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let second = render_canvas_preview_with_progress(
            make_request(),
            Arc::new(AtomicBool::new(false)),
            |_| {},
        );
        resume_tx.send(()).unwrap();
        let first = first.join().unwrap();
        assert!(second.is_ok(), "The second preview failed: {second:?}");
        let path =
            PathBuf::from(first.expect("The second preview removed the first worker's input"));
        assert!(path.is_file());
        if let Some(directory) = LAST_CANVAS_PREVIEW.get().unwrap().lock().unwrap().take() {
            fs::remove_dir_all(directory).unwrap();
        }
    }
}

#[tauri::command]
pub(crate) async fn prep_inspect_audio(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<Vec<AudioInfo>, String> {
    super::require_active_license(&app)?;
    super::background(move || inspect_audio(paths)).await
}

#[tauri::command]
pub(crate) async fn prep_allow_audio_preview(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    super::require_active_license(&app)?;
    super::background(move || allow_audio_preview(app, path)).await
}

#[tauri::command]
pub(crate) async fn prep_allow_visual_preview(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    super::require_active_license(&app)?;
    super::background(move || allow_visual_preview(app, path)).await
}

#[tauri::command]
pub(crate) async fn prep_reveal_file_in_finder(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    super::require_active_license(&app)?;
    super::background(move || reveal_file_in_finder(path)).await
}

#[tauri::command]
pub(crate) async fn prep_read_file_data_url(
    app: tauri::AppHandle,
    path: String,
) -> Result<FileDataUrl, String> {
    super::require_active_license(&app)?;
    super::background(move || read_file_data_url(path)).await
}

#[tauri::command]
pub(crate) async fn prep_openai_api_key_status(
    app: tauri::AppHandle,
) -> Result<ApiKeyStatus, String> {
    super::require_active_license(&app)?;
    super::background(move || openai_api_key_status()).await
}

#[tauri::command]
pub(crate) async fn prep_save_openai_api_key(
    app: tauri::AppHandle,
    api_key: String,
) -> Result<ApiKeyStatus, String> {
    super::require_active_license(&app)?;
    super::background(move || save_openai_api_key(api_key)).await
}

#[tauri::command]
pub(crate) async fn prep_remove_openai_api_key(
    app: tauri::AppHandle,
) -> Result<ApiKeyStatus, String> {
    super::require_active_license(&app)?;
    super::background(move || remove_openai_api_key()).await
}

#[tauri::command]
pub(crate) async fn prep_generate_release_copy(
    app: tauri::AppHandle,
    request: OpenAiDraftRequest,
) -> Result<Value, String> {
    super::require_active_license(&app)?;
    generate_release_copy(request).await
}

#[tauri::command]
pub(crate) async fn prep_copy_text_to_clipboard(
    app: tauri::AppHandle,
    text: String,
) -> Result<(), String> {
    super::require_active_license(&app)?;
    super::background(move || copy_text_to_clipboard(text)).await
}

#[tauri::command]
pub(crate) async fn prep_update_non_music_files(
    app: tauri::AppHandle,
    request: NonMusicUpdateRequest,
) -> Result<NonMusicUpdateResult, String> {
    super::require_active_license(&app)?;
    super::background(move || update_non_music_files(request)).await
}

#[tauri::command]
pub(crate) async fn prep_export_release(
    app: tauri::AppHandle,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    super::require_active_license(&app)?;
    super::background(move || export_release(request)).await
}

#[tauri::command]
pub(crate) async fn prep_export_track_videos(
    app: tauri::AppHandle,
    request: VideoExportRequest,
) -> Result<VideoExportResult, String> {
    super::require_active_license(&app)?;
    export_track_videos(app, request).await
}

#[tauri::command]
pub(crate) async fn prep_export_canvases(
    app: tauri::AppHandle,
    request: CanvasExportRequest,
) -> Result<VideoExportResult, String> {
    super::require_active_license(&app)?;
    export_canvases(app, request).await
}

#[tauri::command]
pub(crate) async fn prep_render_canvas_preview(
    app: tauri::AppHandle,
    request: CanvasExportRequest,
) -> Result<String, String> {
    super::require_active_license(&app)?;
    render_canvas_preview(app, request).await
}

#[tauri::command]
pub(crate) async fn prep_cancel_video_export(
    app: tauri::AppHandle,
    export_id: String,
) -> Result<bool, String> {
    super::require_active_license(&app)?;
    super::background(move || cancel_video_export(export_id)).await
}

#[tauri::command]
pub(crate) async fn prep_read_project(
    app: tauri::AppHandle,
    path: String,
) -> Result<Value, String> {
    super::require_active_license(&app)?;
    super::background(move || {
        let source = Path::new(&path);
        if source.extension().and_then(|s| s.to_str()) != Some("json") {
            return Err("Choose a Release Preparer JSON project.".into());
        }
        if fs::metadata(source).map_err(|e| e.to_string())?.len() > 64 * 1024 * 1024 {
            return Err("This project is too large to import.".into());
        }
        let value: Value = serde_json::from_slice(&fs::read(source).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if !value.get("fields").is_some_and(Value::is_object)
            || !value.get("masters").is_some_and(Value::is_array)
        {
            return Err("This is not a Release Preparer project.".into());
        }
        Ok(value)
    })
    .await
}
