//! The native menu bar (the one at the top of the screen on a Mac, and under
//! the title bar on Windows).
//!
//! Most items just tell the page which action was chosen ("menu" event with
//! the item's id); the page does the work, the same as for its toolbar
//! buttons and keyboard shortcuts. Editing items (Undo, Cut, Paste, …) are the
//! operating system's own, so they behave exactly like every other app.

use serde::Deserialize;
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

pub const HELP_URL: &str = "https://github.com/johniadarola/galley-proof#readme";
pub const ISSUES_URL: &str = "https://github.com/johniadarola/galley-proof/issues";

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
pub struct RecentBook {
    pub title: String,
    pub path: String,
}

/// The parts of the menu that change while the app runs.
#[derive(Deserialize, Default, Clone)]
#[serde(default)]
pub struct MenuState {
    pub recent: Vec<RecentBook>,
    pub toolbar_hidden: bool,
}

pub fn build<R: Runtime>(app: &AppHandle<R>, st: &MenuState) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, keys: Option<&str>| {
        let mut b = MenuItemBuilder::with_id(id, text);
        if let Some(k) = keys {
            b = b.accelerator(k);
        }
        b.build(app)
    };

    // ---- Open Recent
    let mut recent = SubmenuBuilder::new(app, "Open Recent");
    if st.recent.is_empty() {
        recent = recent.item(&MenuItemBuilder::with_id("recent:none", "No Recent Books").enabled(false).build(app)?);
    }
    for (i, r) in st.recent.iter().enumerate().take(10) {
        let title = if r.title.trim().is_empty() { "Untitled" } else { r.title.as_str() };
        recent = recent.item(&item(&format!("recent:{i}"), title, None)?);
    }
    let recent = recent.build()?;

    let export = SubmenuBuilder::new(app, "Export")
        .item(&item("export_docx", "Word Document (manuscript format)…", None)?)
        .item(&item("export_txt", "Plain Text…", None)?)
        .build()?;

    let reveal = if cfg!(target_os = "macos") {
        "Show in Finder"
    } else if cfg!(windows) {
        "Show in File Explorer"
    } else {
        "Show Book Folder"
    };

    // ---- File
    let mut file = SubmenuBuilder::new(app, "File")
        .item(&item("new_book", "New Book", Some("CmdOrCtrl+N"))?)
        .item(&item("open_book", "Open Book…", Some("CmdOrCtrl+O"))?)
        .item(&item("open_folder", "Open Book Folder…", Some("CmdOrCtrl+Shift+O"))?)
        .item(&recent)
        .separator()
        .item(&item("save", "Save", Some("CmdOrCtrl+S"))?)
        .item(&item("duplicate", "Duplicate Book", None)?)
        .item(&item("history", "Browse History…", Some("CmdOrCtrl+Shift+H"))?)
        .separator()
        .item(&item("import", "Import Text…", Some("CmdOrCtrl+Shift+I"))?)
        .item(&export)
        .item(&item("email", "Email to Myself", Some("CmdOrCtrl+Shift+E"))?)
        .item(&item("reveal", reveal, None)?)
        .separator()
        .item(&item("book_setup", "Book Setup…", Some("CmdOrCtrl+Shift+P"))?)
        .separator()
        .close_window();
    if !cfg!(target_os = "macos") {
        file = file.separator().quit();
    }
    let file = file.build()?;

    // ---- Edit
    let find = SubmenuBuilder::new(app, "Find")
        .item(&item("find", "Find…", Some("CmdOrCtrl+F"))?)
        .item(&item("replace", "Find and Replace…", Some("Alt+CmdOrCtrl+F"))?)
        .item(&item("find_next", "Find Next", Some("CmdOrCtrl+G"))?)
        .item(&item("find_prev", "Find Previous", Some("CmdOrCtrl+Shift+G"))?)
        .item(&item("find_selection", "Use Selection for Find", Some("CmdOrCtrl+E"))?)
        .build()?;

    // Undo and Redo use Galley Proof's own history (see app.js), which can
    // follow chapters being split and joined; the rest are the system's own.
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&item("undo", "Undo", Some("CmdOrCtrl+Z"))?)
        .item(&item("redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?)
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .build()?;

    // ---- Format: the only formatting a novel needs
    let format = SubmenuBuilder::new(app, "Format")
        .item(&item("italic", "Italic", Some("CmdOrCtrl+I"))?)
        .separator()
        .item(&item("chapter", "New Chapter", Some("CmdOrCtrl+Shift+N"))?)
        .item(&item("scene", "Scene Break", Some("CmdOrCtrl+Shift+8"))?)
        .separator()
        .item(&item("smarten_book", "Convert Quotes and Dashes in This Book", None)?)
        .separator()
        .item(&item("page_style", "Page Style…", None)?)
        .item(&item("match", "Match a Book on My Shelf…", None)?)
        .build()?;

    // ---- View
    let toolbar = if st.toolbar_hidden { "Show Toolbar" } else { "Hide Toolbar" };
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("books", "Books…", Some("CmdOrCtrl+Shift+L"))?)
        .item(&item("chapters", "Chapters…", Some("CmdOrCtrl+Shift+C"))?)
        .separator()
        .item(&item("prev", "Previous Pages", Some("Alt+CmdOrCtrl+Left"))?)
        .item(&item("next", "Next Pages", Some("Alt+CmdOrCtrl+Right"))?)
        .separator()
        .item(&item("toolbar", toolbar, Some("Alt+CmdOrCtrl+T"))?)
        .item(&item("focus", "Focus Mode", Some("CmdOrCtrl+Shift+F"))?)
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;

    let mut help = SubmenuBuilder::new(app, "Help")
        .item(&item("help", "Galley Proof Help", None)?)
        .item(&item("report", "Report a Problem…", None)?);
    if !cfg!(target_os = "macos") {
        help = help.separator().item(&item("check_updates", "Check for Updates…", None)?);
    }
    let help = help.build()?;

    #[allow(unused_mut)]
    let mut menu = Menu::new(app)?;
    if cfg!(target_os = "macos") {
        let about = AboutMetadataBuilder::new()
            .name(Some("Galley Proof"))
            .version(Some(app.package_info().version.to_string()))
            .comments(Some("Write on finished book pages."))
            .credits(Some("Typefaces: EB Garamond, Libre Caslon Text, Crimson Pro, Spectral, Literata and IBM Plex Sans, all under the SIL Open Font License."))
            .build();
        let app_menu = SubmenuBuilder::new(app, "Galley Proof")
            .about(Some(about))
            .item(&item("check_updates", "Check for Updates…", None)?)
            .separator()
            .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu.append(&app_menu)?;
    }
    for m in [&file, &edit, &format, &view, &window, &help] {
        menu.append(m)?;
    }
    Ok(menu)
}

/// What happens when a menu item is chosen.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    use tauri_plugin_opener::OpenerExt;
    match id {
        "help" => {
            let _ = app.opener().open_url(HELP_URL, None::<&str>);
        }
        "report" => {
            let _ = app.opener().open_url(ISSUES_URL, None::<&str>);
        }
        _ => {
            let _ = app.emit("menu", id.to_string());
        }
    }
}
