//! Galley Proof: the desktop side.
//!
//! Everything that touches the disk or the network lives here, so the page
//! never writes files directly. Each book is a plain folder:
//!
//!   Documents/Galley Proof/<Book>/
//!       manuscript.md      the text (chapters start with "# ", italics as *word*)
//!       book.json          title, author, trim size, typeface and so on
//!       Snapshots/         timed copies of manuscript.md
//!
//! Every write goes to a temporary file first and is then renamed over the
//! old one, so a crash or power cut mid-save leaves the last good copy intact.

use chrono::{Local, NaiveDateTime};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const MANUSCRIPT: &str = "manuscript.md";
const BOOK: &str = "book.json";
const SNAPSHOTS: &str = "Snapshots";
const STAMP: &str = "%Y-%m-%d_%H-%M-%S";

type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(context: &str) -> impl FnOnce(E) -> String + '_ {
    move |e| format!("{context}: {e}")
}

/// Write a file safely: temp file, flush to disk, then rename into place.
fn write_atomic(path: &Path, contents: &str) -> Res<()> {
    let dir = path.parent().ok_or("File has no folder")?;
    fs::create_dir_all(dir).map_err(err("Could not create the folder"))?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(".{name}.saving"));
    {
        let mut f = fs::File::create(&tmp).map_err(err("Could not write the file"))?;
        f.write_all(contents.as_bytes()).map_err(err("Could not write the file"))?;
        f.sync_all().map_err(err("Could not finish writing the file"))?;
    }
    fs::rename(&tmp, path).map_err(err("Could not replace the old file"))?;
    Ok(())
}

fn word_count(text: &str) -> usize {
    text.lines()
        .filter(|l| {
            let t = l.trim();
            !(t == "* * *" || t == "***")
        })
        .flat_map(|l| l.split_whitespace())
        .filter(|w| w.chars().any(|c| c.is_alphanumeric()))
        .count()
}

// ---------------------------------------------------------------- settings

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default)]
struct EmailSettings {
    to: String,
    from: String,
    smtp_host: String,
    smtp_port: u16,
    username: String,
    password: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default)]
struct AppConfig {
    /// The book that was open last time.
    last_book: Option<String>,
    email: EmailSettings,
    /// Page templates the writer has measured from real books.
    templates: Vec<serde_json::Value>,
    /// Anything a newer version wrote that this version doesn't know about,
    /// kept so that going back a version never loses settings.
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}

