'use strict';
const $ = id => document.getElementById(id);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || a));

/* ---------- Samples & pads ---------- */
const ROWS = [['kick','Kick','kickdrum'],['snare','Snare','snare'],['closed_hihat','Closed HH','closed_hihat'],['open_hihat','Open HH','open_hihat'],['crash','Crash','crash'],['ride','Ride','ride'],['clap','Clap','clap'],['tom_high','High Tom','tom_high'],['tom_low','Low Tom','tom_low']];
const PADS = [0,1,1,2,2,3,4,5,6,6,7,8]; // pad index -> ROWS index
const DEF_PAD = {a:0,s:1,d:2,f:3,g:4,h:5,j:6,k:7,l:8,z:9,x:10,c:11};
const DEF_CTL = {r:'record',' ':'playstop',t:'overdub',Escape:'stop',Backspace:'clearSel',m:'metro'};
const CTLS = [['record','Record'],['playstop','Play / Stop'],['overdub','Overdub'],['stop','Stop'],['clearSel','Clear selected slot'],['clearAll','Clear all'],['metro','Metronome']];
const QS = ['OFF','1/4','1/8','1/16','1/32'];
const KP = 'drumLoopPadMapping', KC = 'drumLoopControlMapping';
const readMap = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || { ...d }; } catch { return { ...d }; } };
const padMap = readMap(KP, DEF_PAD), ctlMap = readMap(KC, DEF_CTL);
const saveMaps = () => { try { localStorage.setItem(KP, JSON.stringify(padMap)); localStorage.setItem(KC, JSON.stringify(ctlMap)); } catch {} };

/* ---------- Audio ---------- */
const ctx = new (window.AudioContext || window.webkitAudioContext)();
const buf = {};
async function loadAll() {
  await Promise.all(ROWS.map(async ([n, , f]) => {
    const url = `samples/${f}.wav`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      buf[n] = await ctx.decodeAudioData(await r.arrayBuffer());
    } catch (e) { console.warn('Could not load sample:', url, e); }
  }));
}
const wake = () => { if (ctx.state === 'suspended') ctx.resume(); };
addEventListener('pointerdown', wake); addEventListener('keydown', wake);

const lastLive = {};
function playSample(name, fromPlayback = false, when = 0) {
  const b = buf[name];
  if (!b) return false;
  if (!fromPlayback) { // live input only: duplicate guard
    const t = performance.now();
    if (t - (lastLive[name] || 0) < 80) return false;
    lastLive[name] = t;
  }
  const s = ctx.createBufferSource();
  s.buffer = b; s.connect(ctx.destination); s.start(when);
  return true;
}
function click(when, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1500 : 1000;
  g.gain.setValueAtTime(.3, when); g.gain.exponentialRampToValueAtTime(.001, when + .05);
  o.connect(g); g.connect(ctx.destination); o.start(when); o.stop(when + .06);
}

/* ---------- State (kept separate per instrument) ---------- */
let mode = 'loop';
const L = { slots: Array.from({length: 9}, () => ({events: [], bpm: 120, bars: 4})), sel: 0, playing: false, rec: false, over: false, metro: false, bpm: 120, bars: 4, q: 'OFF', start: 0, frame: 0, prev: 0, beat: -1 };
const S = { pats: Array.from({length: 9}, () => ROWS.map(() => Array(32).fill(false))), sel: 0, playing: false, bpm: 120, steps: 16, swing: 0, q: '1/16', metro: false, muted: ROWS.map(() => false), step: 0, next: 0, timer: 0, frame: 0, queue: [], arr: false, nextBeat: 0, beatN: 0, shown: -1 };

function stopOtherMode(m) { if (m === 'loop') seqStopTransport(); else loopGlobalStop(); }

