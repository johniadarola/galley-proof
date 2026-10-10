# Galley Proof: notes for Claude

The owner is a writer and hobbyist developer, not a professional programmer. Explain changes in plain words.

- Product goal: the draft must look like a finished, published novel page while typing. Reliability of the writer's text comes before every other feature.
- Interface: `src/` (no build step, no framework). `app.js` = typesetting + editor + UI, `store.js` = storage calls (Tauri commands, or localStorage fallback in a plain browser).
- Desktop side: `src-tauri/src/lib.rs`. All disk and network access is here. Writes are atomic (temp file + rename). Keep it that way.
- On-disk format is plain text (`manuscript.md`) + `book.json`; never change it in a way that old files can't be read.
- App identifier `com.johniadarola.bookwriter` must never change (it locates settings and identifies the installed app). The display name can change freely.
- Release: bump `version` in both `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (and package.json), push to main; GitHub Actions builds installers into Releases.
- Fonts are bundled in `src/fonts` (all SIL Open Font License) so the app works offline.
- Before pushing: `cargo test --lib` in `src-tauri`, and `node --check` the JS files.
- Design and roadmap: the "Galley Proof — Design Document" Claude Doc. Next phases: book templates matching real novels' density, then typesetting polish (own line breaking, right-hand chapter openers, smart punctuation).
