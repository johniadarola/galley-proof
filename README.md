# Galley Proof

A writing app that shows your draft as the finished pages of a printed book while you type: real trim sizes, justified and hyphenated text, a fixed number of lines per page, running heads, page numbers and chapter openers.

## Install

Open the [latest release](../../releases/latest) and download the installer for your computer:

- **Windows:** the file ending in `-setup.exe`. Windows may say the app is unrecognized, because it isn't signed with a paid certificate. Click **More info**, then **Run anyway**.
- **Mac:** the `.dmg` file. Drag Galley Proof to Applications. The first time, right-click it and choose **Open**.

## Where your writing lives

Each book is a folder in **Documents/Galley Proof**:

| File | What it is |
| --- | --- |
| `manuscript.md` | The text. Plain text you can open in any editor: `# ` starts a chapter, `*word*` is italic, `* * *` is a scene break. |
| `book.json` | Title, author, trim size, typeface and other page settings. |
| `Snapshots/` | Timed copies of the manuscript (see below). |

Installing, updating or removing the app never touches these folders. Keeping the Galley Proof folder inside Dropbox, OneDrive, Google Drive or iCloud gives you an off-computer copy automatically.

## Keeping your work safe

- **Autosave:** about a second after you stop typing, and at least every 8 seconds while you type. Files are written to a temporary copy first and then swapped in, so a crash mid-save can't damage the last good version.
- **History:** a copy every 10 minutes while you write, whenever you open or close a book, and when you press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>S</kbd>. All copies from the last day are kept, then one per hour for a week, then one per day. Restore any of them from **History**; the text you replace is saved first.
- **Big-deletion guard:** if one action removes 300 or more words, a bar offers to put them back.
- **Email to yourself:** <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>Shift</kbd> <kbd>E</kbd> sends the whole manuscript as an attachment. Set it up in **Book setup → Email backup**. For Gmail, use an [app password](https://myaccount.google.com/apppasswords) (two-step verification must be on). The password is stored only on your computer, in the app's settings file.

## Keyboard

| Keys | Action |
| --- | --- |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>I</kbd> | Italic |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>S</kbd> | Save a copy to History now |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>Shift</kbd> <kbd>E</kbd> | Email the manuscript to yourself |
| <kbd>Page Up</kbd> / <kbd>Page Down</kbd> | Turn pages |
| <kbd>Esc</kbd> | Close a panel or leave Focus |

## For development

The interface is plain HTML, CSS and JavaScript in `src/`; the desktop side (files, snapshots, email) is Rust in `src-tauri/src/lib.rs`, built with [Tauri 2](https://tauri.app).

```bash
npm install
npm run dev      # run the app
npm run build    # build an installer for this computer
cargo test --lib --manifest-path src-tauri/Cargo.toml
```

Opening `src/index.html` in a browser also works for layout testing; books are then kept in that browser's local storage.

Pushing to `main` builds Windows and Mac installers with GitHub Actions and attaches them to the release for the version in `src-tauri/tauri.conf.json`.