/* ---------- Loop Station ---------- */
const slot = () => L.slots[L.sel];
const loopDur = () => L.bars * 4 * 60 / L.bpm;
function snap(t, bpm, q, d) {
  if (q === 'OFF') return t;
  const g = 60 / bpm * 4 / parseInt(q.slice(2), 10), r = Math.round(t / g) * g;
  return r >= d ? 0 : r;
}
function loopStartTransport() {
  stopOtherMode('loop');
  if (L.playing) return;
  wake(); L.playing = true; L.start = ctx.currentTime; L.prev = 0; L.beat = -1;
  L.frame = requestAnimationFrame(loopTick); refresh();
}
function loopGlobalStop() {
  cancelAnimationFrame(L.frame);
  L.playing = L.rec = L.over = false;
  $('loopHead').style.left = '0%'; $('loopPos').textContent = '0.00 / ' + loopDur().toFixed(2) + ' s';
  refresh();
}
function fire(a, b) { slot().events.forEach(e => { if (e.time > a && e.time <= b) playSample(e.pad, true); }); }
function loopTick() {
  if (!L.playing) return;
  const d = loopDur(), el_ = ctx.currentTime - L.start;
  if (L.rec && !L.over && el_ >= d) { L.rec = false; refresh(); }
  const pos = el_ % d;
  if (pos >= L.prev) fire(L.prev, pos); else { fire(L.prev, d + 1); fire(-1, pos); }
  L.prev = pos;
  const bi = Math.floor(el_ / (60 / L.bpm));
  if (bi !== L.beat) { L.beat = bi; if (L.metro) click(ctx.currentTime, bi % 4 === 0); }
  $('loopHead').style.left = (pos / d * 100) + '%';
  $('loopPos').textContent = pos.toFixed(2) + ' / ' + d.toFixed(2) + ' s';
  L.frame = requestAnimationFrame(loopTick);
}
function loopRecord() {
  if (mode !== 'loop') return;
  if (L.rec) { L.rec = L.over = false; refresh(); return; }
  loopGlobalStop(); slot().events = []; L.rec = true; loopStartTransport();
}
function loopOverdub() {
  if (mode !== 'loop') return;
  if (!slot().events.length && !L.rec) return loopRecord();
  if (!L.playing) loopStartTransport();
  L.over = !L.over; L.rec = L.over; refresh();
}
function loopPlayStop() {
  if (mode !== 'loop') return;
  if (L.playing) loopGlobalStop(); else if (slot().events.length) loopStartTransport();
}
function loopClear(i) { L.slots[i].events = []; if (i === L.sel && L.rec) L.rec = L.over = false; refresh(); }
function loopClearAll() { L.slots.forEach(s => s.events = []); L.rec = L.over = false; refresh(); }
function loopSelect(i) {
  L.sel = i; L.bpm = slot().bpm; L.bars = slot().bars; L.rec = L.over = false; L.prev = 0; refresh();
}
function recordEvent(pad) {
  const d = loopDur(), t = snap((ctx.currentTime - L.start) % d, L.bpm, L.q, d);
  slot().events.push({ time: t, pad }); drawTl();
}
function drawTl() {
  const tl = $('loopTl'); tl.querySelectorAll('.dot').forEach(d => d.remove());
  const d = loopDur();
  slot().events.forEach(e => {
    const dot = el('div', 'dot'); dot.style.left = (e.time / d * 100) + '%';
    dot.style.top = ((ROWS.findIndex(r => r[0] === e.pad) + .5) / 9 * 100) + '%'; tl.appendChild(dot);
  });
}

