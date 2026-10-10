// Storage for Galley Proof.
//
// In the desktop app every call goes to the Rust side (src-tauri/src/lib.rs),
// which writes real files in Documents/Galley Proof. Opened in a plain browser
// (for quick layout testing) the same calls fall back to localStorage.

window.Store = (() => {
  const T = window.__TAURI__;
  if (T && T.core && T.core.invoke) {
    const inv = (cmd, args) => T.core.invoke(cmd, args);
    return {
      desktop: true,
      getConfig: () => inv('get_config'),
      setConfig: config => inv('set_config', { config }),
      libraryFolder: () => inv('library_folder'),
      listBooks: () => inv('list_books'),
      createBook: (title, manuscript, book) => inv('create_book', { title, manuscript, book }),
      loadBook: path => inv('load_book', { path }),
      saveBook: (path, manuscript, book) => inv('save_book', { path, manuscript, book }),
      reveal: path => inv('reveal_folder', { path }),
      snapshot: (path, manuscript) => inv('take_snapshot', { path, manuscript }),
      listSnapshots: path => inv('list_snapshots', { path }),
      readSnapshot: (path, file) => inv('read_snapshot', { path, file }),
      sendEmail: (settings, subject, body, attachmentName, attachment) =>
        inv('send_email', { settings, subject, body, attachmentName, attachment }),
      onClose: fn => T.window.getCurrentWindow().onCloseRequested(fn),
      checkUpdate: () => inv('check_update'),
      installUpdate: () => inv('install_update'),
      appVersion: () => inv('app_version'),
      setMenuState: state => inv('set_menu_state', { state }),
      pickBookFolder: () => inv('pick_book_folder'),
      exportBook: (kind, fileName, manuscript, title, author) =>
        inv('export_book', { kind, fileName, manuscript, title, author }),
      onMenu: fn => T.event.listen('menu', e => fn(e.payload)),
    };
  }

  // ---- browser fallback ----
  const KEY = 'galleyproof.books.v1';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const write = all => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { throw 'This browser refused to save (storage is full or blocked).'; } };
  const words = t => (t.match(/[\p{L}\p{N}’'\-]+/gu) || []).length;
  const stamp = () => new Date().toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 19) + '.md';
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(KEY + '.config')) || {}; } catch (e) {}

  return {
    desktop: false,
    getConfig: async () => cfg,
    setConfig: async c => { cfg = c; try { localStorage.setItem(KEY + '.config', JSON.stringify(c)); } catch (e) {} },
    libraryFolder: async () => 'this browser',
    listBooks: async () => Object.entries(read())
      .map(([path, b]) => ({ path, folder: path, title: (()=>{ try { return JSON.parse(b.book).title || path; } catch (e) { return path; } })(), words: words(b.manuscript), modified: b.modified || '' }))
      .sort((a, b) => b.modified.localeCompare(a.modified)),
    createBook: async (title, manuscript, book) => {
      const all = read(); let path = title || 'Untitled', n = 2;
      while (all[path]) path = `${title} ${n++}`;
      all[path] = { manuscript, book, modified: new Date().toISOString(), snaps: [] };
      write(all); return path;
    },
    loadBook: async path => {
      const b = read()[path]; if (!b) throw 'That book is missing.';
      return { path, manuscript: b.manuscript, book: b.book };
    },
    saveBook: async (path, manuscript, book) => {
      const all = read(); const b = all[path] || { snaps: [] };
      Object.assign(b, { manuscript, book, modified: new Date().toISOString() });
      all[path] = b; write(all);
    },
    reveal: async () => {},
    snapshot: async (path, manuscript) => {
      const all = read(); const b = all[path]; if (!b) return false;
      b.snaps = b.snaps || [];
      if (b.snaps.length && b.snaps[0].text === manuscript) return false;
      b.snaps.unshift({ file: stamp(), when: new Date().toLocaleString(), text: manuscript });
      b.snaps = b.snaps.slice(0, 30); write(all); return true;
    },
    listSnapshots: async path => ((read()[path] || {}).snaps || []).map(s => ({ file: s.file, when: s.when, words: words(s.text) })),
    readSnapshot: async (path, file) => ((read()[path] || {}).snaps || []).find(s => s.file === file)?.text ?? '',
    sendEmail: async () => { throw 'Email works in the desktop app.'; },
    onClose: () => {},
    checkUpdate: async () => null,
    installUpdate: async () => {},
    appVersion: async () => 'browser preview',
    setMenuState: async () => {},
    pickBookFolder: async () => { throw 'Opening folders works in the desktop app.'; },
    exportBook: async () => { throw 'Exporting works in the desktop app.'; },
    onMenu: () => {},
  };
})();
