# Galley Proof: notes for Claude

The owner is a writer and hobbyist developer, not a professional programmer. Explain changes in plain words.

- Product goal: the draft must look like a finished, published novel page while typing. Reliability of the writer's text comes before every other feature.
- Editor structure (for speed with 150k-word books): `#editor > section > (h2.chapter | p)`, one section per chapter, each its own CSS column box placed with translateX at its first page; sections use `content-visibility:auto` except the one(s) holding the selection (`.live`) — typing into a skipped section misplaces text. `normalizeStructure()` keeps the shape (one h2, first in its section). Word counts, cleanup and layout are incremental via a MutationObserver; never scan the whole book per keystroke (test with a generated 150k-word book: typing must stay under ~16 ms of script per key).
- Undo: the `Undo` module records DOM mutations (childList + characterData) and reverts them; the browser's own undo is never used for the manuscript (it breaks when nodes move between sections). Wrap programmatic edits in `Undo.command(fn)`. Avoid no-op DOM writes (use `setClass`). Derived attributes (classes, data-label, section styles) are not recorded.
- Interface: `src/` (no build step, no framework). `app.js` = typesetting + editor + UI, `store.js` = storage calls (Tauri commands, or localStorage fallback in a plain browser).
- Desktop side: `src-tauri/src/lib.rs`. All disk and network access is here. Writes are atomic (temp file + rename). Keep it that way.
- On-disk format is plain text (`manuscript.md`) + `book.json`; never change it in a way that old files can't be read.
- App identifier `com.johniadarola.bookwriter` must never change (it locates settings and identifies the installed app). The display name can change freely.
- Release: bump `version` in both `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (and package.json), push to main; GitHub Actions builds installers into Releases.
- Updates: tauri-plugin-updater; builds are signed in CI with the `TAURI_SIGNING_PRIVATE_KEY` repo secret (key has no password). The public key is in tauri.conf.json. Losing the private key means installed copies can't verify new updates, so never replace the pubkey casually.
- Templates: built-in ones in `BUILTIN_TEMPLATES` (app.js); measured ones in app settings `templates`; a book using one stores `trim:'custom'` + `custom:{w,h,side,top,bottom}` (inches) in book.json.
- Menus: native menu in `src-tauri/src/menu.rs`; items emit a `menu` event with their id, handled by `ACTIONS` in app.js. Keyboard shortcuts in `KEYS` (app.js) mirror the menu accelerators; `run()` drops the duplicate when menu and keydown both fire. Edit-menu items are the OS's own. Menu is rebuilt via `set_menu_state` when recent books or the toolbar setting change.
- Export: `src-tauri/src/export.rs` (plain text, Word in standard manuscript format).
- Fonts are bundled in `src/fonts` (all SIL Open Font License) so the app works offline.
- Before pushing: `cargo test --lib` in `src-tauri`, and `node --check` the JS files. The page can be tested in Chromium (open src/index.html via a local server; browser fallback storage) and in the real app's WebKit via `tauri-driver` + `WebKitWebDriver` under xvfb.
- Design and roadmap: the "Galley Proof — Design Document" Claude Doc. Next phases: book templates matching real novels' density, then typesetting polish (own line breaking, right-hand chapter openers, smart punctuation).