/* ---------- Sequencer ---------- */
const seqDivision = () => S.q === 'OFF' ? 16 : parseInt(S.q.slice(2), 10);
const patEmpty = p => !p.some(r => r.slice(0, S.steps).some(Boolean));
function seqStartTransport(all) {
  stopOtherMode('seq');
  if (all) S.arr = true;
  if (S.playing) return;
  wake(); S.playing = true; S.next = S.nextBeat = ctx.currentTime + .05; S.beatN = 0; S.queue = [];
  S.timer = setInterval(seqSched, 25); S.frame = requestAnimationFrame(seqDraw); refresh();
}
function seqPause() { clearInterval(S.timer); cancelAnimationFrame(S.frame); S.playing = false; refresh(); }
function seqStopTransport() {
  clearInterval(S.timer); cancelAnimationFrame(S.frame);
  S.playing = false; S.arr = false; S.step = 0; S.queue = []; S.shown = -1;
  document.querySelectorAll('.cell.cur').forEach(c => c.classList.remove('cur'));
  refresh();
}
function seqPlayPause() { if (mode !== 'seq') return; if (S.playing) seqPause(); else seqStartTransport(false); }
function seqPlayAll() {
  if (mode !== 'seq') return;
  if (!S.playing) { const f = S.pats.findIndex(p => !patEmpty(p)); S.sel = f < 0 ? 0 : f; S.step = 0; renderGrid(); }
  seqStartTransport(true);
}
function nextPattern() {
  for (let k = 1; k <= 9; k++) { const i = (S.sel + k) % 9; if (!patEmpty(S.pats[i])) { S.sel = i; renderGrid(); refresh(); return; } }
}
function seqSched() {
  const sd = 60 / S.bpm * 4 / seqDivision(), horizon = ctx.currentTime + .12;
  while (S.next < horizon) {
    const p = S.pats[S.sel], t = S.next + (S.step % 2 ? S.swing / 100 * sd : 0);
    ROWS.forEach((r, i) => { if (p[i][S.step] && !S.muted[i]) playSample(r[0], true, t); });
    S.queue.push({ t, step: S.step });
    S.next += sd; S.step++;
    if (S.step >= S.steps) { S.step = 0; if (S.arr) nextPattern(); }
  }
  while (S.nextBeat < horizon) { if (S.metro) click(S.nextBeat, S.beatN % 4 === 0); S.nextBeat += 60 / S.bpm; S.beatN++; }
}
function seqDraw() {
  if (!S.playing) return;
  while (S.queue.length > 1 && S.queue[1].t <= ctx.currentTime) S.queue.shift();
  const q = S.queue[0];
  if (q && q.t <= ctx.currentTime && q.step !== S.shown) {
    S.shown = q.step;
    document.querySelectorAll('.cell.cur').forEach(c => c.classList.remove('cur'));
    document.querySelectorAll(`.cell[data-s="${q.step}"]`).forEach(c => c.classList.add('cur'));
  }
  S.frame = requestAnimationFrame(seqDraw);
}
function seqSelect(i) { S.sel = i; S.step = 0; S.queue = []; renderGrid(); refresh(); }
function seqClear(i) { S.pats[i].forEach(r => r.fill(false)); if (i === S.sel) renderGrid(); }
function renderGrid() {
  const g = $('grid'); g.style.setProperty('--n', S.steps); g.innerHTML = ''; S.shown = -1;
  const p = S.pats[S.sel];
  ROWS.forEach((r, i) => {
    const m = el('button', 'mute' + (S.muted[i] ? ' on' : ''), r[1]);
    m.title = 'Mute row'; m.onclick = () => { S.muted[i] = !S.muted[i]; m.classList.toggle('on'); };
    g.appendChild(m);
    for (let s = 0; s < S.steps; s++) {
      const c = el('button', 'cell' + (p[i][s] ? ' on' : '') + (s % 4 === 0 ? ' b' : ''));
      c.dataset.s = s;
      c.onclick = () => { p[i][s] = !p[i][s]; c.classList.toggle('on'); if (p[i][s]) playSample(r[0]); };
      g.appendChild(c);
    }
  });
}

