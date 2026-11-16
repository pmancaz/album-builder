// This Rust layer keeps the desktop-only jobs in one place: saving lightweight
// album project files and creating tagged export copies through the local FFmpeg.
mod analysis_cache;
mod export;
mod library;
mod preparation;
mod storage;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

// Serialize read/change/write operations so two windows or quick clicks cannot
// replace each other's project changes or licence activation.
static PROJECT_OPERATIONS: Mutex<()> = Mutex::new(());
static LICENSE_OPERATIONS: Mutex<()> = Mutex::new(());

#[derive(Default)]
struct CloseState {
    approved: AtomicBool,
}

// These public IDs deliberately live in the app, rather than a secret API key.
// They make sure a key belongs to Album Builder's live Lemon Squeezy product,
// rather than another product in the same store.
const LEMON_SQUEEZY_STORE_ID: u64 = 436_578;
const LEMON_SQUEEZY_PRODUCT_ID: u64 = 1_238_239;
const LEMON_SQUEEZY_VARIANT_ID: u64 = 1_935_707;
const LEMON_LICENSE_API: &str = "https://api.lemonsqueezy.com/v1/licenses";
const OFFLINE_GRACE_PERIOD_MS: i64 = 30 * 24 * 60 * 60 * 1000;

// This is the small amount of local information needed to recognise one licensed
// installation. Album projects and audio files remain entirely separate from it.
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredLicense {
    license_key: String,
    customer_email: String,
    instance_id: String,
    instance_name: String,
    activated_at_ms: i64,
    last_validated_at_ms: i64,
    is_valid: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActivateLicenseRequest {
    license_key: String,
    customer_email: String,
}

// This deliberately contains only safe-to-show details. The full licence key is
// never sent back to the interface after it has been saved in the app-data folder.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LicenseStatus {
    licensing_required: bool,
    configured: bool,
    active: bool,
    grace_period_active: bool,
    requires_activation: bool,
    customer_email: Option<String>,
    key_hint: Option<String>,
    last_validated_at_ms: Option<i64>,
    message: String,
}

#[derive(Deserialize)]
#[serde(default)]
struct LemonLicenseResponse {
    activated: Option<bool>,
    deactivated: Option<bool>,
    valid: Option<bool>,
    error: Option<String>,
    license_key: Option<LemonLicenseKey>,
    instance: Option<LemonLicenseInstance>,
    meta: Option<LemonLicenseMeta>,
}

#[derive(Deserialize)]
#[serde(default)]
struct LemonLicenseKey {
    status: String,
}

#[derive(Deserialize)]
#[serde(default)]
struct LemonLicenseInstance {
    id: String,
}

#[derive(Deserialize)]
#[serde(default)]
struct LemonLicenseMeta {
    store_id: u64,
    product_id: u64,
    variant_id: u64,
    customer_email: String,
}

impl Default for LemonLicenseResponse {
    fn default() -> Self {
        Self {
            activated: None,
            deactivated: None,
            valid: None,
            error: None,
            license_key: None,
            instance: None,
            meta: None,
        }
    }
}
impl Default for LemonLicenseKey {
    fn default() -> Self {
        Self {
            status: String::new(),
        }
    }
}
impl Default for LemonLicenseInstance {
    fn default() -> Self {
        Self { id: String::new() }
    }
}
impl Default for LemonLicenseMeta {
    fn default() -> Self {
        Self {
            store_id: 0,
            product_id: 0,
            variant_id: 0,
            customer_email: String::new(),
        }
    }
}

fn licensing_is_configured() -> bool {
    LEMON_SQUEEZY_STORE_ID != 0 && LEMON_SQUEEZY_PRODUCT_ID != 0 && LEMON_SQUEEZY_VARIANT_ID != 0
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn license_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("license.json"))
}

fn read_stored_license(app: &tauri::AppHandle) -> Result<Option<StoredLicense>, String> {
    let file = license_file(app)?;
    if !file.exists() && !storage::backup_path(&file).exists() {
        return Ok(None);
    }
    storage::read_json(&file, |_: &StoredLicense| Ok(())).map(Some)
}

fn write_stored_license(app: &tauri::AppHandle, license: &StoredLicense) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(license).map_err(|error| error.to_string())?;
    storage::write_json(&license_file(app)?, &bytes)
}

fn masked_key(license_key: &str) -> String {
    let ending: String = license_key
        .chars()
        .rev()
        .take(8)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!("••••{ending}")
}

