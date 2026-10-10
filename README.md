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

## Writing aids

- **Smart punctuation** (on by default, Book setup → Manuscript): straight quotes become curly as you type, `--` becomes an em dash and `...` an ellipsis. Pasted and imported text is converted too; **Format → Convert Quotes and Dashes in This Book** fixes an existing manuscript in one go.
- **Find and Replace** treats straight and curly quotes as the same, so searching for *don't* finds *don’t*. Replace All is a single undo step.
- **Chapters** (⇧⌘C) lists every chapter with its page number and word count; click one to jump there, or use the arrows to move a whole chapter.
- **Undo** remembers every change to the manuscript, including new chapters, moved chapters, Replace All, imports and restores from History, and groups typing into sensible steps.

## Page templates

**Book setup → Page style** offers typical shapes (mass-market paperback, trade paperback, hardcover) and any books you've matched.

**Match a book on my shelf** turns a real novel into a template:

1. Measure the page width and height with a ruler.
2. Count the lines on a full page (one with no chapter heading or break).
3. Type two or three full lines exactly as printed, from the middle of paragraphs, or count the words on five lines.
4. Pick the closest typeface. Books often name theirs on the copyright page ("Set in Sabon").
5. Optionally measure the text block's width and height for exact margins.

Galley Proof works out the type size, leading and margins that reproduce that page and its words per page. Templates are kept in the app's settings and can be used for any book.

## Updates

Galley Proof checks for a new version a few seconds after it opens. When one is ready, a bar offers **Update and restart**; your book is saved and a copy put in History first. You can also check from **Book setup → About**. Versions before 0.2.0 can't update themselves, so install 0.2.0 by hand once.

## Menus and keyboard

Everything is in the menu bar; the toolbar can be hidden with **View → Hide Toolbar**. On a Mac, ⌘ is the command key; on Windows use Ctrl.

| Menu | Item | Keys |
| --- | --- | --- |
| File | New Book | ⌘N |
| File | Open Book… (your books) | ⌘O |
| File | Open Book Folder… (a book anywhere, e.g. Dropbox) | ⇧⌘O |
| File | Open Recent | |
| File | Save (also puts a copy in History) | ⌘S |
| File | Duplicate Book | |
| File | Browse History… | ⇧⌘H |
| File | Import Text… | ⇧⌘I |
| File | Export → Word Document (manuscript format) / Plain Text | |
| File | Email to Myself | ⇧⌘E |
| File | Show in Finder | |
| File | Book Setup… | ⇧⌘P |
| Edit | Undo / Redo (Galley Proof's own history; see below) | ⌘Z / ⇧⌘Z |
| Edit | Cut, Copy, Paste, Select All | the usual |
| Edit → Find | Find…, Find and Replace…, Find Next / Previous, Use Selection for Find | ⌘F, ⌥⌘F, ⌘G / ⇧⌘G, ⌘E |
| Format | Italic | ⌘I |
| Format | New Chapter | ⇧⌘N |
| Format | Scene Break | ⇧⌘8 (⇧8 is the asterisk) |
| Format | Convert Quotes and Dashes in This Book | |
| Format | Page Style…, Match a Book on My Shelf… | |
| View | Books… | ⇧⌘L |
| View | Chapters… (jump to a chapter, move chapters) | ⇧⌘C |
| View | Previous / Next Pages | ⌥⌘← / ⌥⌘→ (also Page Up / Page Down) |
| View | Hide Toolbar | ⌥⌘T |
| View | Focus Mode | ⇧⌘F |
| Galley Proof | Settings… / Check for Updates… | ⌘, |

The Word export uses standard manuscript format (12 pt Times New Roman, double-spaced, chapters on new pages), the layout agents and editors expect.

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