/* ---------- UI refresh ---------- */
function refresh() {
  $('loopSlots').querySelectorAll('button').forEach((b, i) => {
    b.className = (i === L.sel ? 'sel ' : '') + (L.slots[i].events.length ? 'full ' : '') + (L.playing && i === L.sel ? 'play' : '');
  });
  $('seqSlots').querySelectorAll('button').forEach((b, i) => {
    b.className = (i === S.sel ? 'sel ' : '') + (!patEmpty(S.pats[i]) ? 'full ' : '') + (S.playing && i === S.sel ? 'play' : '');
  });
  $('lBpm').value = L.bpm; $('lBars').value = L.bars; $('lQ').value = L.q;
  $('lRec').classList.toggle('on', L.rec && !L.over); $('lOver').classList.toggle('on', L.over);
  $('lPlay').classList.toggle('on', L.playing && !L.rec); $('lMet').classList.toggle('on', L.metro);
  $('loopHead').classList.toggle('rec', L.rec);
  $('sBpm').value = S.bpm; $('sSteps').value = S.steps; $('sSwing').value = S.swing; $('sQ').value = S.q;
  $('sPlay').classList.toggle('on', S.playing); $('sMet').classList.toggle('on', S.metro);
  drawTl(); refreshPads();
}
function refreshPads() {
  document.querySelectorAll('.pad').forEach((b, i) => {
    const ks = Object.keys(padMap).filter(k => padMap[k] === i).map(k => k === ' ' ? 'Space' : k.toUpperCase());
    b.querySelector('small').textContent = ks.join(' ') || '—';
  });
}
function setMode(m) {
  if (m === mode) return;
  stopOtherMode(m); mode = m;
  $('loopPanel').hidden = m !== 'loop'; $('seqPanel').hidden = m !== 'seq';
  $('tabLoop').classList.toggle('on', m === 'loop'); $('tabSeq').classList.toggle('on', m === 'seq');
  if (m === 'seq') renderGrid();
  refresh();
}

/* ---------- Pads ---------- */
function hitPad(i) {
  wake();
  const name = ROWS[PADS[i]][0], b = $('pads').children[i];
  b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 100);
  if (playSample(name) && mode === 'loop' && L.rec && L.playing) recordEvent(name);
}

/* ---------- Controls ---------- */
function runControl(c) {
  const loop = { record: loopRecord, playstop: loopPlayStop, overdub: loopOverdub, stop: loopGlobalStop, clearSel: () => loopClear(L.sel), clearAll: loopClearAll, metro: () => { L.metro = !L.metro; refresh(); } };
  const seq = { playstop: seqPlayPause, stop: seqStopTransport, clearSel: () => seqClear(S.sel), clearAll: () => S.pats.forEach((_, i) => seqClear(i)), metro: () => { S.metro = !S.metro; refresh(); } };
  const f = (mode === 'loop' ? loop : seq)[c]; if (f) f();
}

/* ---------- Keyboard ---------- */
const held = new Set(); let capture = null;
const normKey = e => e.key.length === 1 ? e.key.toLowerCase() : e.key;
addEventListener('blur', () => held.clear());
addEventListener('keyup', e => held.delete(e.code));
addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  if (e.repeat) { if (capture || padMap[normKey(e)] !== undefined || ctlMap[normKey(e)]) e.preventDefault(); return; }
  const k = normKey(e);
  if (capture) { // 1. mapping capture
    e.preventDefault();
    if (/^[1-9]$/.test(k) || e.code.startsWith('Digit')) return;
    delete padMap[k]; delete ctlMap[k];
    capture.map[k] = capture.id; capture = null; saveMaps(); renderMap(); return;
  }
  if (!$('modal').hidden) return;
  if (held.has(e.code)) return;
  held.add(e.code);
  if (/^Digit[1-9]$/.test(e.code)) { // 2. number keys
    e.preventDefault(); const i = +e.code[5] - 1;
    if (mode === 'loop') { if (e.shiftKey) loopClear(i); else loopSelect(i); }
    else if (e.shiftKey) seqClear(i);
    else { seqSelect(i); seqStartTransport(false); }
    return;
  }
  if (ctlMap[k]) { e.preventDefault(); runControl(ctlMap[k]); return; } // 3. controls
  if (padMap[k] !== undefined) { e.preventDefault(); hitPad(padMap[k]); } // 4. pads
});