fn licence_status(saved: Option<StoredLicense>, message: impl Into<String>) -> LicenseStatus {
    let configured = licensing_is_configured();
    let grace_period_active = saved.as_ref().is_some_and(|license| {
        license.is_valid
            && now_ms().saturating_sub(license.last_validated_at_ms) <= OFFLINE_GRACE_PERIOD_MS
    });
    LicenseStatus {
        licensing_required: true,
        configured,
        active: configured && grace_period_active,
        grace_period_active,
        // A saved valid key can be checked again without asking the customer to
        // type it. Only a missing or invalid stored activation needs the form.
        requires_activation: match saved.as_ref() {
            Some(license) => !license.is_valid,
            None => true,
        },
        customer_email: saved.as_ref().map(|license| license.customer_email.clone()),
        key_hint: saved
            .as_ref()
            .map(|license| masked_key(&license.license_key)),
        last_validated_at_ms: saved.as_ref().map(|license| license.last_validated_at_ms),
        message: message.into(),
    }
}

fn lemon_error(response: &LemonLicenseResponse, fallback: &str) -> String {
    response
        .error
        .clone()
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}

// Lemon Squeezy's licence API does not use the store's private API token. The
// customer-provided key is posted directly over HTTPS to the documented endpoint.
fn call_lemon_license_api(
    endpoint: &str,
    fields: &[(&str, &str)],
) -> Result<LemonLicenseResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| "Album Builder could not prepare a secure licence check.".to_owned())?;
    let response = client.post(format!("{LEMON_LICENSE_API}/{endpoint}"))
    .header("Accept", "application/json")
    .form(fields)
    .send()
    .map_err(|_| "Album Builder could not reach Lemon Squeezy. Check your internet connection and try again.".to_owned())?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|_| "Lemon Squeezy sent an unreadable licence response.".to_owned())?;
    let parsed: LemonLicenseResponse = serde_json::from_str(&body)
        .map_err(|_| "Lemon Squeezy sent an unreadable licence response.".to_owned())?;
    if !status.is_success() {
        return Err(lemon_error(
            &parsed,
            "Lemon Squeezy could not verify that licence.",
        ));
    }
    Ok(parsed)
}

fn confirm_product_and_email(
    response: &LemonLicenseResponse,
    customer_email: &str,
) -> Result<(), String> {
    let meta = response
        .meta
        .as_ref()
        .ok_or_else(|| "Lemon Squeezy did not return the licence owner details.".to_owned())?;
    if meta.store_id != LEMON_SQUEEZY_STORE_ID
        || meta.product_id != LEMON_SQUEEZY_PRODUCT_ID
        || meta.variant_id != LEMON_SQUEEZY_VARIANT_ID
    {
        return Err("That licence does not belong to this edition of Album Builder.".to_owned());
    }
    if !meta
        .customer_email
        .trim()
        .eq_ignore_ascii_case(customer_email.trim())
    {
        return Err(
            "That email address does not match the email used to buy this licence.".to_owned(),
        );
    }
    Ok(())
}

// Licensing is deliberately absent from the default prototype's behavior.
// No environment variable, saved key or network check is needed to use it.
fn licensing_required() -> bool {
    cfg!(feature = "licensed-release")
}

fn prototype_license_status() -> LicenseStatus {
    LicenseStatus {
        licensing_required: false,
        configured: false,
        active: true,
        grace_period_active: false,
        requires_activation: false,
        customer_email: None,
        key_hint: None,
        last_validated_at_ms: None,
        message: "Prototype build — no licence or activation required.".into(),
    }
}

fn require_active_license(app: &tauri::AppHandle) -> Result<(), String> {
    if !licensing_required() {
        return Ok(());
    }
    // A debug build stays usable while the store IDs are being wired up. Release
    // builds never take this path, so it cannot unlock the sold application.
    if cfg!(debug_assertions) && !licensing_is_configured() {
        return Ok(());
    }
    let stored = read_stored_license(app)?;
    if licence_status(stored, "").active {
        Ok(())
    } else {
        Err("Activate Album Builder to use saved projects and exports.".to_owned())
    }
}

