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

function inlineToText(el){
  let out='';
  el.childNodes.forEach(n=>{
    if(n.nodeType===3) out += n.textContent;
    else if(n.nodeType===1){
      if(n.tagName==='BR') return;
      const inner = inlineToText(n);
      out += /^(I|EM)$/.test(n.tagName) && inner.trim() ? `*${inner}*` : inner;
    }
  });
  return out.replace(/\s+/g,' ').trim();
}

function toMarkdown(){
  const parts = [];
  for(const el of editor.children){
    if(el.tagName==='H2') parts.push(('# ' + inlineToText(el)).trimEnd() || '#');
    else if(el.classList.contains('scene')) parts.push('* * *');
    else { const t = inlineToText(el); if(t) parts.push(t); }
  }
  return parts.join('\n\n') + '\n';
}

const countWords = md => (md.replace(/^\s*\* \* \*\s*$/gm,'').match(/[\p{L}\p{N}’'\-]+/gu)||[]).length;

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
  Object.assign(editor.style, {
    left:(FM*W + m)+'px', top:top+'px', width:T+'px', height:(lines*L + .5)+'px',
    columnWidth:T+'px', columnGap:(2*m)+'px', fontSize:fs+'px', lineHeight:L+'px'
  });
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

function relayout(){
  const hs = [...editor.querySelectorAll('h2.chapter')];
  hs.forEach((h,i)=>{ const lab='Chapter '+numWord(i+1); if(h.dataset.label!==lab) h.dataset.label=lab; h.classList.toggle('empty', !h.textContent.trim()); });
  chapters = hs.map(h=>{ const r=h.getClientRects()[0]; return {page:r?pageOfRect(r):FM, title:h.textContent.trim()||'Untitled'}; });
  plast = FM;
  const last = editor.lastElementChild;
  if(last){ const rs = last.getClientRects(); if(rs.length) plast = Math.max(FM, pageOfRect(rs[rs.length-1])); }
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
    if(n===editor) n = editor.children[r.startOffset] || editor.lastElementChild;
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
const topBlock = n => { while(n && n.parentNode!==editor) n = n.parentNode; return n; };

function normalize(){
  for(const n of [...editor.childNodes]){
    if(n.nodeType===3){ if(n.textContent.trim()){ const p=document.createElement('p'); editor.insertBefore(p,n); p.appendChild(n); } else n.remove(); }
    else if(n.nodeType===1 && !/^(P|H2)$/.test(n.tagName)){
      if(n.tagName==='BR'){ n.remove(); continue; }
      const p=document.createElement('p'); editor.insertBefore(p,n); while(n.firstChild) p.appendChild(n.firstChild); n.remove();
    }
  }
  editor.querySelectorAll('span, font, b, strong, u').forEach(sp=>{ while(sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp); sp.remove(); });
  editor.querySelectorAll('[style]').forEach(el=>el.removeAttribute('style'));
  editor.querySelectorAll('h2:not(.chapter)').forEach(h=>h.classList.add('chapter'));
  if(!editor.firstElementChild) editor.innerHTML='<p><br></p>';
}
function markScenes(scope){
  (scope ? [scope] : editor.querySelectorAll('p')).forEach(p=>{ if(p && p.tagName==='P') p.classList.toggle('scene', SCENE.test(p.textContent)); });
}
let rafPending=false;
function schedule(){ if(rafPending) return; rafPending=true; requestAnimationFrame(()=>{ rafPending=false; relayout(); followCaret(); }); }

editor.addEventListener('input', ()=>{
  freeView=false; normalize();
  const sel=getSelection(); if(sel.rangeCount) markScenes(topBlock(sel.getRangeAt(0).startContainer));
  schedule(); markDirty(); deletionGuard();
});
document.addEventListener('selectionchange', ()=>{
  const sel=getSelection(); if(!sel.rangeCount || !editor.contains(sel.anchorNode)) return;
  requestAnimationFrame(followCaret);
});
editor.addEventListener('mousedown', ()=>{ freeView=false; });

function atStart(block, range){ const r=document.createRange(); r.setStart(block,0); r.setEnd(range.startContainer, range.startOffset); return r.toString().length===0; }
function caretTo(el, end){ const r=document.createRange(); r.selectNodeContents(el); r.collapse(!end); const s=getSelection(); s.removeAllRanges(); s.addRange(r); }

editor.addEventListener('keydown', e=>{
  const sel=getSelection(); if(!sel.rangeCount) return;
  const range=sel.getRangeAt(0), block=topBlock(range.startContainer);
  if(e.key==='Enter' && block && block.tagName==='H2'){
    e.preventDefault(); const p=document.createElement('p'); p.innerHTML='<br>'; block.after(p); caretTo(p); editor.dispatchEvent(new Event('input'));
  } else if(e.key==='Backspace' && range.collapsed && block && block.tagName==='P' && block.previousElementSibling && block.previousElementSibling.tagName==='H2' && atStart(block, range)){
    e.preventDefault();
    if(!block.textContent.trim()){ const h=block.previousElementSibling; block.remove(); caretTo(h,true); editor.dispatchEvent(new Event('input')); }
  } else if(e.key==='Tab'){ e.preventDefault(); }
});

editor.addEventListener('paste', e=>{
  e.preventDefault();
  const t = (e.clipboardData||window.clipboardData).getData('text/plain'); if(!t) return;
  if(!/\n/.test(t.trim())) document.execCommand('insertText', false, t);
  else document.execCommand('insertHTML', false, textToHTML(t, true));
});
editor.addEventListener('drop', e=>{ if(e.dataTransfer && e.dataTransfer.types.includes('Files')) e.preventDefault(); });

function insertAfterCurrent(nodes, focusNode){
  const sel=getSelection();
  let block = sel.rangeCount && editor.contains(sel.anchorNode) ? topBlock(sel.getRangeAt(0).startContainer) : editor.lastElementChild;
  if(!block) block = editor.lastElementChild;
  const replace = block && block.tagName==='P' && !block.textContent.trim() && !block.classList.contains('scene');
  let ref = block;
  nodes.forEach(n=>{ ref.after(n); ref = n; });
  if(replace) block.remove();
  editor.focus(); caretTo(focusNode);
  freeView=false; editor.dispatchEvent(new Event('input'));
}
const keep = el => el.addEventListener('mousedown', e=>e.preventDefault());
['bItal','bScene','bChap'].forEach(id=>keep($(id)));
$('bItal').onclick = ()=>{ editor.focus(); document.execCommand('italic'); };
$('bScene').onclick = ()=>{
  const s=document.createElement('p'); s.className='scene'; s.textContent='* * *';
  const p=document.createElement('p'); p.innerHTML='<br>';
  insertAfterCurrent([s,p], p);
};
$('bChap').onclick = ()=>{
  const h=document.createElement('h2'); h.className='chapter empty'; h.innerHTML='<br>';
  const p=document.createElement('p'); p.innerHTML='<br>';
  insertAfterCurrent([h,p], h);
};

function loadText(md){
  editor.innerHTML = textToHTML(md, false) || '<p><br></p>';
  normalize(); markScenes(); sig=''; relayout();
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
  const now = countWords(editor.innerText);
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
  loadText(b.manuscript);
  lastSavedMd = toMarkdown(); lastSavedWords = countWords(lastSavedMd); sessionStartWords = lastSavedWords;
  dirty = false; saveError = null; lastSavedAt = null; guardOpen = false; hideAlert();
  setView(Math.floor(FM/ppv)); freeView = true;
  $('bookName').textContent = S.title;
  syncForm();
  try{ await Store.snapshot(path, b.manuscript); }catch(e){}
  lastSnapAt = Date.now(); wroteSinceSnap = false;
  config.last_book = path; saveConfig();

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
$('bkNew').onclick = async ()=>{
  try{
    await saveNow();
    const settings = {...S, title:'Untitled'};
    const path = await Store.createBook('Untitled', '# \n', JSON.stringify(settings, null, 2));
    await openBook(path);
    openPanel('setup'); $('sTitle').focus(); $('sTitle').select();
    toast('New book started. Give it a title.');
  }catch(err){ toast('Could not start a new book: '+err, true); }
};
$('bkReveal').onclick = ()=>Store.reveal(bookPath || '').catch(err=>toast(String(err), true));

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

const PANELS = ['setup','books','history','match'];
function openPanel(name){
  PANELS.forEach(p=>{ $(p).hidden = p!==name; document.querySelector(`[data-panel="${p}"]`).setAttribute('aria-pressed', String(p===name)); });
  if(name==='setup'){ syncForm(); $('copyBox').hidden=true; }
  if(name==='books') renderBooks();
  if(name==='history') renderHistory();
  if(name==='match'){ if(!$('mFace').dataset.touched) $('mFace').value = S.face; renderTemplates(); solveAndShow(); }
  if(name==='setup' && Store.desktop) Store.appVersion().then(v=>$('aboutVersion').textContent=`Galley Proof version ${v}`).catch(()=>{});
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
  const e = config.email || {};
  $('eTo').value=e.to||''; $('eUser').value=e.username||''; $('ePass').value=e.password||'';
  $('eHost').value=e.smtp_host||''; $('ePort').value=e.smtp_port||'';
}
function refreshLayout(){
  const firstPage = view*ppv;
  applyGeometry(); relayout(); setView(Math.floor(firstPage/ppv));
  if(document.fonts) document.fonts.load(`16px ${FACES[S.face].stack}`).then(()=>{ sig=''; relayout(); });
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
}
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
    + `<button class="btn" data-use="${esc(t.id)}">Use</button><button class="btn" data-del="${esc(t.id)}">Delete</button></li>`).join('')
    || '<li class="empty">None yet. Measure a book above and save it.</li>';
}
$('tplList').addEventListener('click', e=>{
  const use = e.target.closest('[data-use]'), del = e.target.closest('[data-del]');
  if(use){ const t = (config.templates||[]).find(x=>x.id===use.dataset.use); if(t){ applyTemplate(t); renderTemplates(); toast(`Using “${t.name}”.`); } }
  if(del){
    if(del.dataset.armed!=='1'){ del.dataset.armed='1'; del.textContent='Confirm'; setTimeout(()=>{ if(del.isConnected){ del.dataset.armed=''; del.textContent='Delete'; } }, 4000); return; }
    config.templates = (config.templates||[]).filter(x=>x.id!==del.dataset.del);
    saveConfig(); renderTemplates(); syncForm();
    toast('Template deleted. Books already using it keep their page settings.');
  }
});

/* ================================================================ updates */

async function checkForUpdates(manual){
  if(!Store.desktop) return;
  try{
    const u = await Store.checkUpdate();
    if(u){
      if(!$('alert').hidden && !manual) return;   // don't cover a more important message
      showAlert('update', `Galley Proof ${u.version} is ready to install (you have ${u.current}).`, 'Update and restart', installUpdate, 'Later', null);
    } else if(manual) toast('You have the latest version.');
  }catch(err){ if(manual) toast(String(err), true); }
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
    editor.innerHTML = textToHTML(String(rd.result), true) || '<p><br></p>';
    normalize(); markScenes(); sig=''; relayout(); setView(Math.floor(FM/ppv));
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

/* ================================================================ keys and focus */

document.addEventListener('keydown', e=>{
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if(mod && e.shiftKey && k==='e'){ e.preventDefault(); sendEmail(); return; }
  if(mod && !e.shiftKey && k==='s'){ e.preventDefault(); snapshotNow(true); return; }
  if(e.target.closest && e.target.closest('.panel')) { if(e.key==='Escape') closePanels(); return; }
  if(e.key==='PageDown' || (e.altKey && e.key==='ArrowRight')){ e.preventDefault(); turn(1); }
  else if(e.key==='PageUp' || (e.altKey && e.key==='ArrowLeft')){ e.preventDefault(); turn(-1); }
  else if(e.key==='Escape'){ if(PANELS.some(p=>!$(p).hidden)) closePanels(); else if(document.body.classList.contains('focus')) setFocus(false); }
});

function setFocus(on){ document.body.classList.toggle('focus', on); $('unfocus').hidden=!on; closePanels(); requestAnimationFrame(()=>{ fit(); relayout(); followCaret(); }); }
$('bFocus').onclick = ()=>setFocus(true); $('unfocus').onclick = ()=>setFocus(false);

/* ================================================================ status */

let measureCtx=null;
function wordsPerLine(){
  try{
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = `${G.fs}px ${(FACES[S.face]||FACES.garamond).stack}`;
    const sample = (editor.innerText || '').slice(0, 2000).trim() || 'The quick brown fox jumps over the lazy dog while the barometer falls.';
    const n = sample.split(/\s+/).length; const w = measureCtx.measureText(sample.replace(/\s+/g,' ')).width;
    return n ? G.T / (w/n) : 0;
  }catch(e){ return 0; }
}
function status(){
  const words = countWords(editor.innerText);
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
  if(document.fonts) document.fonts.ready.then(()=>{ sig=''; relayout(); });
  setTimeout(()=>checkForUpdates(false), 5000);
}

let rz; window.addEventListener('resize', ()=>{ clearTimeout(rz); rz=setTimeout(()=>{ const firstPage=view*ppv; fit(); sig=''; relayout(); setView(Math.floor(firstPage/ppv)); followCaret(); }, 120); });

// exposed for tests
window.GalleyProof = { toMarkdown, textToHTML, countWords, saveNow, openBook, get path(){ return bookPath; } };

boot();
})();