fn config_path(app: &AppHandle) -> Res<PathBuf> {
    let dir = app.path().app_config_dir().map_err(err("No settings folder"))?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
fn get_config(app: AppHandle) -> Res<AppConfig> {
    let p = config_path(&app)?;
    match fs::read_to_string(&p) {
        Ok(s) => Ok(serde_json::from_str(&s).unwrap_or_default()),
        Err(_) => Ok(AppConfig::default()),
    }
}

#[tauri::command]
fn set_config(app: AppHandle, config: AppConfig) -> Res<()> {
    let s = serde_json::to_string_pretty(&config).map_err(err("Bad settings"))?;
    write_atomic(&config_path(&app)?, &s)
}

// ------------------------------------------------------------------- books

fn books_root(app: &AppHandle) -> Res<PathBuf> {
    let docs = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(err("Could not find your Documents folder"))?;
    Ok(docs.join("Galley Proof"))
}

#[derive(Serialize)]
struct BookInfo {
    path: String,
    folder: String,
    title: String,
    words: usize,
    modified: String,
}

#[derive(Serialize)]
struct LoadedBook {
    path: String,
    manuscript: String,
    book: String,
}

#[tauri::command]
fn library_folder(app: AppHandle) -> Res<String> {
    let root = books_root(&app)?;
    fs::create_dir_all(&root).map_err(err("Could not create the Galley Proof folder"))?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_books(app: AppHandle) -> Res<Vec<BookInfo>> {
    let root = books_root(&app)?;
    fs::create_dir_all(&root).map_err(err("Could not create the Galley Proof folder"))?;
    let mut out = vec![];
    for entry in fs::read_dir(&root).map_err(err("Could not read the Galley Proof folder"))? {
        let Ok(entry) = entry else { continue };
        let dir = entry.path();
        let ms = dir.join(MANUSCRIPT);
        if !dir.is_dir() || !ms.exists() {
            continue;
        }
        let text = fs::read_to_string(&ms).unwrap_or_default();
        let modified = fs::metadata(&ms)
            .and_then(|m| m.modified())
            .map(|t| chrono::DateTime::<Local>::from(t).format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default();
        let folder = entry.file_name().to_string_lossy().into_owned();
        let title = fs::read_to_string(dir.join(BOOK))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(str::to_string))
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| folder.clone());
        out.push(BookInfo {
            path: dir.to_string_lossy().into_owned(),
            folder,
            title,
            words: word_count(&text),
            modified,
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

/// Make a folder name that is safe on Windows and Mac and not already taken.
fn safe_folder(root: &Path, title: &str) -> PathBuf {
    let cleaned: String = title
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    let base = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let base = base.trim_matches('.').to_string();
    let base = if base.is_empty() { "Untitled".to_string() } else { base };
    let mut candidate = root.join(&base);
    let mut n = 2;
    while candidate.exists() {
        candidate = root.join(format!("{base} {n}"));
        n += 1;
    }
    candidate
}

#[tauri::command]
fn create_book(app: AppHandle, title: String, manuscript: String, book: String) -> Res<String> {
    let root = books_root(&app)?;
    let dir = safe_folder(&root, &title);
    fs::create_dir_all(&dir).map_err(err("Could not create the book folder"))?;
    write_atomic(&dir.join(BOOK), &book)?;
    write_atomic(&dir.join(MANUSCRIPT), &manuscript)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
fn load_book(path: String) -> Res<LoadedBook> {
    let dir = PathBuf::from(&path);
    let manuscript =
        fs::read_to_string(dir.join(MANUSCRIPT)).map_err(err("Could not open the manuscript"))?;
    let book = fs::read_to_string(dir.join(BOOK)).unwrap_or_else(|_| "{}".into());
    Ok(LoadedBook { path, manuscript, book })
}

#[tauri::command]
fn save_book(path: String, manuscript: String, book: String) -> Res<()> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("The book folder is missing: {path}"));
    }
    write_atomic(&dir.join(MANUSCRIPT), &manuscript)?;
    write_atomic(&dir.join(BOOK), &book)
}

#[tauri::command]
fn reveal_folder(app: AppHandle, path: String) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(err("Could not open the folder"))
}

// --------------------------------------------------------------- snapshots

#[derive(Serialize)]
struct SnapshotInfo {
    file: String,
    when: String,
    words: usize,
}

fn parse_stamp(file: &str) -> Option<NaiveDateTime> {
    let stem = file.strip_suffix(".md")?;
    NaiveDateTime::parse_from_str(stem, STAMP).ok()
}

/// Keep every snapshot from the last 24 hours, the newest of each hour for a
/// week, and the newest of each day after that.
fn prune_snapshots(dir: &Path) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut snaps: Vec<(NaiveDateTime, PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            parse_stamp(&name).map(|t| (t, e.path()))
        })
        .collect();
    snaps.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    let now = Local::now().naive_local();
    let mut seen = HashSet::new();
    for (t, p) in snaps {
        let age = now - t;
        let bucket = if age.num_hours() < 24 {
            continue;
        } else if age.num_days() < 7 {
            t.format("h%Y%m%d%H").to_string()
        } else {
            t.format("d%Y%m%d").to_string()
        };
        if !seen.insert(bucket) {
            let _ = fs::remove_file(p);
        }
    }
}

/// Save a timed copy. Skipped when the text is identical to the newest one.
#[tauri::command]
fn take_snapshot(path: String, manuscript: String) -> Res<bool> {
    let dir = PathBuf::from(&path).join(SNAPSHOTS);
    fs::create_dir_all(&dir).map_err(err("Could not create the Snapshots folder"))?;
    let newest = fs::read_dir(&dir)
        .ok()
        .and_then(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    parse_stamp(&n).map(|t| (t, e.path()))
                })
                .max_by(|a, b| a.0.cmp(&b.0))
        })
        .and_then(|(_, p)| fs::read_to_string(p).ok());
    if newest.as_deref() == Some(manuscript.as_str()) {
        return Ok(false);
    }
    let name = format!("{}.md", Local::now().format(STAMP));
    write_atomic(&dir.join(name), &manuscript)?;
    prune_snapshots(&dir);
    Ok(true)
}

#[tauri::command]
fn list_snapshots(path: String) -> Res<Vec<SnapshotInfo>> {
    let dir = PathBuf::from(&path).join(SNAPSHOTS);
    let Ok(rd) = fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut out: Vec<(NaiveDateTime, SnapshotInfo)> = rd
        .flatten()
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().into_owned();
            let t = parse_stamp(&file)?;
            let words = word_count(&fs::read_to_string(e.path()).unwrap_or_default());
            Some((t, SnapshotInfo { when: t.format("%a %-d %b %Y, %-I:%M %p").to_string(), file, words }))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(out.into_iter().map(|(_, s)| s).collect())
}

#[tauri::command]
fn read_snapshot(path: String, file: String) -> Res<String> {
    if file.contains('/') || file.contains('\\') || parse_stamp(&file).is_none() {
        return Err("Not a snapshot file".into());
    }
    fs::read_to_string(PathBuf::from(&path).join(SNAPSHOTS).join(file))
        .map_err(err("Could not open the snapshot"))
}

// ------------------------------------------------------------------- email

