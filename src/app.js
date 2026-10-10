// Galley Proof: the page.
//
// The manuscript is one contenteditable block laid out in CSS columns, one
// column per book page. Page furniture (running heads, folios, title and
// copyright pages) is drawn on a layer behind it by measuring where each
// chapter heading landed.
//
// On disk a book is plain text (manuscript.md): "# " starts a chapter,
// *word* is italic, "* * *" is a scene break, blank lines separate paragraphs.

(() => {
'use strict';

const FM = 3; // endpaper, title page, copyright page
const TRIMS = {
  mm:   {label:'Mass-market · 4.25 × 6.87 in', w:4.25, h:6.87, side:.55, top:.62, bottom:.72},
  '5x8':{label:'Digest · 5 × 8 in',           w:5,    h:8,    side:.7,  top:.72, bottom:.82},
  '55': {label:'Trade · 5.5 × 8.5 in',        w:5.5,  h:8.5,  side:.75, top:.78, bottom:.86},
  '6x9':{label:'Trade · 6 × 9 in',            w:6,    h:9,    side:.82, top:.82, bottom:.92}
};
const FACES = {
  garamond:{name:'EB Garamond',       stack:'"EB Garamond", Garamond, Georgia, serif'},
  caslon:  {name:'Libre Caslon Text', stack:'"Libre Caslon Text", "Big Caslon", Georgia, serif'},
  crimson: {name:'Crimson Pro',       stack:'"Crimson Pro", Georgia, serif'},
  spectral:{name:'Spectral',          stack:'Spectral, Georgia, serif'},
  literata:{name:'Literata',          stack:'Literata, Georgia, serif'}
};
const SIZES = [9.5,10,10.5,11,11.5,12,12.5,13];
const LEADS = [12,12.5,13,13.5,14,14.5,15,15.5,16,16.5,17];
const DEFAULTS = {title:'Untitled', author:'', trim:'55', custom:null, template:'', face:'garamond', size:11.5, leading:14.5, drop:true, verso:'title'};

// Built-in starting points: typical values for each kind of book, not
// measurements of any particular title. Templates the writer measures with
// "Match a book" are kept in the app settings (config.templates).
const BUILTIN_TEMPLATES = [
  {id:'b-mm',     name:'Mass-market paperback', trim:{w:4.25, h:6.87, side:.5,  top:.55, bottom:.62}, face:'garamond', size:10,   leading:12},
  {id:'b-digest', name:'Digest paperback',      trim:{w:5,    h:8,    side:.7,  top:.72, bottom:.82}, face:'garamond', size:11,   leading:13.5},
  {id:'b-trade',  name:'Trade paperback',       trim:{w:5.5,  h:8.5,  side:.75, top:.78, bottom:.86}, face:'garamond', size:11.5, leading:14.5},
  {id:'b-hard',   name:'Hardcover novel',       trim:{w:6,    h:9,    side:.82, top:.82, bottom:.92}, face:'caslon',   size:11.5, leading:15}
];
function trimOf(){
  if(S.trim==='custom' && S.custom && S.custom.w) return {...S.custom, label:`${S.custom.w} × ${S.custom.h} in`};
  return TRIMS[S.trim] || TRIMS['55'];
}

const SNAPSHOT_EVERY = 10 * 60 * 1000;   // a timed copy every 10 minutes of writing
const SAVE_PAUSE = 1200;                 // save this long after typing stops
const SAVE_MAX_WAIT = 8000;              // ...or at least this often while typing
const BIG_DELETE = 300;                  // words removed at once that trigger the guard
const EMERGENCY_KEY = 'galleyproof.unsaved';

const SAMPLE = `# The Barometer Falls

The barometer in the hall had been falling since breakfast, and by the time Ada Marsh came down with her boots in one hand and her father’s letter in the other, the needle had slipped past *Change* and was nosing toward *Stormy* like a dog that smells something under the floor.

She tapped the glass. The needle did not move. It had never once, in all her years in the house, obeyed a tap, but her mother had tapped it every morning of her married life and Ada had inherited the gesture along with the house, the debts, and the view.

The view was the only thing worth keeping. From the hall window she could see the whole sweep of Carrick Bay, grey as pewter, and the long dark finger of the breakwater pointing out toward the lighthouse on Inish Rock. The light was not lit. It had not been lit for eleven years, not since the Board decided that a lamp nobody needed was a lamp nobody needed to pay for, and the keeper had been sent ashore with a pension and a carriage clock.

The keeper had been her father.

She unfolded the letter again, although she had read it four times upstairs and could have recited it. It was short, which was unlike him. He had always written the way he talked, in long looping sentences that doubled back to pick up things he had dropped along the way. This one had the look of something written standing up.

*Ada—the light is burning again. I did not light it. Come out to the Rock on the Thursday tide and bring the brass key from the bureau. Tell no one, least of all Hollis. Your loving father.*

The trouble was that her father had been dead since March.

* * *

At a quarter past six, a light came on in the lamp room. It did not sweep, as the old light had swept. It simply burned, small and steady and yellow, like a candle someone had left in a window for a person who was late.

# The Causeway

Hollis was waiting at the head of the causeway, which she had known he would be.

“Miss Marsh,” he said. “Going walking?”
`;

const $ = id => document.getElementById(id);
const editor=$('editor'), stage=$('stage'), layer=$('layer'), book=$('book'), frame=$('frame'), viewport=$('viewport');

let S = {...DEFAULTS};
let G = {};
let scale=1, ppv=2, view=1, total=FM+1, plast=FM, chapters=[], sig='', freeView=false;
let config = {};
let bookPath = null;

// save state
let dirty=false, firstDirtyAt=0, saveTimer=null, saveChain=Promise.resolve(), saveError=null, lastSavedAt=null, retryTimer=null;
let lastSavedMd='', lastSavedWords=0, sessionStartWords=0;
let lastSnapAt=Date.now(), wroteSinceSnap=false, guardOpen=false;

document.body.classList.toggle('desktop', Store.desktop);

/* ================================================================ text format */

const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SCENE = /^\s*(?:(?:\*\s*){3}|⁂|~)\s*$/;

// Plain text to editor HTML. `lenient` is for pasted or imported text from
// elsewhere: it also accepts _underscored_ italics and strips "Chapter 3:" prefixes.
function textToHTML(text, lenient){
  text = String(text).replace(/\r\n?/g,'\n');
  const lines = text.split('\n');
  const blocks = [];
  if(/\n\s*\n/.test(text) || !lenient){
    let cur=[];
    const flush=()=>{ if(cur.length){ blocks.push(cur.join(' ')); cur=[]; } };
    for(const ln of lines){
      if(/^\s*#/.test(ln) || SCENE.test(ln)){ flush(); blocks.push(ln); }
      else if(!ln.trim()) flush();
      else cur.push(ln.trim());
    }
    flush();
  } else lines.forEach(l=>{ if(l.trim()) blocks.push(l.trim()); });
  const inline = s => {
    let h = esc(s).replace(/\*([^*\n]+)\*/g,'<i>$1</i>');
    if(lenient) h = h.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g,'$1<i>$2</i>');
    return h;
  };
  return blocks.map(b=>{
    if(SCENE.test(b)) return '<p class="scene">* * *</p>';
    const h = b.match(/^\s*#+\s?(.*)$/);
    if(h){
      let t = h[1].trim();
      if(lenient) t = t.replace(/^chapter\s+[\w-]+[:.\s]*/i,'');
      return `<h2 class="chapter">${inline(t) || '<br>'}</h2>`;
    }
    return `<p>${inline(b)}</p>`;
  }).join('');
}

// Typographer's punctuation: curly quotes and apostrophes, em dashes and
// ellipses. Used on pasted and imported text and by Format → Convert.
function smarten(t){
  return t
    .replace(/\.\.\./g, '…')
    .replace(/(^|[^-])---?(?!-)/gm, '$1—')
    .replace(/(^|[\s“‘(\[—])'(\d\d(?:s|’s)?\b)/gm, '$1’$2')                     // ’90s
    .replace(/(^|[\s“(\[—])'(tis|twas|em|cause|til|round|bout|n)\b/gim, '$1’$2') // ’tis, rock ’n’ roll
    .replace(/(^|[\s(\[{—–*‘])"/gm, '$1“').replace(/"/g, '”')
    .replace(/(^|[\s(\[{—–*“])'/gm, '$1‘').replace(/'/g, '’');
}
const smartOn = () => config.smart_punct !== false;

function inlineToText(el){
  return inlineRaw(el, false).replace(/\s+/g,' ').trim();
}
// Italic runs become *word*. Spaces at the edge of an italic run are moved
// outside the asterisks so "*word* next" never turns into "*word*next".
function inlineRaw(el, inItalic){
  let out='';
  el.childNodes.forEach(n=>{
    if(n.nodeType===3) out += n.textContent;
    else if(n.nodeType===1){
      if(n.tagName==='BR') return;
      const ital = /^(I|EM)$/.test(n.tagName) && !inItalic;
      const inner = inlineRaw(n, inItalic || ital);
      if(!ital){ out += inner; return; }
      const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
      out += m[2] ? `${m[1]}*${m[2]}*${m[3]}` : inner;
    }
  });
  return out;
}

function toMarkdown(){
  const parts = [];
  for(const el of allBlocks()){
    if(el.tagName==='H2') parts.push(('# ' + inlineToText(el)).trimEnd() || '#');
    else if(el.classList.contains('scene')) parts.push('* * *');
    else { const t = inlineToText(el); if(t) parts.push(t); }
  }
  return parts.join('\n\n') + '\n';
}

const WORD_RE = /[\p{L}\p{N}’'\-]+/gu;
const countWords = md => (md.replace(/^\s*\* \* \*\s*$/gm,'').match(WORD_RE)||[]).length;

/* ================================================================ structure */

// The manuscript is laid out one chapter at a time:
//   #editor > section > h2.chapter, p, p, …
// Every chapter starts on a fresh page anyway, so each section is its own
// column box placed at its first page, and the browser skips drawing the
// ones that are off screen. Typing in a 150,000-word book then only re-lays
// out the chapter being edited. On disk it's still one plain text file.

// Change a class only if it actually changes: no-op edits to the page still
// count as changes to the browser and would break up undo steps.
const setClass = (el, cls, on) => { if(el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on); };

const isSection = n => !!n && n.nodeType === 1 && n.tagName === 'SECTION' && n.parentNode === editor;
const sections = () => [...editor.children].filter(isSection);
const allBlocks = () => editor.querySelectorAll(':scope > section > *');
function topBlock(n){
  while(n && n !== editor){
    if(n.parentNode && isSection(n.parentNode)) return n;
    n = n.parentNode;
  }
  return null;
}

// A MutationObserver reports what changed, so word counts, cleanup and
// layout only revisit the paragraphs and chapters that were touched.
const blockCounts = new WeakMap();
const dirtyBlocks = new Set();      // paragraphs whose word count may have changed
const dirtySections = new Set();    // chapters to clean up and re-measure
let liveWords = 0, recountAll = true, structureDirty = true, layoutAll = true;
const wordWatcher = new MutationObserver(noteMutations);
wordWatcher.observe(editor, {childList:true, subtree:true, characterData:true});
function forgetCounts(n){
  if(n.nodeType !== 1) return;
  if(blockCounts.has(n)){ liveWords -= blockCounts.get(n); blockCounts.delete(n); }
  if(n.tagName === 'SECTION') [...n.children].forEach(forgetCounts);
}
function noteMutations(records){
  for(const m of records){
    const t = m.target;
    if(m.type === 'childList' && (t === editor || isSection(t))){
      structureDirty = true;
      if(isSection(t)) dirtySections.add(t);
      m.removedNodes.forEach(forgetCounts);
      m.addedNodes.forEach(n=>{
        if(n.nodeType !== 1) return;
        if(n.tagName === 'SECTION'){ dirtySections.add(n); [...n.children].forEach(b=>dirtyBlocks.add(b)); }
        else dirtyBlocks.add(n);
      });
      continue;
    }
    const b = topBlock(t);
    if(b){ dirtyBlocks.add(b); dirtySections.add(b.parentNode); }
  }
}
function blockWords(el){ return el.classList.contains('scene') ? 0 : (el.textContent.match(WORD_RE)||[]).length; }
function editorWords(){
  noteMutations(wordWatcher.takeRecords());
  if(recountAll){
    liveWords = 0;
    for(const el of allBlocks()){ const c = blockWords(el); blockCounts.set(el, c); liveWords += c; }
    recountAll = false; dirtyBlocks.clear();
    return liveWords;
  }
  for(const el of dirtyBlocks){
    const old = blockCounts.get(el) || 0;
    if(el.isConnected && isSection(el.parentNode)){ const c = blockWords(el); blockCounts.set(el, c); liveWords += c - old; }
    else if(blockCounts.has(el)){ liveWords -= old; blockCounts.delete(el); }
  }
  dirtyBlocks.clear();
  return liveWords;
}

function saveSelection(){
  const s = getSelection(); if(!s.rangeCount) return null;
  const r = s.getRangeAt(0); return [r.startContainer, r.startOffset, r.endContainer, r.endOffset];
}
function restoreSelection(v){
  if(!v || !editor.contains(v[0]) || !editor.contains(v[2])) return;
  try{
    const s = getSelection();
    if(s.rangeCount){ const r = s.getRangeAt(0); if(r.startContainer===v[0] && r.startOffset===v[1] && r.endContainer===v[2] && r.endOffset===v[3]) return; }
    s.setBaseAndExtent(v[0], Math.min(v[1], nodeLen(v[0])), v[2], Math.min(v[3], nodeLen(v[2])));
  }catch(e){}
}
const nodeLen = n => n.nodeType === 3 ? n.data.length : n.childNodes.length;
const newSection = () => { const s = document.createElement('section'); return s; };

// Keep the shape the layout depends on: only sections at the top level, only
// paragraphs and chapter headings inside them, each chapter heading first in
// its own section. Editing (pasting, deleting a heading, the browser's own
// Enter) can break those rules; this puts them back without losing the caret.
function normalizeStructure(){
  noteMutations(wordWatcher.takeRecords());
  const sel = saveSelection();
  let moved = false;
  if(structureDirty){
    let cur = null;
    for(const n of [...editor.childNodes]){
      if(isSection(n)){ cur = n; continue; }
      if((n.nodeType === 3 && !n.textContent.trim()) || (n.nodeType === 1 && n.tagName === 'BR')){ n.remove(); continue; }
      if(!cur){ cur = newSection(); editor.insertBefore(cur, n); }
      cur.appendChild(n); moved = true;
    }
  }
  const touched = structureDirty ? sections() : [...dirtySections].filter(isSection);
  for(const sec of touched) moved = fixBlocks(sec) || moved;
  if(structureDirty){
    // a heading that isn't first starts a new section
    for(const sec of sections()){
      let cur = sec;
      for(const n of [...sec.children]){
        if(n.tagName === 'H2' && n !== sec.firstElementChild){ const ns = newSection(); cur.after(ns); cur = ns; moved = true; }
        if(cur !== sec) cur.appendChild(n);
      }
    }
    // a section without a heading joins the one before it (the first may be a prologue)
    const secs = sections();
    for(let i = secs.length - 1; i >= 1; i--){
      const sec = secs[i];
      if(sec.firstElementChild && sec.firstElementChild.tagName === 'H2') continue;
      const prev = secs[i-1];
      while(sec.firstChild) prev.appendChild(sec.firstChild);
      sec.remove(); moved = true;
    }
    for(const sec of sections()) if(!sec.firstElementChild){ sec.remove(); moved = true; }
    if(!sections().length){ const sec = newSection(); sec.innerHTML = '<p><br></p>'; editor.appendChild(sec); moved = true; }
    structureDirty = false;
  }
  if(moved){ restoreSelection(sel); noteMutations(wordWatcher.takeRecords()); structureDirty = false; }
}
function fixBlocks(sec){
  let moved = false;
  for(const n of [...sec.childNodes]){
    if(n.nodeType === 3){ if(n.textContent.trim()){ const p = document.createElement('p'); sec.insertBefore(p, n); p.appendChild(n); moved = true; } else n.remove(); }
    else if(n.nodeType === 1 && !/^(P|H2)$/.test(n.tagName)){
      if(n.tagName === 'BR'){ n.remove(); continue; }
      const p = document.createElement(/^H[1-6]$/.test(n.tagName) ? 'h2' : 'p'); sec.insertBefore(p, n);
      while(n.firstChild) p.appendChild(n.firstChild); n.remove(); moved = true;
    }
  }
  sec.querySelectorAll(':scope > * span, :scope > * font, :scope > * b, :scope > * strong, :scope > * u').forEach(sp=>{ while(sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp); sp.remove(); moved = true; });
  sec.querySelectorAll(':scope > [style], :scope > * [style]').forEach(el=>el.removeAttribute('style'));
  for(const b of sec.children){
    if(b.tagName === 'H2'){ setClass(b, 'chapter', true); setClass(b, 'scene', false); }
    else setClass(b, 'scene', SCENE.test(b.textContent));
  }
  return moved;
}

/* ================================================================ undo */

// Galley Proof keeps its own undo history instead of the browser's. The
// browser's history can't follow paragraphs being moved between chapter
// sections and gives jumbled results; this one records every change to the
// manuscript (text and structure) and reverses them exactly, newest first.
// Typing and deleting are grouped into bursts, like other writing apps.
const Undo = (() => {
  const LIMIT = 400;
  const watch = new MutationObserver(()=>{});   // read on demand with takeRecords()
  watch.observe(editor, {childList:true, subtree:true, characterData:true, characterDataOldValue:true});
  let done = [], undone = [];
  let cur = null;               // the group being recorded
  let lastKind = '', lastAt = 0, lastSel = null, inCommand = 0, applying = false;

  const sameSel = (a, b) => a && b && a[0]===b[0] && a[1]===b[1] && a[2]===b[2] && a[3]===b[3];
  function flush(){
    const recs = watch.takeRecords();
    if(!recs.length || applying) return;
    if(!cur){ cur = {records:[], before:lastSel}; }
    cur.records.push(...recs);
  }
  function close(){
    flush();
    if(cur && cur.records.length){
      cur.after = saveSelection();
      done.push(cur); if(done.length > LIMIT) done.shift();
      undone = [];
    }
    cur = null; lastKind = '';
  }
  // Called before each edit the person makes. Same kind of edit, soon after
  // the last one, with the cursor where that one left it: keep the group.
  function beforeEdit(kind){
    flush();
    const now = Date.now(), sel = saveSelection();
    const cont = cur && kind === lastKind && (kind === 'type' || kind === 'delete') && now - lastAt < 1500 && sameSel(sel, lastSel);
    if(!cont){ close(); cur = {records:[], before:sel}; }
    lastKind = kind; lastAt = now;
  }
  function afterEdit(){ flush(); lastSel = saveSelection(); lastAt = Date.now(); }
  // A command (new chapter, replace all, restore…) is always one undo step.
  function command(fn){
    if(inCommand) return fn();
    close(); cur = {records:[], before:saveSelection()};
    inCommand++;
    try{ return fn(); }
    finally{ inCommand--; normalizeStructure(); close(); lastSel = saveSelection(); }
  }
  function revert(records){
    for(let i = records.length - 1; i >= 0; i--){
      const r = records[i];
      if(r.type === 'characterData'){ r.target.data = r.oldValue; continue; }
      for(const n of r.addedNodes) if(n.parentNode === r.target) r.target.removeChild(n);
      const ref = r.nextSibling && r.nextSibling.parentNode === r.target ? r.nextSibling : null;
      for(const n of r.removedNodes) r.target.insertBefore(n, ref);
    }
  }
  function step(from, to, selKey){
    close();
    const g = from.pop(); if(!g) return false;
    applying = true;
    try{
      watch.takeRecords();
      revert(g.records);
      const back = watch.takeRecords();
      structureDirty = true; normalizeStructure();
      back.push(...watch.takeRecords());
      to.push({records:back, before:g.after, after:g.before});
    } finally { applying = false; }
    const sel = g[selKey];
    if(sel && editor.contains(sel[0]) && editor.contains(sel[2])) restoreSelection(sel);
    else { const secs = sections(); const b = secs.length && secs[0].firstElementChild; if(b){ editor.focus(); caretTo(b, true); } }
    lastSel = saveSelection(); lastKind = '';
    afterChange(true);
    return true;
  }
  return {
    beforeEdit, afterEdit, command, close,
    undo: () => step(done, undone, 'before'),
    redo: () => step(undone, done, 'before'),
    reset(){ watch.takeRecords(); done = []; undone = []; cur = null; lastKind = ''; lastSel = null; },
    get canUndo(){ return done.length > 0 || !!(cur && cur.records.length); },
  };
})();
// What happens after any change to the manuscript (typing, undo, commands).
function afterChange(fromUndo){
  freeView = false; schedule(); markDirty(); if(typeof Find !== 'undefined') Find.refresh();
  if(fromUndo) lastSavedWords = editorWords();   // an undo is deliberate: don't offer to put text back
  else deletionGuard();
}

/* ================================================================ geometry */

function applyGeometry(){
  const t = trimOf();
  const W = t.w*96, H = t.h*96, m = t.side*96, top = t.top*96, botMin = t.bottom*96;
  const fs = S.size*4/3, L = S.leading*4/3;
  const lines = Math.floor((H - top - botMin)/L);
  const T = W - 2*m;
  G = {W,H,m,top,fs,L,lines,T, bottom: H - top - lines*L};
  book.style.setProperty('--face', (FACES[S.face]||FACES.garamond).stack);
  book.style.setProperty('--fs', fs+'px');
  book.style.setProperty('--L', L+'px');
  book.style.height = H+'px';
  book.classList.toggle('drops', !!S.drop);
  book.style.setProperty('--top', top+'px');
  book.style.setProperty('--T', T+'px');
  book.style.setProperty('--gap', (2*m)+'px');
  book.style.setProperty('--bh', (lines*L + .5)+'px');
  Object.assign(editor.style, { fontSize:fs+'px', lineHeight:L+'px' });
  layoutAll = true;
  stage.style.height = H+'px';
  fit();
  sig='';
}
function fit(){
  const aw = viewport.clientWidth - 32, ah = viewport.clientHeight - 32;
  ppv = aw < 700 ? 1 : 2;
  const w = ppv*G.W;
  scale = Math.max(.2, Math.min(aw/w, ah/G.H, 1.6));
  book.style.width = w+'px'; stage.style.width = w+'px';
  book.style.transform = `scale(${scale})`;
  frame.style.width = (w*scale)+'px'; frame.style.height = (G.H*scale)+'px';
}

/* ================================================================ pages */

function pageOfRect(r){
  const sr = stage.getBoundingClientRect();
  const x = (r.left - sr.left)/scale + stage.scrollLeft;
  return Math.floor((x + 2)/G.W);
}
const ONES=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
const numWord = n => n<20 ? ONES[n] : n<100 ? TENS[Math.floor(n/10)] + (n%10 ? '-'+ONES[n%10] : '') : String(n);

// Place each chapter at its first page and measure how many pages it fills.
// Only chapters that changed are measured again.
const secPages = new WeakMap();     // pages each chapter fills
const secPlaced = new WeakMap();    // where it was last put, to skip needless writes
function placeSection(sec, start, pages){
  const key = `${start}|${pages}|${G.W}|${G.m}|${G.lines}|${G.L}`;
  if(secPlaced.get(sec) === key) return;
  secPlaced.set(sec, key);
  const x = start*G.W + G.m, w = pages*G.W - 2*G.m + 1;
  sec.style.transform = `translateX(${x}px)`;
  sec.style.width = w+'px';
  sec.style.containIntrinsicSize = `${w}px ${G.lines*G.L}px`;
}
// How many pages a chapter fills, measured from its own left edge, so it
// doesn't matter where it currently sits.
function measureSection(sec){
  const last = sec.lastElementChild; if(!last) return 1;
  const rs = last.getClientRects(); if(!rs.length) return 1;
  const left = sec.getBoundingClientRect().left;
  return Math.max(1, Math.floor(((rs[rs.length-1].left - left)/scale + G.m + 2) / G.W) + 1);
}
function layoutSections(){
  noteMutations(wordWatcher.takeRecords());
  const secs = sections();
  // read every changed chapter first, then move them all: one layout pass
  for(const sec of secs){
    if(layoutAll || dirtySections.has(sec) || !secPages.has(sec)) secPages.set(sec, measureSection(sec));
  }
  let page = FM;
  const out = [];
  for(const sec of secs){
    const n = secPages.get(sec);
    placeSection(sec, page, n);
    out.push({sec, start:page, pages:n});
    page += n;
  }
  dirtySections.clear(); layoutAll = false;
  return out;
}

function relayout(){
  const hs = [...editor.querySelectorAll(':scope > section > h2.chapter')];
  hs.forEach((h,i)=>{ const lab='Chapter '+numWord(i+1); if(h.dataset.label!==lab) h.dataset.label=lab; setClass(h, 'empty', !h.textContent.trim()); });
  const laid = layoutSections();
  chapters = laid.filter(x=>x.sec.firstElementChild && x.sec.firstElementChild.tagName==='H2')
                 .map(x=>({page:x.start, title:x.sec.firstElementChild.textContent.trim()||'Untitled', sec:x.sec}));
  const end = laid.length ? laid[laid.length-1] : null;
  plast = end ? Math.max(FM, end.start + end.pages - 1) : FM;
  total = plast+1; if(total%2) total++;
  const s = [total, plast, S.title, S.author, S.verso, S.trim, JSON.stringify(S.custom), S.face, S.size, S.leading, chapters.map(c=>c.page+':'+c.title).join('|')].join('§');
  if(s !== sig){ sig = s; drawLayer(); }
  setView(view);
  status();
}

function chapterAt(p){ let c=null; for(const ch of chapters){ if(ch.page<=p) c=ch; else break; } return c; }

function drawLayer(){
  const {W,H,top,fs,L,bottom} = G;
  const face = FACES[S.face]||FACES.garamond, trim = trimOf();
  const openers = new Set(chapters.map(c=>c.page));
  const rhTop = top*0.42, rhSize = fs*0.9, foTop = H - bottom*0.62;
  const year = new Date().getFullYear();
  let out = '';
  for(let i=0;i<total;i++){
    const side = i%2 ? 'recto' : 'verso';
    let inner = '';
    if(i===0){ out += `<div class="pg endpaper" style="left:0;width:${W}px;height:${H}px"></div>`; continue; }
    if(i===1){
      inner = `<div class="tp" style="top:${H*.27}px">
        <div class="t" style="font-size:${fs*2.4}px">${esc(S.title||'Untitled')}</div>
        <div class="rule"></div>
        <div class="a" style="font-size:${fs*1.15}px">${esc(S.author||'')}</div></div>
        <div class="tp" style="top:${H*.86}px"><div class="a" style="font-size:${fs*.72}px;color:var(--ink-soft)">Uncorrected proof · not for sale</div></div>`;
    } else if(i===2){
      inner = `<div class="cp" style="left:${G.m}px;right:${G.m}px;bottom:${bottom+L}px;font-size:${fs*.72}px">
        <p>Copyright © ${year} by ${esc(S.author||'the author')}<br>All rights reserved.</p>
        <p>This is a work of fiction. Names, characters, places, and incidents are products of the author’s imagination.</p>
        <p>Set in ${esc(face.name)} ${S.size}/${S.leading} on a ${trim.w} × ${trim.h} inch page.</p>
        <p>First edition</p></div>`;
    } else if(i<=plast){
      if(!openers.has(i)){
        const ch = chapterAt(i);
        const rh = side==='verso' ? (S.verso==='author' ? S.author : S.title) : (ch ? ch.title : S.title);
        inner += `<div class="rh" style="top:${rhTop}px;font-size:${rhSize}px;line-height:${L}px">${esc(rh||'')}</div>`;
      }
      inner += `<div class="fo" style="top:${foTop}px;font-size:${fs*.88}px;line-height:${L}px">${i-2}</div>`;
    }
    out += `<div class="pg ${side}" style="left:${i*W}px;width:${W}px;height:${H}px">${inner}</div>`;
  }
  layer.style.width = (total*W)+'px'; layer.style.height = H+'px';
  layer.innerHTML = out;
}

/* ================================================================ page turning */

const maxView = () => Math.ceil(total/ppv) - 1;
function setView(v){
  view = Math.max(0, Math.min(v, maxView()));
  const target = view*ppv*G.W;
  if(Math.abs(stage.scrollLeft - target) > .5) stage.scrollLeft = target;
  $('prev').disabled = view<=0; $('next').disabled = view>=maxView();
  const names = ['Endpaper','Title page','Copyright'];
  const pages = []; for(let k=0;k<ppv;k++) pages.push(view*ppv+k);
  const folios = pages.filter(p=>p>=FM && p<=plast).map(p=>p-2);
  let label;
  if(folios.length===2) label = `pp. ${folios[0]}–${folios[1]}`;
  else if(folios.length===1) label = `p. ${folios[0]}`;
  else label = pages.filter(p=>p<FM).map(p=>names[p]).join(' · ') || 'End';
  $('where').textContent = `${label} of ${plast-2}`;
}
stage.addEventListener('scroll', ()=>{ const t=view*ppv*G.W; if(Math.abs(stage.scrollLeft-t)>.5) stage.scrollLeft=t; });

function caretPage(){
  const sel = getSelection(); if(!sel.rangeCount) return null;
  const r = sel.getRangeAt(0); if(!editor.contains(r.startContainer)) return null;
  let rect = r.getClientRects()[0];
  if(!rect){
    let n = r.startContainer; if(n.nodeType===3) n = n.parentNode;
    if(n===editor || isSection(n)) n = n.children[r.startOffset] || n.lastElementChild;
    if(isSection(n)) n = n.firstElementChild;
    rect = n && n.getClientRects()[0];
  }
  return rect ? pageOfRect(rect) : null;
}
function followCaret(){ if(freeView) return; const p = caretPage(); if(p!=null) setView(Math.floor(p/ppv)); }
function turn(d){ freeView = true; setView(view+d); }
$('prev').onclick = ()=>turn(-1); $('next').onclick = ()=>turn(1);

let wheelLock=0, wheelAcc=0;
viewport.addEventListener('wheel', e=>{
  if(e.target.closest('.panel')) return;
  e.preventDefault(); const now=Date.now(); if(now<wheelLock) return;
  wheelAcc += Math.abs(e.deltaX)>Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if(Math.abs(wheelAcc)>60){ turn(wheelAcc>0?1:-1); wheelAcc=0; wheelLock=now+380; }
},{passive:false});
let tx=null, ty=null;
viewport.addEventListener('touchstart', e=>{ tx=e.touches[0].clientX; ty=e.touches[0].clientY; },{passive:true});
viewport.addEventListener('touchend', e=>{ if(tx==null) return; const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty; if(Math.abs(dx)>70 && Math.abs(dy)<50) turn(dx<0?1:-1); tx=null; },{passive:true});

/* ================================================================ editing */

try{ document.execCommand('defaultParagraphSeparator', false, 'p'); }catch(e){}
function markScenes(scope){
  (scope ? [scope] : editor.querySelectorAll(':scope > section > p')).forEach(p=>{ if(p && p.tagName==='P') setClass(p, 'scene', SCENE.test(p.textContent)); });
}
let rafPending=false;
function schedule(){ if(rafPending) return; rafPending=true; requestAnimationFrame(()=>{ rafPending=false; relayout(); followCaret(); }); }

const editKind = t => /^insert(Text|ReplacementText|CompositionText)$/.test(t) ? 'type'
                     : /^delete(Content|Word|SoftLine|HardLine)(Backward|Forward)?$/.test(t) ? 'delete'
                     : t;
editor.addEventListener('beforeinput', e=>{
  if(e.inputType === 'historyUndo'){ e.preventDefault(); Undo.undo(); return; }
  if(e.inputType === 'historyRedo'){ e.preventDefault(); Undo.redo(); return; }
  Undo.beforeEdit(editKind(e.inputType));
  if(e.inputType === 'insertText' && smartOn() && e.data && e.data.length === 1 && smartType(e.data)) e.preventDefault();
});

// The two characters before the cursor, within the current paragraph.
function charsBefore(){
  const sel = getSelection(); if(!sel.rangeCount || !sel.isCollapsed) return null;
  const r = sel.getRangeAt(0), n = r.startContainer;
  if(n.nodeType === 3 && r.startOffset >= 2) return n.data.slice(r.startOffset - 2, r.startOffset);
  const b = topBlock(n); if(!b) return null;
  const rr = document.createRange(); rr.setStart(b, 0); rr.setEnd(n, r.startOffset);
  return rr.toString().slice(-2);
}
// Smart punctuation as you type. Returns true if it handled the key.
function smartType(ch){
  if(!`"'-.`.includes(ch)) return false;
  const before = charsBefore(); if(before === null) return false;
  const prev = before.slice(-1);
  const opens = !prev || /[\s(\[{—–‘“]/.test(prev);
  if(ch === '"'){ cmd('insertText', opens && prev !== '“' ? '“' : (prev === '“' ? '‘' : '”')); return true; }
  if(ch === "'"){ cmd('insertText', opens ? '‘' : '’'); return true; }
  if(ch === '-' && prev === '-'){ cmd('delete'); cmd('insertText', '—'); return true; }
  if(ch === '.' && before === '..'){ cmd('delete'); cmd('delete'); cmd('insertText', '…'); return true; }
  return false;
}
editor.addEventListener('input', ()=>{
  normalizeStructure();
  Undo.afterEdit();
  afterChange();
});
// Off-screen chapters aren't drawn, which keeps typing fast in long books.
// The chapter holding the cursor (both ends of a selection) is always fully
// drawn: typing into a chapter the browser has skipped puts the text in the
// wrong place.
let liveSecs = [];
function keepCaretChapterLive(){
  const sel = getSelection(); if(!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  const want = [sectionOfNode(r.startContainer), sectionOfNode(r.endContainer)].filter(Boolean);
  if(want.length === liveSecs.length && want.every((x,i)=>x===liveSecs[i])) return false;
  liveSecs.forEach(x=>{ if(!want.includes(x)) setClass(x, 'live', false); });
  want.forEach(x=>setClass(x, 'live', true));
  liveSecs = want;
  return true;
}
function sectionOfNode(n){ const b = topBlock(n); return b ? b.parentNode : (isSection(n) ? n : null); }
document.addEventListener('selectionchange', ()=>{
  const sel=getSelection(); if(!sel.rangeCount || !editor.contains(sel.anchorNode)) return;
  keepCaretChapterLive();
  requestAnimationFrame(followCaret);
});
editor.addEventListener('beforeinput', ()=>{
  if(keepCaretChapterLive()) editor.getBoundingClientRect();   // draw it now, before the edit lands
});
editor.addEventListener('mousedown', ()=>{ freeView=false; });

function atStart(block, range){ const r=document.createRange(); r.setStart(block,0); r.setEnd(range.startContainer, range.startOffset); return r.toString().length===0; }
function caretTo(el, end){ const r=document.createRange(); r.selectNodeContents(el); r.collapse(!end); const s=getSelection(); s.removeAllRanges(); s.addRange(r); }

// Structural edits go through the browser's own editing commands so that
// ⌘Z undoes them like typing.
const cmd = (name, value) => document.execCommand(name, false, value);
function newParagraphAfter(){
  cmd('insertParagraph');
  const b = topBlock(getSelection().anchorNode);
  if(b && b.tagName !== 'P') cmd('formatBlock', '<p>');
  const nb = topBlock(getSelection().anchorNode);
  if(nb) setClass(nb, 'scene', false);
}

editor.addEventListener('keydown', e=>{
  const sel=getSelection(); if(!sel.rangeCount) return;
  const range=sel.getRangeAt(0), block=topBlock(range.startContainer);
  if(e.key==='Enter' && !e.shiftKey && block && block.tagName==='H2'){
    e.preventDefault(); Undo.command(()=>{ caretTo(block, true); newParagraphAfter(); });
  } else if(e.key==='Backspace' && range.collapsed && block && block.tagName==='P' && block.previousElementSibling && block.previousElementSibling.tagName==='H2' && atStart(block, range) && block.textContent.trim()){
    e.preventDefault();   // don't merge the first paragraph into the chapter title
  } else if(e.key==='Tab'){ e.preventDefault(); }
});

editor.addEventListener('paste', e=>{
  e.preventDefault();
  const t = (e.clipboardData||window.clipboardData).getData('text/plain'); if(!t) return;
  const text = smartOn() ? smarten(t) : t;
  Undo.command(()=>{
    if(!/\n/.test(text.trim())) cmd('insertText', text);
    else cmd('insertHTML', textToHTML(text, true));
  });
});
editor.addEventListener('drop', e=>{ if(e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault(); });

// Put the caret at the end of the paragraph it's in (or the end of the book).
function caretToBlockEnd(){
  const s = getSelection();
  let b = s.rangeCount && editor.contains(s.anchorNode) ? topBlock(s.anchorNode) : null;
  if(!b){ const secs = sections(); const last = secs[secs.length-1]; b = last && last.lastElementChild; }
  if(!b) return null;
  editor.focus(); caretTo(b, true);
  return b;
}
const isBlankPara = b => b.tagName==='P' && !b.textContent.trim() && !b.classList.contains('scene');
const keep = el => el.addEventListener('mousedown', e=>e.preventDefault());
['bItal','bScene','bChap'].forEach(id=>keep($(id)));
$('bItal').onclick = ()=>{ editor.focus(); Undo.command(()=>cmd('italic')); };
$('bScene').onclick = ()=>Undo.command(()=>{
  const b = caretToBlockEnd(); if(!b) return;
  freeView = false;
  if(!isBlankPara(b)) cmd('insertParagraph');
  cmd('insertText', '* * *');
  newParagraphAfter();
});
$('bChap').onclick = ()=>Undo.command(()=>{
  const b = caretToBlockEnd(); if(!b) return;
  freeView = false;
  if(!isBlankPara(b)) cmd('insertParagraph');
  cmd('formatBlock', '<h2>');
});

function setManuscriptHTML(html){
  // group the blocks into chapter sections before they go on the page
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '<p><br></p>';
  const frag = document.createDocumentFragment();
  let cur = null;
  for(const n of [...tpl.content.childNodes]){
    if(n.nodeType !== 1) continue;
    if(!cur || n.tagName === 'H2'){ cur = newSection(); frag.appendChild(cur); }
    cur.appendChild(n);
  }
  editor.replaceChildren(frag);
  wordWatcher.takeRecords();
  recountAll = true; structureDirty = true; layoutAll = true;
  normalizeStructure();
}
// Replace the whole manuscript. Within the same book (restore, import,
// put back) it's one undo step; opening a different book starts a fresh
// undo history.
function loadText(md, opts={}){
  if(opts.fresh){ setManuscriptHTML(textToHTML(md, false)); Undo.reset(); }
  else Undo.command(()=>setManuscriptHTML(textToHTML(md, false)));
  sig=''; relayout();
}

/* ================================================================ saving */

function bookJson(){ return JSON.stringify(S, null, 2) + '\n'; }

function markDirty(){
  if(!dirty){ dirty=true; firstDirtyAt=Date.now(); }
  wroteSinceSnap = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, Date.now()-firstDirtyAt > SAVE_MAX_WAIT ? 0 : SAVE_PAUSE);
  status();
}

// Saves are queued so two never overlap and the newest text always lands last.
function saveNow(){
  clearTimeout(saveTimer);
  saveChain = saveChain.then(async ()=>{
    if(!dirty || !bookPath) return;
    const md = toMarkdown(), bj = bookJson(), path = bookPath;
    dirty = false;
    try{
      await Store.saveBook(path, md, bj);
      lastSavedMd = md; lastSavedWords = countWords(md); lastSavedAt = new Date();
      if(saveError){ saveError = null; hideAlert('save'); toast('Saved again. Everything is on disk.'); }
      clearEmergency();
    }catch(err){
      dirty = true; saveError = String(err);
      writeEmergency(path, md);
      showAlert('save', `Not saved: ${saveError} Your text is still here. Keep this window open; retrying every 10 seconds.`, 'Try again', ()=>{ saveNow(); });
      clearTimeout(retryTimer); retryTimer = setTimeout(saveNow, 10000);
    }
    status();
  });
  return saveChain;
}

function writeEmergency(path, md){ try{ localStorage.setItem(EMERGENCY_KEY, JSON.stringify({path, md, t:Date.now()})); }catch(e){} }
function clearEmergency(){ try{ localStorage.removeItem(EMERGENCY_KEY); }catch(e){} }
function readEmergency(){ try{ return JSON.parse(localStorage.getItem(EMERGENCY_KEY)); }catch(e){ return null; } }

async function snapshotNow(manual){
  if(!bookPath) return;
  await saveNow();
  try{
    const made = await Store.snapshot(bookPath, toMarkdown());
    lastSnapAt = Date.now(); wroteSinceSnap = false;
    if(manual) toast(made ? 'Copy saved to History.' : 'No changes since the last copy.');
  }catch(err){ if(manual) toast('Could not save a copy: '+err, true); }
}
setInterval(()=>{ if(wroteSinceSnap && Date.now()-lastSnapAt >= SNAPSHOT_EVERY) snapshotNow(false); }, 30000);

// If one action wipes out a lot of words, keep a copy and offer to put it back.
function deletionGuard(){
  if(guardOpen) return;
  const now = editorWords();
  const lost = lastSavedWords - now;
  if(lost < BIG_DELETE) return;
  guardOpen = true;
  const before = lastSavedMd, path = bookPath;
  Store.snapshot(path, before).catch(()=>{});
  showAlert('guard', `About ${lost.toLocaleString()} words were just removed. A copy of the text before that is in History.`,
    'Put them back', ()=>{ guardOpen=false; loadText(before); markDirty(); toast('Restored.'); },
    'Keep the change', ()=>{ guardOpen=false; lastSavedWords = now; });
}

window.addEventListener('blur', ()=>{ if(dirty) saveNow(); });
document.addEventListener('visibilitychange', ()=>{ if(document.hidden && dirty) saveNow(); });

Store.onClose(async event=>{
  await saveNow();
  if(saveError){ event.preventDefault(); showAlert('save', `Can't close yet: the last changes didn't save (${saveError}). Fix the problem or copy your text first.`, 'Try again', ()=>saveNow()); return; }
  try{ await Store.snapshot(bookPath, toMarkdown()); }catch(e){}
});

/* ================================================================ books */

async function openBook(path){
  if(bookPath && path !== bookPath){ await saveNow(); try{ await Store.snapshot(bookPath, toMarkdown()); }catch(e){} }
  const b = await Store.loadBook(path);
  let parsed = {}; try{ parsed = JSON.parse(b.book) || {}; }catch(e){}
  S = {...DEFAULTS, ...parsed};
  bookPath = path;
  applyGeometry();
  loadText(b.manuscript, {fresh:true});
  lastSavedMd = toMarkdown(); lastSavedWords = countWords(lastSavedMd); sessionStartWords = lastSavedWords;
  dirty = false; saveError = null; lastSavedAt = null; guardOpen = false; hideAlert();
  setView(Math.floor(FM/ppv)); freeView = true;
  $('bookName').textContent = S.title;
  syncForm();
  try{ await Store.snapshot(path, b.manuscript); }catch(e){}
  lastSnapAt = Date.now(); wroteSinceSnap = false;
  config.last_book = path; saveConfig();
  rememberRecent(path, S.title);

  const em = readEmergency();
  if(em && em.path === path && em.md && em.md !== b.manuscript){
    showAlert('emergency', `Text from ${new Date(em.t).toLocaleString()} that never reached the disk was found.`,
      'Restore it', ()=>{ loadText(em.md); markDirty(); clearEmergency(); },
      'Discard', ()=>clearEmergency());
  }
  status();
}

async function renderBooks(){
  const list = $('bookList');
  try{
    const [books, where] = await Promise.all([Store.listBooks(), Store.libraryFolder()]);
    $('booksWhere').textContent = Store.desktop ? `Each book is a folder in ${where}.` : 'In a browser, books are kept in this browser only. Use the desktop app for real files.';
    list.innerHTML = books.map(b=>`<li class="${b.path===bookPath?'current':''}"><span class="meta"><b>${esc(b.title || b.folder)}</b><span>${b.words.toLocaleString()} words · ${esc(b.modified.replace('T',' ').slice(0,16))}</span></span>${b.path===bookPath?'<span class="hint">Open</span>':`<button class="btn" data-open="${esc(b.path)}">Open</button>`}</li>`).join('') || '<li class="empty">No books yet.</li>';
  }catch(err){ list.innerHTML = `<li class="empty">Could not list books: ${esc(err)}</li>`; }
}
$('bookList').addEventListener('click', async e=>{
  const b = e.target.closest('[data-open]'); if(!b) return;
  try{ await openBook(b.dataset.open); closePanels(); }catch(err){ toast('Could not open that book: '+err, true); }
});
$('bkNew').onclick = ()=>newBook();
$('bkReveal').onclick = ()=>Store.reveal(bookPath || '').catch(err=>toast(String(err), true));

/* ================================================================ chapters */

function sectionWords(sec){
  editorWords();   // bring the per-paragraph counts up to date
  let n = 0; for(const b of sec.children) n += blockCounts.get(b) || 0;
  return n;
}
function renderChapters(){
  relayout();
  const laid = layoutSections();
  const firstIsChapter = laid.length && laid[0].sec.firstElementChild && laid[0].sec.firstElementChild.tagName === 'H2';
  const total = editorWords();
  $('chapSummary').textContent = `${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'} · ${total.toLocaleString()} words · ${plast-2} pages`;
  let num = 0;
  $('chapList').innerHTML = laid.map((x, i)=>{
    const h = x.sec.firstElementChild, isChap = h && h.tagName === 'H2';
    if(isChap) num++;
    const title = isChap ? (h.textContent.trim() || 'Untitled') : 'Opening pages';
    const label = isChap ? `Chapter ${numWord(num)}` : 'Before Chapter One';
    const canUp = isChap && i > 0 && (i > 1 || firstIsChapter);
    const canDown = isChap && i < laid.length - 1;
    return `<li><button class="go" data-go="${i}"><b>${esc(title)}</b><span>${label} · p. ${x.start-2} · ${sectionWords(x.sec).toLocaleString()} words</span></button>`
      + `<button class="btn mv" data-up="${i}" ${canUp?'':'disabled'} title="Move earlier" aria-label="Move ${esc(title)} earlier">↑</button>`
      + `<button class="btn mv" data-down="${i}" ${canDown?'':'disabled'} title="Move later" aria-label="Move ${esc(title)} later">↓</button></li>`;
  }).join('') || '<li class="empty">No chapters yet. Use Format → New Chapter.</li>';
}
$('chapList').addEventListener('click', e=>{
  const go = e.target.closest('[data-go]'), up = e.target.closest('[data-up]'), down = e.target.closest('[data-down]');
  const secs = sections();
  if(go){
    const sec = secs[+go.dataset.go]; if(!sec) return;
    const h = sec.firstElementChild;
    const target = (h.tagName === 'H2' && h.nextElementSibling) || h;   // start of the chapter's text
    editor.focus(); caretTo(target, false); keepCaretChapterLive();
    freeView = false; followCaret(); closePanels();
    return;
  }
  const i = up ? +up.dataset.up : down ? +down.dataset.down : -1;
  if(i < 0) return;
  const sec = secs[i], other = secs[up ? i-1 : i+1]; if(!sec || !other) return;
  // moving whole chapters is one undo step
  Undo.command(()=>{ if(up) other.before(sec); else other.after(sec); });
  afterChange(true);
  relayout(); renderChapters();
  const title = sec.firstElementChild.textContent.trim() || 'Untitled';
  toast(`Moved “${title}” ${up ? 'earlier' : 'later'}. ⌘Z undoes it.`);
});

/* ================================================================ history */

async function renderHistory(){
  const list = $('snapList');
  list.innerHTML = '<li class="empty">Loading…</li>';
  try{
    const snaps = await Store.listSnapshots(bookPath);
    const nowWords = countWords(toMarkdown());
    list.innerHTML = snaps.map(s=>{
      const d = s.words - nowWords;
      const diff = d===0 ? 'same as now' : `${d>0?'+':'−'}${Math.abs(d).toLocaleString()} vs now`;
      return `<li><span class="meta"><b>${esc(s.when)}</b><span>${s.words.toLocaleString()} words · ${diff}</span></span><button class="btn" data-restore="${esc(s.file)}">Restore</button></li>`;
    }).join('') || '<li class="empty">No copies yet. One is saved every 10 minutes while you write.</li>';
  }catch(err){ list.innerHTML = `<li class="empty">Could not read History: ${esc(err)}</li>`; }
}
$('snapList').addEventListener('click', async e=>{
  const b = e.target.closest('[data-restore]'); if(!b) return;
  if(b.dataset.armed !== '1'){ b.dataset.armed='1'; b.textContent='Click to confirm'; b.classList.add('primary'); setTimeout(()=>{ if(b.isConnected){ b.dataset.armed=''; b.textContent='Restore'; b.classList.remove('primary'); } }, 4000); return; }
  try{
    const text = await Store.readSnapshot(bookPath, b.dataset.restore);
    await snapshotNow(false);            // keep the current text first
    loadText(text); markDirty(); await saveNow();
    renderHistory(); toast('Restored. The text you replaced is the newest entry in History.');
  }catch(err){ toast('Could not restore: '+err, true); }
});
$('snapNow').onclick = async ()=>{ await snapshotNow(true); renderHistory(); };

/* ================================================================ panels */

const PANELS = ['setup','books','history','match','chapters'];
function openPanel(name){
  PANELS.forEach(p=>{ $(p).hidden = p!==name; document.querySelector(`[data-panel="${p}"]`).setAttribute('aria-pressed', String(p===name)); });
  if(name==='setup'){ syncForm(); $('copyBox').hidden=true; }
  if(name==='books') renderBooks();
  if(name==='history') renderHistory();
  if(name==='chapters') renderChapters();
  if(name==='match'){ if(!$('mFace').dataset.touched) $('mFace').value = S.face; renderTemplates(); solveAndShow(); }
  if(name==='setup' && Store.desktop) Store.appVersion().then(v=>$('aboutVersion').textContent=aboutText(v)).catch(()=>{});
}
function closePanels(){ PANELS.forEach(p=>{ $(p).hidden=true; document.querySelector(`[data-panel="${p}"]`).setAttribute('aria-pressed','false'); }); }
document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>{ $(b.dataset.panel).hidden ? openPanel(b.dataset.panel) : closePanels(); });
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=closePanels);

/* ================================================================ setup */

const fill = (sel, items) => sel.innerHTML = items.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');
fill($('sFace'), Object.entries(FACES).map(([k,f])=>[k,f.name]));
fill($('mFace'), Object.entries(FACES).map(([k,f])=>[k,f.name]));
function ensureOption(sel, value, label){
  if(![...sel.options].some(o=>o.value===String(value))){ const o=document.createElement('option'); o.value=value; o.textContent=label; sel.appendChild(o); }
}
const allTemplates = () => [...BUILTIN_TEMPLATES, ...(config.templates||[])];
function fillPageControls(){
  const trims = Object.entries(TRIMS).map(([k,t])=>[k,t.label]);
  if(S.trim==='custom' && S.custom) trims.push(['custom', `Custom · ${S.custom.w} × ${S.custom.h} in`]);
  fill($('sTrim'), trims);
  fill($('sSize'), SIZES.map(v=>[v, v+' pt'])); ensureOption($('sSize'), S.size, S.size+' pt');
  fill($('sLead'), LEADS.map(v=>[v, v+' pt'])); ensureOption($('sLead'), S.leading, S.leading+' pt');
  const opt = t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`;
  const mine = config.templates || [];
  $('sStyle').innerHTML = '<option value="">Custom settings</option>'
    + `<optgroup label="Typical books">${BUILTIN_TEMPLATES.map(opt).join('')}</optgroup>`
    + (mine.length ? `<optgroup label="Matched from your shelf">${mine.map(opt).join('')}</optgroup>` : '');
}
function syncForm(){
  fillPageControls();
  $('sTitle').value=S.title; $('sAuthor').value=S.author; $('sTrim').value=S.trim; $('sFace').value=S.face;
  $('sSize').value=String(S.size); $('sLead').value=String(S.leading); $('sDrop').checked=!!S.drop; $('sVerso').value=S.verso;
  $('sStyle').value = allTemplates().some(t=>t.id===S.template) ? S.template : '';
  $('sSmart').checked = smartOn();
  const e = config.email || {};
  $('eTo').value=e.to||''; $('eUser').value=e.username||''; $('ePass').value=e.password||'';
  $('eHost').value=e.smtp_host||''; $('ePort').value=e.smtp_port||'';
}
function refreshLayout(){
  const firstPage = view*ppv;
  applyGeometry(); relayout(); setView(Math.floor(firstPage/ppv));
  if(document.fonts) document.fonts.load(`16px ${FACES[S.face].stack}`).then(()=>{ wplCache.key=''; layoutAll=true; sig=''; relayout(); });
}
function onSetting(e){
  S.title=$('sTitle').value; S.author=$('sAuthor').value;
  if(e && ['sTrim','sFace','sSize','sLead'].includes(e.target.id)){ S.template=''; $('sStyle').value=''; }
  S.trim=$('sTrim').value; S.face=$('sFace').value;
  S.size=+$('sSize').value; S.leading=Math.max(+$('sLead').value, +$('sSize').value); S.drop=$('sDrop').checked; S.verso=$('sVerso').value;
  ensureOption($('sLead'), S.leading, S.leading+' pt'); $('sLead').value = String(S.leading);
  refreshLayout();
  $('bookName').textContent = S.title;
  markDirty();
  clearTimeout(recentT); recentT = setTimeout(()=>{ if(bookPath) rememberRecent(bookPath, S.title); }, 1500);
}
let recentT;
function applyTemplate(t){
  S.template = t.id; S.trim = 'custom'; S.custom = {...t.trim};
  S.face = t.face; S.size = t.size; S.leading = t.leading;
  syncForm(); refreshLayout(); markDirty();
}
['sTitle','sAuthor'].forEach(id=>$(id).addEventListener('input', onSetting));
['sTrim','sFace','sSize','sLead','sDrop','sVerso'].forEach(id=>$(id).addEventListener('change', onSetting));
$('sStyle').addEventListener('change', ()=>{
  const t = allTemplates().find(x=>x.id===$('sStyle').value);
  if(t){ applyTemplate(t); toast(`Using “${t.name}”.`); }
});

/* ================================================================ match a book */

// Work out a page template from measurements of a real book:
// - the trim size and the line count are measured directly;
// - type size comes from one typed line (its natural width at 100px tells
//   how big the type must be to fill the text width), or from words per line;
// - leading comes from the text height if measured, otherwise from the usual
//   share of the page a novel's text block takes up.
const MM = 25.4;
const isMetric = () => $('mMetric').checked;
function mNum(id, length){
  const v = parseFloat($(id).value);
  if(!isFinite(v) || v<=0) return null;
  return length && isMetric() ? v/MM : v;
}
const r1 = v => Math.round(v*10)/10, r2 = v => Math.round(v*100)/100;

function solveTemplate(){
  const w = mNum('mW',true), h = mNum('mH',true), lines = Math.round(mNum('mLines') || 0);
  const typed = $('mLine').value.split('\n').map(l=>l.trim().replace(/\s+/g,' ')).filter(l=>l.split(' ').length >= 4);
  const line = typed.join('\n'), words5 = mNum('mWords');
  const faceKey = $('mFace').value, face = FACES[faceKey];
  const unit = isMetric() ? 'millimetres' : 'inches';
  if(!w || !h || !lines) return {error:'Fill in the page width, the height and the lines on a full page.'};
  if(w < 3 || w > 10 || h < 4.5 || h > 14) return {error:`That page size looks unusual for a novel. Check the measurements are in ${unit}.`};
  if(lines < 12 || lines > 70) return {error:'Lines on a full page should be between 12 and 70. Count a page with no chapter heading or break.'};
  const useLine = typed.length > 0;
  if(!useLine && !words5) return {error:'Type one full line from the book (at least four words), or count the words on 5 full lines.'};

  const ctx = measureCtx || (measureCtx = document.createElement('canvas').getContext('2d'));
  ctx.font = `100px ${face.stack}`;
  const corpus = SAMPLE.replace(/[#*]/g,'').replace(/\s+/g,' ').trim();
  const perWord100 = ctx.measureText(corpus).width / corpus.split(' ').length;   // average word + space at 100px

  const W = w*96, H = h*96;
  const tw = mNum('mTW',true), th = mNum('mTH',true);
  const twPx = tw ? tw*96 : W*0.73;
  if(twPx > W*0.95) return {error:'The text width is wider than the page. Check the measurement.'};

  // A justified line is stretched to fill the measure. On average its
  // natural width falls about half a word short of the full width, so solve
  //   natural(fs) + 0.45 * averageWord(fs) = textWidth
  // using the mean of the typed lines.
  const natural100 = useLine ? typed.reduce((sum,l)=>sum + ctx.measureText(l).width, 0) / typed.length : 0;
  let fsPx = useLine ? 100 * twPx / (natural100 + 0.45*perWord100)
                     : 100 * twPx / ((words5/5) * perWord100);
  let size = r1(fsPx*0.75);
  const warnings = [];
  if(size < 7.5 || size > 15) warnings.push(`A ${size} pt type size is unusual for a novel. Check the line or word count.`);
  size = Math.min(16, Math.max(7, size));
  fsPx = size/0.75;

  let leadPx = th ? (th*96 - 0.95*fsPx)/(lines-1) : (H*0.795)/lines;
  let leading = r1(leadPx*0.75);
  if(leading < size*1.05){ leading = r1(size*1.1); warnings.push('The lines came out very tight, so the leading was opened up a little. Measuring the text height will make this exact.'); }
  if(leading > size*1.7){ warnings.push('The leading came out unusually loose. Check the lines per page and the text height.'); }
  leadPx = leading/0.75;

  const blockH = lines*leadPx;
  if(blockH > H*0.96) return {error:'That many lines at this size won’t fit on the page. Check the line count and page height.'};
  const sidePx = (W - twPx)/2;
  const topPx = (H - blockH)*0.45;                 // novels sit the text block slightly high
  const bottomPx = H - topPx - blockH - 0.5;       // so exactly `lines` lines fit
  const wpl = twPx / (perWord100*fsPx/100);

  return {
    name: $('mName').value.trim() || `Matched ${w.toFixed(2)} × ${h.toFixed(2)} in`,
    trim: {w:r2(w), h:r2(h), side:sidePx/96, top:topPx/96, bottom:bottomPx/96},
    face: faceKey, size, leading, lines, wpl, warnings,
    measured: {w, h, lines, line: useLine ? line : '', words5: words5 || null, textWidth: tw, textHeight: th}
  };
}

function solveAndShow(){
  const r = solveTemplate();
  $('mSave').disabled = !!r.error;
  if(r.error){ $('mResult').innerHTML = esc(r.error); return r; }
  $('mResult').innerHTML =
    `<b>${esc(FACES[r.face].name)} ${r.size}/${r.leading} pt</b> on a ${r.trim.w} × ${r.trim.h} in page<br>`
    + `${r.lines} lines a page · about ${Math.round(r.wpl)} words a line · about ${Math.round(r.wpl*r.lines/10)*10} words a full page`
    + r.warnings.map(x=>`<br><span class="warn">${esc(x)}</span>`).join('');
  return r;
}
['mName','mW','mH','mLines','mLine','mWords','mTW','mTH'].forEach(id=>$(id).addEventListener('input', solveAndShow));
$('mFace').addEventListener('change', ()=>{ $('mFace').dataset.touched='1'; solveAndShow(); });
$('mMetric').addEventListener('change', ()=>{
  document.querySelectorAll('#match .unit').forEach(u=>u.textContent = isMetric() ? 'mm' : 'in');
  solveAndShow();
});
$('mClear').onclick = ()=>{ ['mName','mW','mH','mLines','mLine','mWords','mTW','mTH'].forEach(id=>$(id).value=''); solveAndShow(); };
$('mSave').onclick = ()=>{
  const r = solveTemplate(); if(r.error) return;
  const t = {id:'u-'+Date.now().toString(36), name:r.name, trim:r.trim, face:r.face, size:r.size, leading:r.leading, measured:r.measured, created:new Date().toISOString()};
  config.templates = [...(config.templates||[]), t];
  saveConfig();
  applyTemplate(t);
  renderTemplates();
  toast(`Saved “${t.name}” and applied it. ${G.lines} lines a page.`);
};

function renderTemplates(){
  const mine = config.templates || [];
  $('tplList').innerHTML = mine.map(t=>`<li class="${t.id===S.template?'current':''}"><span class="meta"><b>${esc(t.name)}</b><span>${esc(FACES[t.face]?.name||t.face)} ${t.size}/${t.leading} · ${t.trim.w} × ${t.trim.h} in${t.measured?.lines?` · ${t.measured.lines} lines`:''}</span></span>`
    + `<button class="btn" data-use="${esc(t.id)}">Use</button><button class="btn" data-copy="${esc(t.id)}" title="Copy this template as text, to share or send">Copy</button><button class="btn" data-del="${esc(t.id)}">Delete</button></li>`).join('')
    || '<li class="empty">None yet. Measure a book above and save it.</li>';
}
$('tplList').addEventListener('click', e=>{
  const use = e.target.closest('[data-use]'), del = e.target.closest('[data-del]'), cp = e.target.closest('[data-copy]');
  if(cp){
    const t = (config.templates||[]).find(x=>x.id===cp.dataset.copy); if(!t) return;
    const text = 'Galley Proof template\n' + JSON.stringify({name:t.name, trim:t.trim, face:t.face, size:t.size, leading:t.leading, measured:t.measured}, null, 2);
    navigator.clipboard.writeText(text).then(()=>toast('Template copied. Paste it wherever you like.'), ()=>{ $('copyBox').hidden=false; $('copyBox').value=text; openPanel('setup'); $('copyBox').hidden=false; $('copyBox').value=text; $('copyBox').select(); });
    return;
  }
  if(use){ const t = (config.templates||[]).find(x=>x.id===use.dataset.use); if(t){ applyTemplate(t); renderTemplates(); toast(`Using “${t.name}”.`); } }
  if(del){
    if(del.dataset.armed!=='1'){ del.dataset.armed='1'; del.textContent='Confirm'; setTimeout(()=>{ if(del.isConnected){ del.dataset.armed=''; del.textContent='Delete'; } }, 4000); return; }
    config.templates = (config.templates||[]).filter(x=>x.id!==del.dataset.del);
    saveConfig(); renderTemplates(); syncForm();
    toast('Template deleted. Books already using it keep their page settings.');
  }
});

/* ================================================================ updates */

// Checked a few seconds after opening, then every six hours while the app
// stays open (and when it comes back to the front after a long while).
const UPDATE_EVERY = 6 * 60 * 60 * 1000;
let lastUpdateCheck = 0, lastUpdateProblem = '';
function aboutText(v){
  return `Galley Proof version ${v}` + (lastUpdateProblem ? `. The last update check didn't work: ${lastUpdateProblem}` : '');
}
setInterval(()=>{ if(Date.now() - lastUpdateCheck >= UPDATE_EVERY) checkForUpdates(false); }, 15 * 60 * 1000);
window.addEventListener('focus', ()=>{ if(lastUpdateCheck && Date.now() - lastUpdateCheck >= UPDATE_EVERY) checkForUpdates(false); });
async function checkForUpdates(manual){
  if(!Store.desktop) return;
  lastUpdateCheck = Date.now();
  try{
    const u = await Store.checkUpdate();
    lastUpdateProblem = '';
    if(u){
      if(!$('alert').hidden && !manual) return;   // don't cover a more important message
      showAlert('update', `Galley Proof ${u.version} is ready to install (you have ${u.current}).`, 'Update and restart', installUpdate, 'Later', null);
    } else if(manual) toast('You have the latest version.');
  }catch(err){ lastUpdateProblem = String(err); if(manual) toast(String(err), true); }
}
async function installUpdate(){
  await saveNow();
  if(saveError){ toast('Your book has to save before updating. Fix the save problem first.', true); return; }
  try{ await Store.snapshot(bookPath, toMarkdown()); }catch(e){}
  toast('Downloading the update. Galley Proof will restart by itself.', false, 180000);
  try{ await Store.installUpdate(); }catch(err){ toast(String(err), true, 9000); }
}
$('bUpdate').onclick = ()=>checkForUpdates(true);

function saveConfig(){ Store.setConfig(config).catch(()=>{}); }
$('sSmart').addEventListener('change', ()=>{ config.smart_punct = $('sSmart').checked; saveConfig(); });
['eTo','eUser','ePass','eHost','ePort'].forEach(id=>$(id).addEventListener('change', ()=>{
  config.email = { to:$('eTo').value.trim(), from:$('eUser').value.trim(), username:$('eUser').value.trim(), password:$('ePass').value,
    smtp_host:$('eHost').value.trim(), smtp_port:+$('ePort').value || 0 };
  saveConfig();
}));

$('aCopy').onclick = ()=>{
  const t = toMarkdown(), box=$('copyBox');
  const show = ()=>{ box.hidden=false; box.value=t; box.focus(); box.select(); $('aCopy').textContent='Select all and copy'; };
  try{ navigator.clipboard.writeText(t).then(()=>{ $('aCopy').textContent='Copied'; setTimeout(()=>$('aCopy').textContent='Copy manuscript',1800); }, show); }catch(e){ show(); }
};
$('aImport').onclick = ()=>$('fileIn').click();
$('fileIn').onchange = e=>{
  const f=e.target.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload = async ()=>{
    await snapshotNow(false);
    const imported = smartOn() ? smarten(String(rd.result)) : String(rd.result);
    Undo.command(()=>setManuscriptHTML(textToHTML(imported, true)));
    sig=''; relayout(); setView(Math.floor(FM/ppv));
    lastSavedWords = 0; markDirty(); closePanels();
    toast('Imported. The text it replaced is saved in History.');
  };
  rd.readAsText(f); e.target.value='';
};

/* ================================================================ email */

async function sendEmail(){
  if(!Store.desktop){ toast('Email works in the desktop app.', true); return; }
  const e = config.email || {};
  if(!e.to || !e.username || !e.password){ openPanel('setup'); $('eTo').focus(); toast('Add your email settings first.', true); return; }
  await saveNow();
  const md = toMarkdown(), words = countWords(md), added = words - sessionStartWords;
  const now = new Date();
  const date = now.toLocaleDateString(undefined, {day:'numeric', month:'short', year:'numeric'});
  const iso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const title = S.title || 'Untitled';
  const subject = `${title} — ${date} — ${words.toLocaleString()} words`;
  const body = [
    `${title}${S.author ? ' by '+S.author : ''}`,
    `${words.toLocaleString()} words, ${plast-2} pages (${trimOf().w} × ${trimOf().h} in, ${G.lines} lines a page).`,
    `This session: ${added>=0?'+':'−'}${Math.abs(added).toLocaleString()} words.`,
    '',
    'The full manuscript is attached as a text file. Chapters start with "#", *asterisks* mark italics, and "* * *" is a scene break. Import it into Galley Proof to see it as pages again.',
    '',
    'Sent from Galley Proof'
  ].join('\n');
  const name = `${title.replace(/[<>:"/\\|?*]+/g,' ').trim() || 'Manuscript'} ${iso}.txt`;
  toast('Sending…', false, 30000);
  try{
    await Store.sendEmail({ to:e.to, from:e.from||e.username, smtp_host:e.smtp_host||'smtp.gmail.com', smtp_port:e.smtp_port||465, username:e.username, password:e.password }, subject, body, name, md);
    toast(`Sent to ${e.to}`);
  }catch(err){ toast(String(err), true, 9000); }
}
$('eSend').onclick = sendEmail;

/* ================================================================ messages */

let alertKind = null;
function showAlert(kind, text, yes, onYes, no, onNo){
  alertKind = kind;
  $('alertText').textContent = text;
  $('alertYes').textContent = yes; $('alertYes').onclick = ()=>{ hideAlert(); onYes && onYes(); };
  $('alertNo').hidden = !no; $('alertNo').textContent = no || ''; $('alertNo').onclick = ()=>{ hideAlert(); onNo && onNo(); };
  $('alert').hidden = false;
  requestAnimationFrame(()=>{ fit(); relayout(); });
}
function hideAlert(kind){
  if(kind && kind !== alertKind) return;
  if(alertKind === 'guard') guardOpen = false;
  alertKind = null; $('alert').hidden = true;
  requestAnimationFrame(()=>{ fit(); relayout(); });
}
let toastT;
function toast(text, bad, ms){
  const t=$('toast'); t.textContent=text; t.classList.toggle('bad', !!bad); t.hidden=false;
  clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true, ms || (bad?6000:2600));
}

/* ================================================================ find and replace */

// Matches are found in each paragraph's text. Straight and curly quotes are
// treated as the same, so searching for don't finds don’t.
const Find = (() => {
  let matches = [], index = -1, timer = null;
  const fold = t => t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const escRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hl = (window.CSS && CSS.highlights && window.Highlight) ? CSS.highlights : null;
  const isOpen = () => !$('findbar').hidden;

  function pattern(){
    const q = fold($('fFind').value);
    if(!q) return null;
    let src = escRe(q);
    if($('fWord').checked) src = `(?<![\\p{L}\\p{N}'])${src}(?![\\p{L}\\p{N}'])`;
    return new RegExp(src, 'gu' + ($('fCase').checked ? '' : 'i'));
  }
  function search(){
    matches = []; index = -1;
    const re = pattern();
    if(re){
      for(const b of allBlocks()){
        const text = fold(b.textContent);
        re.lastIndex = 0; let m;
        while((m = re.exec(text))){ matches.push({b, start:m.index, end:m.index + m[0].length}); if(!m[0].length) re.lastIndex++; if(matches.length >= 10000) break; }
        if(matches.length >= 10000) break;
      }
    }
    paint(); count();
  }
  // Turn a paragraph offset range into a DOM Range.
  function toRange(m){
    const r = document.createRange();
    const w = document.createTreeWalker(m.b, NodeFilter.SHOW_TEXT);
    let pos = 0, n, startSet = false;
    while((n = w.nextNode())){
      const len = n.data.length;
      if(!startSet && m.start <= pos + len){ r.setStart(n, m.start - pos); startSet = true; }
      if(startSet && m.end <= pos + len){ r.setEnd(n, m.end - pos); return r; }
      pos += len;
    }
    return startSet ? r : null;
  }
  function paint(){
    if(!hl) return;
    if(!matches.length || !isOpen()){ hl.delete('gp-find'); hl.delete('gp-find-current'); return; }
    const rs = matches.slice(0, 2000).map(toRange).filter(Boolean);
    hl.set('gp-find', new Highlight(...rs));
    const cur = matches[index] && toRange(matches[index]);
    if(cur) hl.set('gp-find-current', new Highlight(cur)); else hl.delete('gp-find-current');
  }
  function count(){
    $('fCount').textContent = !$('fFind').value ? '' : !matches.length ? 'Not found' : index < 0 ? `${matches.length.toLocaleString()} found` : `${index+1} of ${matches.length.toLocaleString()}`;
    $('fOne').disabled = index < 0; $('fAll').disabled = !matches.length;
  }
  // Which match comes first after the cursor.
  function fromCaret(){
    const sel = getSelection(); if(!sel.rangeCount || !editor.contains(sel.anchorNode)) return 0;
    const at = sel.getRangeAt(0);
    for(let i = 0; i < matches.length; i++){
      const r = toRange(matches[i]); if(r && at.compareBoundaryPoints(Range.START_TO_START, r) <= 0) return i;
    }
    return 0;
  }
  function go(dir){
    if(!matches.length){ count(); return; }
    index = index < 0 ? (dir > 0 ? fromCaret() : (fromCaret() - 1 + matches.length) % matches.length)
                      : (index + dir + matches.length) % matches.length;
    const r = toRange(matches[index]); if(!r) return;
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    keepCaretChapterLive(); freeView = false; followCaret();
    paint(); count();
  }
  // Replace one match's text in place. The undo history records the change.
  function replaceAt(m, text){
    const r = toRange(m); if(!r) return;
    r.deleteContents();
    if(text) r.insertNode(document.createTextNode(text));
    m.b.normalize();
  }
  function replaceOne(){
    if(index < 0 || !matches[index]) return;
    const keep = index;
    Undo.command(()=>replaceAt(matches[index], $('fRepl').value));
    afterChange(true);
    search(); index = Math.min(keep, matches.length) - 1; go(1);
  }
  function replaceAll(){
    if(!matches.length) return;
    const n = matches.length, text = $('fRepl').value;
    Undo.command(()=>{ for(let i = matches.length - 1; i >= 0; i--) replaceAt(matches[i], text); });
    afterChange(true);
    search();
    toast(`Replaced ${n.toLocaleString()} ${n === 1 ? 'match' : 'matches'}. ⌘Z undoes it.`, false, 4000);
  }
  function open(replace){
    $('findbar').hidden = false; closePanels();
    const sel = getSelection();
    if(sel.rangeCount && !sel.isCollapsed && editor.contains(sel.anchorNode) && sel.toString().length < 200 && !sel.toString().includes('\n')) $('fFind').value = sel.toString();
    const f = replace ? $('fRepl') : $('fFind'); f.focus(); f.select();
    search();
    requestAnimationFrame(()=>{ fit(); relayout(); });
  }
  function close(){
    $('findbar').hidden = true; paint();
    if(index >= 0 && matches[index]){ const r = toRange(matches[index]); if(r){ editor.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
    else editor.focus();
    requestAnimationFrame(()=>{ fit(); relayout(); });
  }
  function useSelection(){
    const t = getSelection().toString();
    if(t && !t.includes('\n')){ $('fFind').value = t; if(isOpen()) search(); else open(false); }
  }
  // keep results current while the manuscript changes
  function refresh(){ if(!isOpen()) return; clearTimeout(timer); timer = setTimeout(()=>{ const i = index; search(); if(i >= 0 && matches.length){ index = Math.min(i, matches.length - 1); paint(); count(); } }, 250); }

  $('fFind').addEventListener('input', ()=>{ search(); if(matches.length){ index = -1; go(1); $('fFind').focus(); } });
  $('fCase').addEventListener('change', search); $('fWord').addEventListener('change', search);
  $('fNext').onclick = ()=>go(1); $('fPrev').onclick = ()=>go(-1);
  $('fOne').onclick = replaceOne; $('fAll').onclick = replaceAll; $('fClose').onclick = close;
  $('fFind').addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); go(e.shiftKey ? -1 : 1); $('fFind').focus(); } });
  $('fRepl').addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); replaceOne(); $('fRepl').focus(); } });
  $('findbar').addEventListener('keydown', e=>{ if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); close(); } });
  return { open, close, next:()=>{ if(!isOpen()) open(false); else go(1); }, prev:()=>{ if(!isOpen()) open(false); else go(-1); }, useSelection, refresh, get isOpen(){ return isOpen(); } };
})();

/* ================================================================ actions, menus and keys */

// Every command lives here once. The native menu, the toolbar and the
// keyboard all call run(); shortcuts that both the menu and the page might
// see are only carried out once.
const inField = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };
const ACTIONS = {
  undo:        ()=>{ if(inField()) document.execCommand('undo'); else Undo.undo(); },
  redo:        ()=>{ if(inField()) document.execCommand('redo'); else Undo.redo(); },
  new_book:    ()=>newBook(),
  open_book:   ()=>openPanel('books'),
  books:       ()=>openPanel('books'),
  open_folder: ()=>openBookFolder(),
  save:        ()=>snapshotNow(true),
  duplicate:   ()=>duplicateBook(),
  history:     ()=>openPanel('history'),
  import:      ()=>$('fileIn').click(),
  export_docx: ()=>exportAs('docx'),
  export_txt:  ()=>exportAs('txt'),
  email:       ()=>sendEmail(),
  reveal:      ()=>Store.reveal(bookPath || '').catch(err=>toast(String(err), true)),
  book_setup:  ()=>openPanel('setup'),
  settings:    ()=>openPanel('setup'),
  page_style:  ()=>{ openPanel('setup'); $('sStyle').focus(); },
  match:       ()=>openPanel('match'),
  italic:      ()=>{ if(caretInEditor()) Undo.command(()=>document.execCommand('italic')); },
  chapter:     ()=>$('bChap').click(),
  scene:       ()=>$('bScene').click(),
  prev:        ()=>turn(-1),
  next:        ()=>turn(1),
  toolbar:     ()=>setToolbar(!config.toolbar_hidden),
  focus:       ()=>setFocus(!document.body.classList.contains('focus')),
  check_updates: ()=>checkForUpdates(true),
  find:        ()=>Find.open(false),
  replace:     ()=>Find.open(true),
  find_next:   ()=>Find.next(),
  find_prev:   ()=>Find.prev(),
  find_selection: ()=>Find.useSelection(),
  chapters:    ()=>openPanel('chapters'),
  smarten_book: ()=>{
    const before = toMarkdown(), after = smarten(before);
    if(before === after){ toast('Quotes and dashes are already typographer’s style.'); return; }
    loadText(after); markDirty();
    toast('Converted quotes, apostrophes, dashes and ellipses. ⌘Z undoes it.', false, 5000);
  },
};
const lastRun = {};
function run(action, source){
  const now = Date.now(), prev = lastRun[action];
  if(prev && prev.source !== source && now - prev.t < 450){ lastRun[action] = null; return; }   // same keypress seen twice
  lastRun[action] = {source, t:now};
  const m = /^recent:(\d+)$/.exec(action);
  if(m){ const r = (config.recent||[])[+m[1]]; if(r) openBook(r.path).catch(err=>{ toast('Could not open that book: '+err, true); forgetRecent(r.path); }); return; }
  const fn = ACTIONS[action]; if(fn) fn();
}
function caretInEditor(){ const s = getSelection(); return s.rangeCount && editor.contains(s.anchorNode); }

// Keyboard shortcuts, matching the menu. Keys are written as they appear in
// the menu: mod = ⌘ on a Mac, Ctrl elsewhere.
const KEYS = {
  'mod+z':'undo', 'mod+shift+z':'redo', 'mod+y':'redo',
  'mod+f':'find', 'alt+mod+f':'replace', 'mod+g':'find_next', 'mod+shift+g':'find_prev', 'mod+e':'find_selection',
  'mod+n':'new_book', 'mod+o':'open_book', 'mod+shift+o':'open_folder', 'mod+s':'save',
  'mod+shift+h':'history', 'mod+shift+i':'import', 'mod+shift+e':'email', 'mod+shift+p':'book_setup',
  'mod+,':'settings', 'mod+i':'italic', 'mod+shift+n':'chapter', 'mod+shift+8':'scene', 'mod+shift+*':'scene',
  'mod+shift+l':'books', 'mod+shift+c':'chapters', 'alt+mod+arrowleft':'prev', 'alt+mod+arrowright':'next', 'alt+mod+t':'toolbar',
  'mod+shift+f':'focus'
};
function keyName(e){
  const parts = [];
  if(e.altKey) parts.push('alt');
  if(e.ctrlKey || e.metaKey) parts.push('mod');
  if(e.shiftKey) parts.push('shift');
  let k = e.key.toLowerCase();
  if(e.code && /^Digit\d$/.test(e.code)) k = e.code.slice(5);            // shift+8 gives "*" on most layouts
  if(e.altKey && e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();  // ⌥ changes letters on a Mac
  parts.push(k);
  return parts.join('+');
}
document.addEventListener('keydown', e=>{
  const action = KEYS[keyName(e)];
  if(action && (action === 'undo' || action === 'redo') && inField()) return;   // text boxes keep their own undo
  if(action){ e.preventDefault(); run(action, 'key'); return; }
  if(e.key==='Escape' && Find.isOpen && !(e.target.closest && e.target.closest('.panel'))){ e.preventDefault(); Find.close(); return; }
  if(e.target.closest && e.target.closest('.panel')){ if(e.key==='Escape') closePanels(); return; }
  if(e.key==='PageDown'){ e.preventDefault(); turn(1); }
  else if(e.key==='PageUp'){ e.preventDefault(); turn(-1); }
  else if(e.key==='Escape'){ if(Find.isOpen) Find.close(); else if(PANELS.some(p=>!$(p).hidden)) closePanels(); else if(document.body.classList.contains('focus')) setFocus(false); }
});
Store.onMenu(id=>run(id, 'menu'));

function setToolbar(hidden){
  config.toolbar_hidden = !!hidden; saveConfig(); pushMenuState();
  document.body.classList.toggle('notoolbar', !!hidden);
  requestAnimationFrame(()=>{ fit(); relayout(); });
}

// The menu shows recent books and the toolbar state; keep it current.
function pushMenuState(){
  Store.setMenuState({ recent: config.recent || [], toolbar_hidden: !!config.toolbar_hidden }).catch(()=>{});
}
function rememberRecent(path, title){
  const list = (config.recent || []).filter(r=>r.path !== path);
  list.unshift({path, title: title || 'Untitled'});
  config.recent = list.slice(0, 10);
  saveConfig(); pushMenuState();
}
function forgetRecent(path){
  config.recent = (config.recent || []).filter(r=>r.path !== path);
  saveConfig(); pushMenuState();
}

/* ================================================================ more book commands */

async function newBook(){
  try{
    await saveNow();
    const settings = {...S, title:'Untitled'};
    const path = await Store.createBook('Untitled', '# \n', JSON.stringify(settings, null, 2));
    await openBook(path);
    openPanel('setup'); $('sTitle').focus(); $('sTitle').select();
    toast('New book started. Give it a title.');
  }catch(err){ toast('Could not start a new book: '+err, true); }
}
async function openBookFolder(){
  try{
    const path = await Store.pickBookFolder();
    if(path){ await openBook(path); closePanels(); toast(`Opened “${S.title}”.`); }
  }catch(err){ toast(String(err), true, 8000); }
}
async function duplicateBook(){
  try{
    await saveNow();
    const title = `${S.title || 'Untitled'} (copy)`;
    const path = await Store.createBook(title, toMarkdown(), JSON.stringify({...S, title}, null, 2));
    await openBook(path);
    toast(`Now working in “${title}”. The original is unchanged.`, false, 5000);
  }catch(err){ toast('Could not duplicate the book: '+err, true); }
}
async function exportAs(kind){
  if(!Store.desktop){ toast('Exporting works in the desktop app. Use Copy manuscript instead.', true); return; }
  await saveNow();
  const base = (S.title || 'Manuscript').replace(/[<>:"/\\|?*]+/g,' ').trim() || 'Manuscript';
  try{
    const where = await Store.exportBook(kind, `${base}.${kind==='docx'?'docx':'txt'}`, toMarkdown(), S.title || '', S.author || '');
    if(where) toast(`Exported to ${where}`, false, 5000);
  }catch(err){ toast(String(err), true, 8000); }
}

function setFocus(on){ document.body.classList.toggle('focus', on); $('unfocus').hidden=!on; closePanels(); requestAnimationFrame(()=>{ fit(); relayout(); followCaret(); }); }
$('bFocus').onclick = ()=>setFocus(true); $('unfocus').onclick = ()=>setFocus(false);

/* ================================================================ status */

let measureCtx=null;
let wplCache = {key:'', value:0};
function wordsPerLine(){
  const key = `${G.fs}|${G.T}|${S.face}`;
  if(wplCache.key === key) return wplCache.value;
  wplCache = {key, value: measureWordsPerLine()};
  return wplCache.value;
}
function measureWordsPerLine(){
  try{
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = `${G.fs}px ${(FACES[S.face]||FACES.garamond).stack}`;
    let sample = '';
    for(const el of allBlocks()){ sample += el.textContent + ' '; if(sample.length > 2000) break; }
    sample = sample.slice(0, 2000).trim() || 'The quick brown fox jumps over the lazy dog while the barometer falls.';
    const n = sample.split(/\s+/).length; const w = measureCtx.measureText(sample.replace(/\s+/g,' ')).width;
    return n ? G.T / (w/n) : 0;
  }catch(e){ return 0; }
}
function status(){
  const words = editorWords();
  const wpl = wordsPerLine(), pages = plast-2;
  const parts = [
    `${words.toLocaleString()} words`,
    `${pages} ${pages===1?'page':'pages'}`,
    `${G.lines} lines a page`,
    `about ${Math.round(wpl)} words a line`,
    `about ${Math.round(wpl*G.lines/10)*10} words a full page`
  ];
  let save = '';
  if(saveError) save = `<span class="unsaved">Not saved</span>`;
  else if(dirty) save = `<span>Saving…</span>`;
  else if(lastSavedAt) save = `<span class="saved">Saved ${lastSavedAt.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</span>`;
  else if(bookPath) save = `<span class="saved">Saved</span>`;
  $('status').innerHTML = parts.map(p=>`<span>${p}</span>`).join('') + save;
  const trim = trimOf();
  $('spec').innerHTML = `${esc(FACES[S.face].name)} ${S.size}/${S.leading} pt · ${trim.w} × ${trim.h} in<br>${G.lines} lines a page · text block ${(G.T/96).toFixed(2)} in wide · about ${Math.round(wpl)} words a line`;
}

/* ================================================================ boot */

async function boot(){
  applyGeometry();
  try{ config = await Store.getConfig() || {}; }catch(e){ config = {}; }
  document.body.classList.toggle('notoolbar', !!config.toolbar_hidden);
  pushMenuState();
  let opened = false;
  if(config.last_book){ try{ await openBook(config.last_book); opened = true; }catch(e){} }
  if(!opened){
    try{
      const books = await Store.listBooks();
      if(books.length){ await openBook(books[0].path); opened = true; }
      else {
        const settings = {...DEFAULTS, title:'The Weatherglass', author:'Your Name'};
        const path = await Store.createBook('The Weatherglass (sample)', SAMPLE, JSON.stringify(settings, null, 2));
        await openBook(path); opened = true;
        toast('This is a sample book. Open Books to start your own.', false, 6000);
      }
    }catch(err){
      loadText(SAMPLE);
      showAlert('save', `Could not open your books folder: ${err}`, 'OK', null);
    }
  }
  if(document.fonts){ document.fonts.ready.then(()=>{ wplCache.key=''; layoutAll=true; sig=''; relayout(); }); document.fonts.addEventListener('loadingdone', ()=>{ wplCache.key=''; layoutAll=true; sig=''; relayout(); }); }
  setTimeout(()=>checkForUpdates(false), 5000);
}

let rz; window.addEventListener('resize', ()=>{ clearTimeout(rz); rz=setTimeout(()=>{ const firstPage=view*ppv; fit(); sig=''; relayout(); setView(Math.floor(firstPage/ppv)); followCaret(); }, 120); });

// exposed for tests
window.GalleyProof = { toMarkdown, textToHTML, countWords, saveNow, openBook, loadText, undo: ()=>Undo.undo(), redo: ()=>Undo.redo(), editorWords, get path(){ return bookPath; } };

boot();
})();