/* ---------- Mapping modal ---------- */
function renderMap() {
  const b = $('mapBody'); b.innerHTML = '';
  const sec = (title, items, map) => {
    b.appendChild(el('h3', '', title));
    items.forEach(([id, label]) => {
      const r = el('div', 'mrow'); r.appendChild(el('span', '', label));
      Object.keys(map).filter(k => map[k] === id).forEach(k => {
        const c = el('button', 'chip', (k === ' ' ? 'Space' : k) + ' ×'); c.title = 'Remove this mapping';
        c.onclick = () => { delete map[k]; saveMaps(); renderMap(); }; r.appendChild(c);
      });
      const a = el('button', '', capture && capture.id === id && capture.map === map ? 'Press a key…' : 'Map key');
      a.onclick = () => { capture = { id, map }; renderMap(); }; r.appendChild(a); b.appendChild(r);
    });
  };
  sec('PAD MAPPINGS', PADS.map((r, i) => [i, `Pad ${i + 1}: ${ROWS[r][1]}`]), padMap);
  sec('LOOP CONTROL MAPPINGS', CTLS, ctlMap);
  refreshPads();
}
const clearObj = o => Object.keys(o).forEach(k => delete o[k]);
$('mapBtn').onclick = () => { capture = null; renderMap(); $('modal').hidden = false; };
$('mapClose').onclick = () => { capture = null; $('modal').hidden = true; };
$('mapNone').onclick = () => { clearObj(padMap); clearObj(ctlMap); saveMaps(); renderMap(); };
$('mapDef').onclick = () => { clearObj(padMap); clearObj(ctlMap); Object.assign(padMap, DEF_PAD); Object.assign(ctlMap, DEF_CTL); saveMaps(); renderMap(); };

/* ---------- Build UI & wire events ---------- */
const fill = (id, opts) => opts.forEach(o => { const x = el('option', '', o); x.value = o; $(id).appendChild(x); });
fill('lBars', [1, 2, 4, 8]); fill('lQ', QS); fill('sSteps', [16, 32]); fill('sQ', QS);
for (let i = 0; i < 9; i++) {
  const lb = el('button', '', i + 1); lb.onclick = () => loopSelect(i); $('loopSlots').appendChild(lb);
  const sb = el('button', '', i + 1); sb.onclick = () => { seqSelect(i); }; $('seqSlots').appendChild(sb);
}
PADS.forEach((r, i) => {
  const p = el('button', 'pad'); p.appendChild(el('span', '', ROWS[r][1])); p.appendChild(el('small', ''));
  p.onpointerdown = e => { e.preventDefault(); hitPad(i); }; $('pads').appendChild(p);
});
$('tabLoop').onclick = () => setMode('loop'); $('tabSeq').onclick = () => setMode('seq');

$('lRec').onclick = loopRecord; $('lPlay').onclick = loopPlayStop; $('lOver').onclick = loopOverdub; $('lStop').onclick = loopGlobalStop;
$('lClr').onclick = () => loopClear(L.sel); $('lClrAll').onclick = loopClearAll;
$('lMet').onclick = () => { L.metro = !L.metro; refresh(); };
$('lBpm').onchange = e => {
  const v = clamp(e.target.value, 60, 180), old = slot().bpm;
  slot().events.forEach(ev => ev.time *= old / v);
  slot().bpm = L.bpm = v; L.start = ctx.currentTime; L.prev = 0; refresh();
};
$('lBars').onchange = e => { slot().bars = L.bars = +e.target.value; slot().events = slot().events.filter(ev => ev.time < loopDur()); L.start = ctx.currentTime; L.prev = 0; refresh(); };
$('lQ').onchange = e => { L.q = e.target.value; };

$('sPlay').onclick = seqPlayPause; $('sPlayAll').onclick = seqPlayAll; $('sStopAll').onclick = seqStopTransport;
$('sMet').onclick = () => { S.metro = !S.metro; refresh(); };
$('sBpm').onchange = e => { S.bpm = clamp(e.target.value, 60, 200); refresh(); };
$('sSteps').onchange = e => { S.steps = +e.target.value; if (S.step >= S.steps) S.step = 0; renderGrid(); refresh(); };
$('sSwing').oninput = e => { S.swing = +e.target.value; };
$('sQ').onchange = e => { S.q = e.target.value; };
$('sClr').onclick = () => seqClear(S.sel);
$('sFill').onclick = () => { for (let s = 0; s < 32; s++) S.pats[S.sel][2][s] = s % 2 === 0; renderGrid(); refresh(); };
$('sRand').onclick = () => { S.pats[S.sel].forEach((r, i) => { for (let s = 0; s < 32; s++) r[s] = Math.random() < (i < 3 ? .2 : .08); }); renderGrid(); refresh(); };

refresh();
loadAll();