#[tauri::command]
async fn send_email(
    settings: EmailSettings,
    subject: String,
    body: String,
    attachment_name: String,
    attachment: String,
) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        send_email_blocking(settings, subject, body, attachment_name, attachment)
    })
    .await
    .map_err(err("Sending stopped unexpectedly"))?
}

fn send_email_blocking(
    s: EmailSettings,
    subject: String,
    body: String,
    attachment_name: String,
    attachment: String,
) -> Res<()> {
    use lettre::message::{header::ContentType, Attachment, MultiPart, SinglePart};
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    if s.to.trim().is_empty() {
        return Err("Add the address to send to in Book setup.".into());
    }
    if s.smtp_host.trim().is_empty() || s.username.trim().is_empty() || s.password.is_empty() {
        return Err("Finish the email settings in Book setup (server, username, password).".into());
    }
    let from = if s.from.trim().is_empty() { s.username.clone() } else { s.from.clone() };
    let from = from.trim().parse().map_err(err("The sending address isn't valid"))?;

    let mut builder = Message::builder().from(from).subject(subject);
    for addr in s.to.split([',', ';']).map(str::trim).filter(|a| !a.is_empty()) {
        builder = builder.to(addr.parse().map_err(err("An address to send to isn't valid"))?);
    }
    let attach = Attachment::new(attachment_name)
        .body(attachment.into_bytes(), ContentType::parse("text/plain; charset=utf-8").unwrap());
    let email = builder
        .multipart(
            MultiPart::mixed()
                .singlepart(SinglePart::plain(body))
                .singlepart(attach),
        )
        .map_err(err("Could not build the email"))?;

    let host = s.smtp_host.trim();
    let port = if s.smtp_port == 0 { 465 } else { s.smtp_port };
    let relay = if port == 465 {
        SmtpTransport::relay(host)
    } else {
        SmtpTransport::starttls_relay(host)
    }
    .map_err(err("Could not reach the mail server"))?;
    let mailer = relay
        .port(port)
        .credentials(Credentials::new(s.username.trim().to_string(), s.password.clone()))
        .timeout(Some(std::time::Duration::from_secs(30)))
        .build();
    mailer.send(&email).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("535") || msg.to_lowercase().contains("auth") {
            "The mail server refused the username or password. For Gmail, use an app password, not your normal password.".to_string()
        } else {
            format!("Sending failed: {msg}")
        }
    })?;
    Ok(())
}

// ----------------------------------------------------------------- updates

/// An update found by `check_update`, waiting for the writer to accept it.
struct PendingUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    current: String,
    notes: String,
}

#[tauri::command]
async fn check_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Res<Option<UpdateInfo>> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(err("Updates aren't set up"))?
        .check()
        .await
        .map_err(err("Could not check for updates"))?;
    Ok(update.map(|u| {
        let info = UpdateInfo {
            version: u.version.clone(),
            current: u.current_version.clone(),
            notes: u.body.clone().unwrap_or_default(),
        };
        *pending.0.lock().unwrap() = Some(u);
        info
    }))
}

/// Download, install and restart. The page saves the book before calling this.
#[tauri::command]
async fn install_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Res<()> {
    let update = pending.0.lock().unwrap().take().ok_or("No update is waiting.")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(err("The update didn't install"))?;
    app.restart();
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// --------------------------------------------------------------------- run

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_config,
            set_config,
            library_folder,
            list_books,
            create_book,
            load_book,
            save_book,
            reveal_folder,
            take_snapshot,
            list_snapshots,
            read_snapshot,
            send_email,
            check_update,
            install_update,
            app_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running Galley Proof");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_words_and_skips_scene_breaks() {
        assert_eq!(word_count("# The Barometer\n\nShe tapped the glass.\n\n* * *\n\nNo."), 7);
    }

    #[test]
    fn atomic_write_and_snapshot_round_trip() {
        let dir = std::env::temp_dir().join(format!("gp-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.to_string_lossy().into_owned();
        save_book(p.clone(), "# One\n\nHello there.".into(), "{}".into()).unwrap();
        let b = load_book(p.clone()).unwrap();
        assert_eq!(b.manuscript, "# One\n\nHello there.");
        assert!(take_snapshot(p.clone(), b.manuscript.clone()).unwrap());
        assert!(!take_snapshot(p.clone(), b.manuscript.clone()).unwrap()); // unchanged, skipped
        let snaps = list_snapshots(p.clone()).unwrap();
        assert_eq!(snaps.len(), 1);
        assert_eq!(read_snapshot(p.clone(), snaps[0].file.clone()).unwrap(), b.manuscript);
        assert!(read_snapshot(p, "../book.json".into()).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn folder_names_are_safe_and_unique() {
        let root = std::env::temp_dir().join(format!("gp-root-{}", std::process::id()));
        fs::create_dir_all(root.join("My Book")).unwrap();
        let p = safe_folder(&root, "My: Book?");
        assert_eq!(p.file_name().unwrap(), "My Book 2");
        let _ = fs::remove_dir_all(&root);
    }
}