fn get_license_state_impl(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    if !licensing_required() {
        return Ok(prototype_license_status());
    }
    let _operation = LICENSE_OPERATIONS.lock().map_err(|_| {
        "A licence operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    if !licensing_is_configured() {
        return Ok(licence_status(
            None,
            "This build has not yet been connected to the Album Builder Lemon Squeezy product.",
        ));
    }
    let stored = read_stored_license(&app)?;
    let message = if stored.is_some() {
        "Your saved activation will be checked when the app opens."
    } else {
        "Enter the licence key and checkout email from your Lemon Squeezy receipt."
    };
    Ok(licence_status(stored, message))
}

fn activate_license_impl(
    app: tauri::AppHandle,
    request: ActivateLicenseRequest,
) -> Result<LicenseStatus, String> {
    if !licensing_required() {
        return Ok(prototype_license_status());
    }
    let _operation = LICENSE_OPERATIONS.lock().map_err(|_| {
        "A licence operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    if !licensing_is_configured() {
        return Err(
            "This build has not yet been connected to the Album Builder Lemon Squeezy product."
                .to_owned(),
        );
    }
    let license_key = request.license_key.trim();
    let customer_email = request.customer_email.trim();
    if license_key.is_empty() || customer_email.is_empty() {
        return Err("Enter both the licence key and the checkout email address.".to_owned());
    }

    // Checking before activation avoids spending one of the customer's Mac slots
    // when they accidentally type a key or email for a different product.
    let preflight = call_lemon_license_api("validate", &[("license_key", license_key)])?;
    if preflight.valid != Some(true) {
        return Err(lemon_error(
            &preflight,
            "That licence key is not currently valid.",
        ));
    }
    confirm_product_and_email(&preflight, customer_email)?;

    let instance_name = "Album Builder on this Mac";
    let activated = call_lemon_license_api(
        "activate",
        &[
            ("license_key", license_key),
            ("instance_name", instance_name),
        ],
    )?;
    if activated.activated != Some(true) {
        return Err(lemon_error(&activated, "Lemon Squeezy could not activate this Mac. Its activation limit may have been reached."));
    }
    confirm_product_and_email(&activated, customer_email)?;
    let instance_id = activated
        .instance
        .as_ref()
        .map(|instance| instance.id.trim())
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "Lemon Squeezy did not return an activation for this Mac.".to_owned())?;
    let status = activated
        .license_key
        .as_ref()
        .map(|license| license.status.as_str())
        .unwrap_or_default();
    if status != "active" {
        return Err("That licence is not active.".to_owned());
    }

    let now = now_ms();
    let stored = StoredLicense {
        license_key: license_key.to_owned(),
        customer_email: customer_email.to_owned(),
        instance_id: instance_id.to_owned(),
        instance_name: instance_name.to_owned(),
        activated_at_ms: now,
        last_validated_at_ms: now,
        is_valid: true,
    };
    write_stored_license(&app, &stored)?;
    Ok(licence_status(
        Some(stored),
        "Album Builder is activated on this Mac.",
    ))
}

fn validate_license_impl(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    if !licensing_required() {
        return Ok(prototype_license_status());
    }
    let _operation = LICENSE_OPERATIONS.lock().map_err(|_| {
        "A licence operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    if !licensing_is_configured() {
        return Ok(licence_status(
            None,
            "This build has not yet been connected to the Album Builder Lemon Squeezy product.",
        ));
    }
    let Some(mut stored) = read_stored_license(&app)? else {
        return Ok(licence_status(
            None,
            "Enter the licence key and checkout email from your Lemon Squeezy receipt.",
        ));
    };
    let response = match call_lemon_license_api(
        "validate",
        &[
            ("license_key", stored.license_key.as_str()),
            ("instance_id", stored.instance_id.as_str()),
        ],
    ) {
        Ok(response) => response,
        Err(message) => {
            let still_within_grace = licence_status(Some(stored.clone()), "").active;
            let next_step = if still_within_grace {
                " Your previous verification remains valid for up to 30 days."
            } else {
                " Connect to the internet to check your saved licence; you do not need to enter it again."
            };
            return Ok(licence_status(
                Some(stored),
                format!("{message}{next_step}"),
            ));
        }
    };
    if response.valid == Some(true)
        && confirm_product_and_email(&response, &stored.customer_email).is_ok()
    {
        stored.last_validated_at_ms = now_ms();
        stored.is_valid = true;
        write_stored_license(&app, &stored)?;
        return Ok(licence_status(
            Some(stored),
            "Licence verified with Lemon Squeezy.",
        ));
    }
    stored.is_valid = false;
    write_stored_license(&app, &stored)?;
    Ok(licence_status(
        Some(stored),
        lemon_error(
            &response,
            "This activation is no longer valid. Enter a current licence key to continue.",
        ),
    ))
}

fn deactivate_license_impl(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    if !licensing_required() {
        return Ok(prototype_license_status());
    }
    let _operation = LICENSE_OPERATIONS.lock().map_err(|_| {
        "A licence operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    let Some(stored) = read_stored_license(&app)? else {
        return Ok(licence_status(None, "There is no activation on this Mac."));
    };
    let response = call_lemon_license_api(
        "deactivate",
        &[
            ("license_key", stored.license_key.as_str()),
            ("instance_id", stored.instance_id.as_str()),
        ],
    )?;
    if response.deactivated != Some(true) {
        return Err(lemon_error(
            &response,
            "Lemon Squeezy could not deactivate this Mac.",
        ));
    }
    let file = license_file(&app)?;
    storage::delete_json(&file)
        .map_err(|_| "Album Builder could not clear its local activation.".to_owned())?;
    Ok(licence_status(
        None,
        "This Mac has been deactivated. You can now use the licence on another Mac.",
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    name: String,
    updated_at: String,
    archived: bool,
}

#[derive(Default, Deserialize, Serialize, Clone)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
struct ExportMetadata {
    title: String,
    artist: String,
    album_artist: String,
    year: String,
    genre: String,
    composer: String,
    disc_number: String,
    label: String,
    catalogue: String,
    comment: String,
    compilation: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportTrack {
    path: String,
    title: String,
    index: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    output_dir: String,
    artwork_path: Option<String>,
    metadata: ExportMetadata,
    tracks: Vec<ExportTrack>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResult {
    exported: usize,
    failed: usize,
    failures: Vec<ExportFailure>,
    warnings: Vec<String>,
    output_dir: String,
}

#[derive(Serialize)]
struct ExportFailure {
    path: String,
    message: String,
}

// The project folder holds compact JSON references. It intentionally does not duplicate large source audio files.
fn projects_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    library::projects_dir(&data)
}

// Album/track labels become a single portable name, never a path component
// such as "." or "..". Limit bytes without splitting a Unicode character.
fn safe_file_stem(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '-'
            } else {
                character
            }
        })
        .collect();
    let mut result = String::new();
    for character in cleaned.trim().trim_matches('.').chars() {
        if result.len() + character.len_utf8() > 160 {
            break;
        }
        result.push(character);
    }
    if result.trim().is_empty() {
        "Untitled album".to_owned()
    } else {
        result
    }
}

fn project_path(directory: &Path, id: &str) -> Result<PathBuf, String> {
    // IDs are generated by the app, not from album titles. Reject ambiguous
    // IDs instead of silently mapping two different records onto one filename.
    if id.is_empty()
        || id.len() > 160
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("The saved album has an invalid project ID.".to_owned());
    }
    Ok(directory.join(format!("{id}.json")))
}

fn validate_project(project: &Value) -> Result<(), String> {
    if !project.is_object() {
        return Err("Expected a saved album object.".to_owned());
    }
    if project
        .get("schemaVersion")
        .is_some_and(|version| version.as_u64().map_or(true, |version| version > 2))
    {
        return Err("This album requires a newer version of Album Builder.".into());
    }
    if project
        .get("id")
        .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return Err("The saved album's ID must be text.".to_owned());
    }
    for name in ["tracks", "materials", "references", "albumNoteEntries"] {
        if let Some(value) = project.get(name) {
            if !value.is_array() {
                return Err(format!("The saved album's {name} must be a list."));
            }
        }
    }
    if project
        .get("metadata")
        .is_some_and(|value| !value.is_object())
    {
        return Err("The saved album's metadata must be an object.".to_owned());
    }
    Ok(())
}

fn read_project(path: &Path) -> Result<Value, String> {
    storage::read_json_guarded(
        path,
        |project: &Value| {
            if project
                .get("schemaVersion")
                .and_then(Value::as_u64)
                .is_some_and(|version| version > 2)
            {
                return Err("This album requires a newer version of Album Builder.".into());
            }
            Ok(())
        },
        |project: &Value| {
            validate_project(project)?;
            let expected = path.file_stem().and_then(|name| name.to_str());
            if project.get("id").and_then(Value::as_str) != expected {
                return Err("The saved album ID does not match its filename.".to_owned());
            }
            Ok(())
        },
    )
}

fn saved_media_paths(project: &Value) -> Result<Vec<PathBuf>, String> {
    let mut paths = std::collections::BTreeSet::new();
    let mut add = |value: Option<&Value>, artwork: bool| -> Result<(), String> {
        let Some(value) = value.filter(|value| !value.is_null()) else {
            return Ok(());
        };
        let text = value
            .as_str()
            .ok_or_else(|| "A saved media path must be text.".to_owned())?;
        if text.is_empty() {
            return Ok(());
        }
        let path = PathBuf::from(text);
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_lowercase();
        let supported = if artwork {
            matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp")
        } else {
            matches!(
                extension.as_str(),
                "wav" | "aif" | "aiff" | "flac" | "mp3" | "m4a" | "aac" | "ogg" | "opus"
            )
        };
        if !path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
            || text.contains('\0')
            || !supported
        {
            return Err("A saved media path is not an absolute supported audio or artwork file. Choose the original file again.".to_owned());
        }
        paths.insert(path);
        Ok(())
    };
    for collection in ["tracks", "materials", "references"] {
        if let Some(items) = project.get(collection).and_then(Value::as_array) {
            for item in items {
                if !item.is_object() {
                    return Err(format!("A saved item in {collection} must be an object."));
                }
                add(item.get("nativePath"), false)?;
            }
        }
    }
    add(project.get("artworkNativePath"), true)?;
    Ok(paths.into_iter().collect())
}

fn project_summary(value: &Value) -> ProjectSummary {
    ProjectSummary {
        id: value
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        name: value
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Untitled album")
            .to_owned(),
        updated_at: value
            .get("updatedAt")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
        // Older project files did not have this flag, so they remain normal saved albums by default.
        archived: value
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

fn save_project_impl(app: tauri::AppHandle, mut project: Value) -> Result<ProjectSummary, String> {
    require_active_license(&app)?;
    let _operation = PROJECT_OPERATIONS.lock().map_err(|_| {
        "A project save was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    validate_project(&project)?;
    let id = project
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("album-{}-{}", now_ms(), storage::unique_suffix()));
    let destination = project_path(&projects_dir(&app)?, &id)?;
    project["id"] = Value::String(id);
    let bytes = serde_json::to_vec_pretty(&project).map_err(|error| error.to_string())?;
    storage::write_json(&destination, &bytes)?;
    Ok(project_summary(&project))
}

fn list_projects_in(directory: &Path) -> Result<Vec<ProjectSummary>, String> {
    let mut paths = std::collections::BTreeSet::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
            paths.insert(path);
        } else if let Some(name) = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_suffix(".json.bak"))
        {
            // A lost primary file can still be recovered from the previous save.
            paths.insert(directory.join(format!("{name}.json")));
        }
    }
    let mut projects = Vec::new();
    for path in paths {
        let project = read_project(&path)?;
        let summary = project_summary(&project);
        let expected = project_path(directory, &summary.id)?;
        if expected != path {
            return Err(format!(
                "Saved album ID does not match {}. Keep this file and restore a known good copy.",
                path.display()
            ));
        }
        projects.push(summary);
    }
    projects.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(projects)
}

fn list_projects_impl(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, String> {
    require_active_license(&app)?;
    let _operation = PROJECT_OPERATIONS.lock().map_err(|_| {
        "A project operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    list_projects_in(&projects_dir(&app)?)
}

fn load_project_impl(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    require_active_license(&app)?;
    let _operation = PROJECT_OPERATIONS.lock().map_err(|_| {
        "A project operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    let project = read_project(&project_path(&projects_dir(&app)?, &id)?)?;
    if project.get("id").and_then(Value::as_str) != Some(id.as_str()) {
        return Err("The saved album ID does not match its filename. Keep the file and restore a known good copy.".to_owned());
    }
    // The file picker grants asset access only for the current run. Restore
    // exact saved file permissions so albums on external drives can reopen;
    // this never grants an entire drive or directory to the web interface.
    let scope = app.asset_protocol_scope();
    for path in saved_media_paths(&project)? {
        scope
            .allow_file(path)
            .map_err(|error| format!("Could not restore access to a saved media file: {error}"))?;
    }
    Ok(project)
}

fn delete_project_impl(app: tauri::AppHandle, id: String) -> Result<(), String> {
    require_active_license(&app)?;
    let _operation = PROJECT_OPERATIONS.lock().map_err(|_| {
        "A project operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    let source = project_path(&projects_dir(&app)?, &id)?;
    storage::delete_json(&source)
}

fn set_project_archived_impl(
    app: tauri::AppHandle,
    id: String,
    archived: bool,
) -> Result<(), String> {
    require_active_license(&app)?;
    let _operation = PROJECT_OPERATIONS.lock().map_err(|_| {
        "A project operation was interrupted. Restart Album Builder and try again.".to_owned()
    })?;
    let source = project_path(&projects_dir(&app)?, &id)?;
    let mut project = read_project(&source)?;
    project["archived"] = Value::Bool(archived);
    let bytes = serde_json::to_vec_pretty(&project).map_err(|error| error.to_string())?;
    storage::write_json(&source, &bytes)
}

fn ffmpeg_path() -> &'static str {
    // macOS app bundles do not automatically inherit shell PATH values. Homebrew's normal ARM path is checked first.
    if Path::new("/opt/homebrew/bin/ffmpeg").exists() {
        "/opt/homebrew/bin/ffmpeg"
    } else if Path::new("/usr/local/bin/ffmpeg").exists() {
        "/usr/local/bin/ffmpeg"
    } else {
        "ffmpeg"
    }
}

fn append_metadata(
    command: &mut Command,
    metadata: &ExportMetadata,
    track: &ExportTrack,
    total: usize,
) {
    command
        .arg("-metadata")
        .arg(format!("title={}", track.title));
    command
        .arg("-metadata")
        .arg(format!("album={}", metadata.title));
    command
        .arg("-metadata")
        .arg(format!("track={}/{}", track.index, total));
    if !metadata.artist.is_empty() {
        command
            .arg("-metadata")
            .arg(format!("artist={}", metadata.artist));
    }
    if !metadata.album_artist.is_empty() {
        command
            .arg("-metadata")
            .arg(format!("album_artist={}", metadata.album_artist));
    }
    if !metadata.year.is_empty() {
        command
            .arg("-metadata")
            .arg(format!("date={}", metadata.year));
    }
    if !metadata.genre.is_empty() {
        command
            .arg("-metadata")
            .arg(format!("genre={}", metadata.genre));
    }
    if !metadata.composer.is_empty() {
        command
            .arg("-metadata")
            .arg(format!("composer={}", metadata.composer));
    }
    if !metadata.disc_number.is_empty() {
        command
            .arg("-metadata")
            .arg(format!("disc={}", metadata.disc_number));
    }
    if !metadata.label.is_empty() {
        command
            .arg("-metadata")
            .arg(format!("publisher={}", metadata.label));
    }
    if !metadata.catalogue.is_empty() {
        command
            .arg("-metadata")
            .arg(format!("CATALOGNUMBER={}", metadata.catalogue));
    }
    if !metadata.comment.is_empty() {
        command
            .arg("-metadata")
            .arg(format!("comment={}", metadata.comment));
    }
    if metadata.compilation {
        command.arg("-metadata").arg("compilation=1");
    }
}

// A readable companion file is more useful to a label than a machine-oriented JSON manifest.
// It also preserves the intended release information beside WAV files, which remain untagged.
fn metadata_text(metadata: &ExportMetadata, tracks: &[ExportTrack]) -> String {
    let mut lines = vec![
        format!("Album: {}", metadata.title),
        format!("Artist: {}", metadata.artist),
        format!("Album artist: {}", metadata.album_artist),
        format!("Year: {}", metadata.year),
        format!("Genre: {}", metadata.genre),
        format!("Composer: {}", metadata.composer),
        format!("Disc number: {}", metadata.disc_number),
        format!("Label: {}", metadata.label),
        format!("Catalogue: {}", metadata.catalogue),
        format!(
            "Compilation: {}",
            if metadata.compilation { "Yes" } else { "No" }
        ),
    ];
    if !metadata.comment.is_empty() {
        lines.push(format!("Comment: {}", metadata.comment));
    }
    lines.push(String::new());
    lines.push("Track listing:".to_owned());
    for track in tracks {
        lines.push(format!("{:02}. {}", track.index, track.title));
    }
    lines.push(String::new());
    lines.push("Source audio is unchanged. MP3, M4A, FLAC and AIFF exports support embedded metadata and artwork. Ogg and Opus keep metadata with separate artwork. WAV and raw AAC use this text file for release information.".to_owned());
    lines.join("\n") + "\n"
}

fn export_album_impl(
    app: tauri::AppHandle,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    require_active_license(&app)?;
    export::export_to_folder(request)
}

// Blocking file/network/process work runs on Tauri's blocking worker pool.
// The window can repaint and respond while a licence check or export is busy.
async fn background<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("A background operation could not finish: {error}"))?
}

#[tauri::command]
async fn read_analysis_cache(
    app: tauri::AppHandle,
    kind: String,
    key: String,
) -> Result<Option<Value>, String> {
    background(move || {
        let _lock = PROJECT_OPERATIONS
            .lock()
            .map_err(|_| "Library operation interrupted")?;
        Ok(analysis_cache::read(&projects_dir(&app)?, &kind, &key))
    })
    .await
}
#[tauri::command]
async fn write_analysis_cache(
    app: tauri::AppHandle,
    kind: String,
    key: String,
    value: Value,
) -> Result<(), String> {
    background(move || {
        require_active_license(&app)?;
        let _lock = PROJECT_OPERATIONS
            .lock()
            .map_err(|_| "Library operation interrupted")?;
        analysis_cache::write(&projects_dir(&app)?, &kind, &key, &value)
    })
    .await
}

#[tauri::command]
async fn get_license_state(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    background(move || get_license_state_impl(app)).await
}
#[tauri::command]
async fn activate_license(
    app: tauri::AppHandle,
    request: ActivateLicenseRequest,
) -> Result<LicenseStatus, String> {
    background(move || activate_license_impl(app, request)).await
}
#[tauri::command]
async fn validate_license(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    background(move || validate_license_impl(app)).await
}
#[tauri::command]
async fn deactivate_license(app: tauri::AppHandle) -> Result<LicenseStatus, String> {
    background(move || deactivate_license_impl(app)).await
}
#[tauri::command]
async fn get_library_location(app: tauri::AppHandle) -> Result<library::LibraryLocation, String> {
    background(move || {
        let _operation = PROJECT_OPERATIONS
            .lock()
            .map_err(|_| "A library operation was interrupted.".to_owned())?;
        library::location(&app.path().app_data_dir().map_err(|e| e.to_string())?)
    })
    .await
}
#[tauri::command]
async fn change_library_location(
    app: tauri::AppHandle,
    path: Option<PathBuf>,
) -> Result<library::LibraryLocation, String> {
    background(move || {
        require_active_license(&app)?;
        let _operation = PROJECT_OPERATIONS
            .lock()
            .map_err(|_| "A library operation was interrupted.".to_owned())?;
        library::change_location(&app.path().app_data_dir().map_err(|e| e.to_string())?, path)
    })
    .await
}
#[tauri::command]
async fn save_project(app: tauri::AppHandle, project: Value) -> Result<ProjectSummary, String> {
    background(move || save_project_impl(app, project)).await
}
#[tauri::command]
async fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, String> {
    background(move || list_projects_impl(app)).await
}
#[tauri::command]
async fn load_project(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    background(move || load_project_impl(app, id)).await
}
#[tauri::command]
async fn delete_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    background(move || delete_project_impl(app, id)).await
}
#[tauri::command]
async fn set_project_archived(
    app: tauri::AppHandle,
    id: String,
    archived: bool,
) -> Result<(), String> {
    background(move || set_project_archived_impl(app, id, archived)).await
}
#[tauri::command]
async fn export_album(
    app: tauri::AppHandle,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    background(move || export_album_impl(app, request)).await
}

// Both the red window button and macOS Quit finish at this command, after the
// interface has awaited its pending save. A failed save leaves the app open.
#[tauri::command]
fn confirm_app_close(app: tauri::AppHandle, state: tauri::State<'_, CloseState>) {
    state.approved.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prototype_status_never_requests_an_activation_or_exposes_stored_credentials() {
        let status = prototype_license_status();
        assert!(!status.licensing_required);
        assert!(status.active);
        assert!(!status.requires_activation);
        assert!(!status.configured);
        assert!(status.customer_email.is_none() && status.key_hint.is_none());
        assert_eq!(licensing_required(), cfg!(feature = "licensed-release"));
    }
    #[test]
    fn project_ids_cannot_alias_other_records_or_escape_the_store() {
        let directory = Path::new("/synthetic-projects");
        for id in ["../other", "a/b", "a\\b", "", "..", " a ", "a:b"] {
            assert!(project_path(directory, id).is_err());
        }
        assert_eq!(
            project_path(directory, "album-1234").unwrap(),
            directory.join("album-1234.json")
        );
    }
    #[test]
    fn invalid_project_shapes_are_rejected_without_panicking() {
        for value in [
            serde_json::json!(null),
            serde_json::json!(42),
            serde_json::json!({"tracks": {}}),
            serde_json::json!({"metadata": "bad"}),
            serde_json::json!({"id": 42}),
        ] {
            assert!(validate_project(&value).is_err());
        }
        assert!(validate_project(
            &serde_json::json!({"id": "album-1", "tracks": [], "metadata": {}})
        )
        .is_ok());
    }
    #[test]
    fn library_recovers_missing_primary_and_reports_unrecoverable_record() {
        let directory =
            std::env::temp_dir().join(format!("album-library-test-{}", storage::unique_suffix()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("album-1.json");
        fs::write(
            storage::backup_path(&path),
            br#"{"id":"album-1","name":"Recovered","tracks":[]}"#,
        )
        .unwrap();
        let projects = list_projects_in(&directory).unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "Recovered");
        assert!(path.exists());
        fs::write(directory.join("album-2.json"), b"{").unwrap();
        let error = list_projects_in(&directory).err().unwrap();
        assert!(error.contains("album-2.json"));
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn foreign_backup_id_is_not_restored_over_another_project() {
        let directory =
            std::env::temp_dir().join(format!("album-identity-test-{}", storage::unique_suffix()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("album-1.json");
        fs::write(&path, b"broken").unwrap();
        fs::write(
            storage::backup_path(&path),
            br#"{"id":"album-2","name":"Another album"}"#,
        )
        .unwrap();
        assert!(read_project(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"broken");
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn wash_future_album_version_is_never_rolled_back_to_an_older_backup() {
        let directory =
            std::env::temp_dir().join(format!("album-future-test-{}", storage::unique_suffix()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("album-1.json");
        let future = br#"{"id":"album-1","schemaVersion":3,"name":"Newer work","tracks":[],"futureField":"preserve me"}"#;
        let older = br#"{"id":"album-1","schemaVersion":2,"name":"Old work","tracks":[]}"#;
        fs::write(&path, future).unwrap();
        fs::write(storage::backup_path(&path), older).unwrap();
        let result = read_project(&path);
        assert!(
            result.is_err(),
            "A future album was silently rolled back: {result:?}"
        );
        assert!(result.unwrap_err().contains("newer version"));
        assert_eq!(fs::read(&path).unwrap(), future);
        assert_eq!(fs::read(storage::backup_path(&path)).unwrap(), older);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn saved_media_scope_contains_only_valid_exact_paths_and_deduplicates_them() {
        let project = serde_json::json!({"tracks":[{"nativePath":"/Volumes/Album Drive/Track.WAV"}],"materials":[{"nativePath":"/Volumes/Album Drive/Track.WAV"}],"references":[{"nativePath":"/Volumes/References/reference.flac"}],"artworkNativePath":"/Volumes/Album Drive/cover.jpg"});
        let paths = saved_media_paths(&project).unwrap();
        assert_eq!(paths.len(), 3);
        assert!(paths.contains(&PathBuf::from("/Volumes/Album Drive/Track.WAV")));
        for bad in [
            "relative.wav",
            "/Volumes/../private/track.wav",
            "/private/credentials.json",
            "https://example.test/track.wav",
            "/Volumes/audio",
        ] {
            assert!(
                saved_media_paths(&serde_json::json!({"tracks":[{"nativePath":bad}]})).is_err()
            );
        }
        assert!(
            saved_media_paths(&serde_json::json!({"artworkNativePath":"/Volumes/cover.svg"}))
                .is_err()
        );
        assert!(
            saved_media_paths(&serde_json::json!({"tracks":[{"nativePath":null}]}))
                .unwrap()
                .is_empty()
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CloseState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_analysis_cache,
            write_analysis_cache,
            get_license_state,
            activate_license,
            validate_license,
            deactivate_license,
            get_library_location,
            change_library_location,
            save_project,
            list_projects,
            load_project,
            delete_project,
            set_project_archived,
            export_album,
            preparation::prep_read_project,
            preparation::prep_inspect_audio,
            preparation::prep_allow_audio_preview,
            preparation::prep_allow_visual_preview,
            preparation::prep_reveal_file_in_finder,
            preparation::prep_read_file_data_url,
            preparation::prep_openai_api_key_status,
            preparation::prep_save_openai_api_key,
            preparation::prep_remove_openai_api_key,
            preparation::prep_generate_release_copy,
            preparation::prep_copy_text_to_clipboard,
            preparation::prep_update_non_music_files,
            preparation::prep_export_release,
            preparation::prep_export_track_videos,
            preparation::prep_export_canvases,
            preparation::prep_render_canvas_preview,
            preparation::prep_cancel_video_export,
            confirm_app_close
        ])
        .build(tauri::generate_context!())
        .expect("error while building Album Builder")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.webview_windows().is_empty()
                    && !app.state::<CloseState>().approved.load(Ordering::SeqCst)
                {
                    api.prevent_exit();
                    let _ = app.emit("album-builder://request-close", ());
                }
            }
        });
}
