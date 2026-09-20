// ============================================================
// DRUM LOOP STATION V11
// Independent Loop Station + Independent FL-style Sequencer
// ============================================================

const DEFAULT_PADS = [
  ["a","KICK","kick"],["s","SNARE","snare"],["d","SNARE","snare"],
  ["f","CLOSED HH","closed_hihat"],["g","CLOSED HH","closed_hihat"],
  ["h","OPEN HH","open_hihat"],["j","CRASH","crash"],["k","RIDE","ride"],
  ["l","CLAP","clap"],["z","CLAP","clap"],["x","HIGH TOM","tom_high"],["c","LOW TOM","tom_low"]
];

const DEFAULT_CONTROLS = {
  record:"r", play:" ", overdub:"t", stop:"escape",
  clear:"backspace", clearAll:"", metronome:"m"
};

const CONTROL_LABELS = {
  record:"RECORD", play:"PLAY / STOP", overdub:"OVERDUB",
  stop:"STOP", clear:"CLEAR SLOT", clearAll:"CLEAR ALL", metronome:"METRONOME"
};

const SAMPLE_FILES = {
  kick:"samples/kickdrum.wav", snare:"samples/snare.wav",
  closed_hihat:"samples/closed_hihat.wav", open_hihat:"samples/open_hihat.wav",
  crash:"samples/crash.wav", ride:"samples/ride.wav", clap:"samples/clap.wav",
  tom_high:"samples/tom_high.wav", tom_low:"samples/tom_low.wav"
};

const $ = id => document.getElementById(id);
function clone(v){ return typeof structuredClone==="function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }
function loadJSON(key, fallback){
  try { return JSON.parse(localStorage.getItem(key)) ?? clone(fallback); }
  catch { return clone(fallback); }
}

let padDefs = loadJSON("drumLoopPadMapping", DEFAULT_PADS).map(p=>[...p]);
let controlDefs = loadJSON("drumLoopControlMapping", DEFAULT_CONTROLS);

let audioCtx=null, master=null;
const audioBuffers={};

// ---------- AUDIO ----------
function ensureAudio(){
  if(!audioCtx){
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    master=audioCtx.createGain();
    master.gain.value=0.9;
    master.connect(audioCtx.destination);
  }
  if(audioCtx.state==="suspended") audioCtx.resume();
}
async function loadSamples(){
  ensureAudio();
  $("sampleStatus").textContent="Loading samples…";
  let loaded=0;
  for(const [name,path] of Object.entries(SAMPLE_FILES)){
    try{
      const r=await fetch(path);
      if(!r.ok) throw new Error(r.status);
      audioBuffers[name]=await audioCtx.decodeAudioData(await r.arrayBuffer());
      loaded++;
    }catch(e){ console.error("Sample load failed",path,e); }
  }
  $("sampleStatus").textContent =
    loaded===9 ? "9/9 samples loaded" : `${loaded}/9 samples loaded — check samples/`;
  if(loaded===9) $("sampleStatus").classList.add("ready");
}
function playSample(sound, when=0){
  ensureAudio();
  const b=audioBuffers[sound];
  if(!b) return;
  const s=audioCtx.createBufferSource();
  s.buffer=b;
  s.connect(master);
  s.start(when);
}
function flashPad(key){
  const el=document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if(!el) return;
  el.classList.add("active");
  setTimeout(()=>el.classList.remove("active"),70);
}

// ---------- PAD MAPPING ----------
function saveMappings(){
  localStorage.setItem("drumLoopPadMapping",JSON.stringify(padDefs));
  localStorage.setItem("drumLoopControlMapping",JSON.stringify(controlDefs));
}
function displayKey(k){
  if(!k) return "—";
  return ({ " ":"SPACE", escape:"ESC", backspace:"BACKSPACE", enter:"ENTER", tab:"TAB" }[k]||k.toUpperCase());
}
function normalizeKey(e){
  if(e.ctrlKey||e.altKey||e.metaKey) return null;
  if(e.code==="Space") return " ";
  if(e.key==="Escape") return "escape";
  if(e.key==="Backspace") return "backspace";
  if(e.key==="Enter") return "enter";
  if(e.key==="Tab") return "tab";
  return e.key.length===1 ? e.key.toLowerCase() : null;
}
function mappingInUse(key,padIndex=-1,controlName=null){
  if(!key) return false;
  if(padDefs.some((p,i)=>i!==padIndex&&p[0]===key)) return true;
  return Object.entries(controlDefs).some(([n,k])=>n!==controlName&&k===key);
}

// ---------- LOOP STATION ----------
const loopSlots=Array.from({length:9},()=>({events:[],bpm:120,bars:4}));
let loopSelected=0;
let loopPlaying=new Set();
let loopRecording=false;
let loopOverdub=false;
let loopMetronome=false;
let loopStart=0;
let loopFrame=null;
let loopPrevPos=0;
let loopNextIndex=new Map();

function loopSlot(){ return loopSlots[loopSelected]; }
function loopBeat(){ return 60/loopSlot().bpm; }
function loopLength(slot=loopSlot()){ return (60/slot.bpm)*4*slot.bars; }
function setLoopStatus(t){ $("loopStatus").textContent=t; }
function quantizeLoopTime(t){
  const q=Number($("loopQuantize").value);
  if(!q) return t;
  const grid=loopBeat()*4/q;
  return Math.round(t/grid)*grid;
}
function loopPosition(){
  if(!loopPlaying.size && !loopRecording && !loopOverdub) return loopPrevPos;
  const len=loopLength();
  return ((performance.now()/1000-loopStart)%len+len)%len;
}
function renderLoopSlots(){
  const host=$("slots"); host.innerHTML="";
  loopSlots.forEach((s,i)=>{
    const b=document.createElement("button");
    b.className="slot"+(i===loopSelected?" selected":"")+(loopPlaying.has(i)?" playing":"");
    b.innerHTML=`<span class="num">${i+1}</span><span class="slot-state">${loopPlaying.has(i)?"●":"○"}</span>`;
    b.title=`Loop slot ${i+1}`;
    b.onclick=()=>{loopSelected=i; syncLoopControls(); renderLoopSlots(); renderLoopEvents();};
    host.appendChild(b);
  });
  $("loopSlotValue").textContent=loopSelected+1;
  $("timelineSlot").textContent=loopSelected+1;
}
function syncLoopControls(){
  const s=loopSlot();
  $("loopBpm").value=s.bpm; $("loopBpmOut").value=s.bpm;
  $("loopBars").value=String(s.bars);
}
function renderLoopEvents(){
  const host=$("events"); host.innerHTML="";
  const s=loopSlot(), len=loopLength(s);
  for(const e of s.events){
    const d=document.createElement("div");
    d.className="event-dot";
    d.style.left=`${Math.min(99.8,Math.max(0,e.time/len*100))}%`;
    d.title=`${e.key.toUpperCase()} @ ${e.time.toFixed(2)}s`;
    host.appendChild(d);
  }
}
function loopStartSlot(i){
  const s=loopSlots[i];
  if(!s.events.length) return;
  loopPlaying.add(i);
  if(!loopStart) loopStart=performance.now()/1000-loopPrevPos;
  loopNextIndex.set(i,0);
  renderLoopSlots(); setLoopStatus(`PLAYING ${loopPlaying.size}`);
  if(!loopFrame) loopFrame=requestAnimationFrame(loopTick);
}
function loopStopSlot(i){
  loopPlaying.delete(i); loopNextIndex.delete(i);
  if(!loopPlaying.size && !loopRecording && !loopOverdub){
    loopStopTransport();
  }
  renderLoopSlots(); setLoopStatus(loopPlaying.size?`PLAYING ${loopPlaying.size}`:"READY");
}
function loopStartTransport(){
  stopOtherMode("loop");
  ensureAudio();
  if(loopFrame) return;
  loopStart=performance.now()/1000-loopPrevPos;
  loopPrevPos=loopPosition();
  loopFrame=requestAnimationFrame(loopTick);
}
function loopStopTransport(){
  if(loopFrame) cancelAnimationFrame(loopFrame);
  loopFrame=null; loopPrevPos=0; loopStart=0; loopNextIndex.clear();
  $("playhead").style.left="0%"; $("loopPosition").textContent=`0.00 / ${loopLength().toFixed(2)} s`;
}
function loopPlaySelected(){
  stopOtherMode("loop");
  if(loopPlaying.has(loopSelected)){ loopStopSlot(loopSelected); return; }
  if(!loopSlot().events.length) return;
  loopStartTransport(); loopStartSlot(loopSelected);
}
function loopGlobalStop(){
  loopPlaying.clear(); loopRecording=false; loopOverdub=false;
  $("record").classList.remove("recording");
  loopStopTransport(); renderLoopSlots(); setLoopStatus("READY");
}
function loopFireCrossed(i,prev,cur){
  const s=loopSlots[i], len=loopLength(s);
  if(!s.events.length) return;
  let idx=loopNextIndex.get(i)??0;
  let guard=0;
  while(guard++<s.events.length){
    const e=s.events[idx], t=e.time;
    const crossed=cur>=prev ? (t>prev&&t<=cur) : (t>prev||t<=cur);
    if(!crossed) break;
    triggerPad(e.key,true);
    idx=(idx+1)%s.events.length;
    if(idx===0) break;
  }
  loopNextIndex.set(i,idx);
}
function loopTick(){
  const now=performance.now()/1000;
  const len=loopLength();
  const cur=((now-loopStart)%len+len)%len;
  const prev=loopPrevPos;
  const wrapped=cur<prev;

  const selectedLen=loopLength();
  $("playhead").style.left=`${cur/selectedLen*100}%`;
  $("loopPosition").textContent=`${cur.toFixed(2)} / ${selectedLen.toFixed(2)} s`;

  for(const i of loopPlaying) loopFireCrossed(i,prev,cur);

  if(loopRecording||loopOverdub){
    $("recordingCue").style.left=`${cur/selectedLen*100}%`;
  }

  const beat=Math.floor(cur/loopBeat());
  if(loopMetronome && beat!==window._loopLastBeat){
    window._loopLastBeat=beat;
    playMetronome(beat%4===0);
  }
  loopPrevPos=cur;
  loopFrame=requestAnimationFrame(loopTick);
}
function playMetronome(accent=false){
  ensureAudio();
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.frequency.value=accent?1100:750; g.gain.value=0.035;
  o.connect(g);g.connect(master);o.start();o.stop(audioCtx.currentTime+0.035);
}
function beginLoopRecording(){
  ensureAudio();
  const s=loopSlot();
  s.events=[]; s.bpm=Number($("loopBpm").value); s.bars=Number($("loopBars").value);
  loopSelected=loopSelected; loopPlaying.add(loopSelected);
  loopRecording=true; loopOverdub=false;
  loopStart=performance.now()/1000; loopPrevPos=0; loopNextIndex.set(loopSelected,0);
  $("record").classList.add("recording"); setLoopStatus("RECORDING");
  loopStartTransport(); renderLoopSlots(); renderLoopEvents();
}
function finishLoopRecording(){
  const s=loopSlot(), len=loopLength(s);
  s.events.sort((a,b)=>a.time-b.time);
  s.events=s.events.map(e=>({...e,time:Math.min(Math.max(0,e.time),len-0.001)}));
  loopRecording=false; $("record").classList.remove("recording");
  loopPlaying.add(loopSelected); loopNextIndex.set(loopSelected,0);
  renderLoopEvents(); renderLoopSlots(); setLoopStatus("PLAYING");
}
function toggleLoopRecord(){ loopRecording?finishLoopRecording():beginLoopRecording(); }
function toggleLoopOverdub(){
  if(!loopSlot().events.length) return beginLoopRecording();
  ensureAudio(); loopStartTransport(); loopPlaying.add(loopSelected);
  loopOverdub=!loopOverdub;
  setLoopStatus(loopOverdub?"OVERDUB":"PLAYING");
}
function clearLoopSelected(){
  loopPlaying.delete(loopSelected); loopSlots[loopSelected].events=[];
  renderLoopEvents();renderLoopSlots();setLoopStatus("CLEARED");
}
function clearAllLoops(){
  loopPlaying.clear();
  loopSlots.forEach(s=>s.events=[]);
  loopGlobalStop(); renderLoopEvents();renderLoopSlots();setLoopStatus("ALL CLEARED");
}
function loopToggleMetronome(){
  loopMetronome=!loopMetronome;
  $("metronome").textContent=`METRONOME: ${loopMetronome?"ON":"OFF"}`;
}
function recordedLoopTime(){
  const len=loopLength();
  return quantizeLoopTime(((performance.now()/1000-loopStart)%len+len)%len);
}

// ---------- SEQUENCER: COMPLETELY SEPARATE CLOCK ----------
const SEQ_ROWS=[
  ["kick","Kick"],["snare","Snare"],["closed_hihat","Closed HH"],["open_hihat","Open HH"],
  ["crash","Crash"],["ride","Ride"],["clap","Clap"],["tom_high","High Tom"],["tom_low","Low Tom"]
];
const seqSamples=Object.fromEntries(SEQ_ROWS.map(([id])=>[id,id]));
const defaultPattern=()=>({steps:16,rows:Array.from({length:9},()=>Array(16).fill(false))});
const seqPatterns=Array.from({length:9},defaultPattern);
let seqSelected=0, seqPlaying=false, seqFrame=null, seqStart=0, seqPrevStep=-1;
let seqBpm=120, seqSteps=16, seqSwing=0, seqQuant="1/16", seqMetronome=false;
let seqMutedRows=new Set();

function seqStepSeconds(){ return 60/seqBpm/4; }
function seqLength(){ return seqSteps*seqStepSeconds(); }
function seqSetStatus(t){ $("seqStatus").textContent=t; }
function seqPattern(){ return seqPatterns[seqSelected]; }
function renderSeqSlots(){
  $("patternSlotNumber").textContent=`PATTERN ${seqSelected+1}`;
  document.querySelectorAll(".seq-slot").forEach((b,i)=>b.classList.toggle("selected",i===seqSelected));
}
function renderSequencer(){
  const grid=$("sequencerGrid"); if(!grid) return;
  const p=seqPattern();
  grid.innerHTML="";
  const corner=document.createElement("div");corner.className="seq-corner";grid.appendChild(corner);
  for(let s=0;s<seqSteps;s++){
    const h=document.createElement("div");h.className="seq-step-number";h.dataset.step=s;h.textContent=s+1;grid.appendChild(h);
  }
  SEQ_ROWS.forEach(([id,label],r)=>{
    const wrap=document.createElement("div");wrap.className="seq-row-label";
    wrap.innerHTML=`<span>${label}</span><button type="button" class="row-mute ${seqMutedRows.has(id)?"muted":""}" data-row="${id}">${seqMutedRows.has(id)?"M":"M"}</button>`;
    grid.appendChild(wrap);
    for(let s=0;s<seqSteps;s++){
      const c=document.createElement("button");c.type="button";c.className="seq-cell";
      c.dataset.step=s;c.dataset.row=r;
      if(p.rows[r][s])c.classList.add("active");
      if(s%4===0)c.classList.add("beat");
      c.onclick=()=>{
        p.rows[r][s]=!p.rows[r][s];
        if(p.rows[r][s]&&!seqMutedRows.has(id)){ensureAudio();playSample(id);}
        renderSequencer();
      };
      grid.appendChild(c);
    }
  });
  grid.querySelectorAll(".row-mute").forEach(b=>b.onclick=e=>{
    e.stopPropagation();const id=b.dataset.row;
    seqMutedRows.has(id)?seqMutedRows.delete(id):seqMutedRows.add(id);
    renderSequencer();
  });
  renderSeqSlots();updateSeqPlayhead();
}
function updateSeqPlayhead(){
  const grid=$("sequencerGrid");if(!grid)return;
  grid.querySelectorAll(".current-step").forEach(e=>e.classList.remove("current-step"));
  if(!seqPlaying)return;
  const step=Math.floor(((performance.now()/1000-seqStart)%seqLength())/seqStepSeconds());
  grid.querySelectorAll(`[data-step="${step}"]`).forEach(e=>e.classList.add("current-step"));
}
function seqPlayStep(step){
  const p=seqPattern();
  for(let r=0;r<SEQ_ROWS.length;r++){
    const id=SEQ_ROWS[r][0];
    if(p.rows[r][step]&&!seqMutedRows.has(id)){
      playSample(id);
      // Flash corresponding row visually.
      document.querySelectorAll(`.seq-cell[data-row="${r}"][data-step="${step}"]`).forEach(e=>e.classList.add("hit"));
    }
  }
  setTimeout(()=>document.querySelectorAll(`.seq-cell[data-step="${step}"].hit`).forEach(e=>e.classList.remove("hit")),70);
}
function seqTick(){
  if(!seqPlaying){seqFrame=null;return;}
  const now=performance.now()/1000;
  const elapsed=now-seqStart;
  const step=Math.floor((elapsed%seqLength())/seqStepSeconds());
  if(step!==seqPrevStep){
    seqPrevStep=step;seqPlayStep(step);
    if(seqMetronome)playMetronome(step%16===0);
  }
  updateSeqPlayhead();
  seqFrame=requestAnimationFrame(seqTick);
}
function seqStartTransport(){
  stopOtherMode("seq");
  ensureAudio();
  if(seqPlaying)return;
  seqPlaying=true;seqStart=performance.now()/1000;seqPrevStep=-1;
  seqSetStatus(`PLAYING PATTERN ${seqSelected+1}`);
  seqFrame=requestAnimationFrame(seqTick);
  renderSequencer();
}
function seqStopTransport(){
  seqPlaying=false;
  if(seqFrame)cancelAnimationFrame(seqFrame);
  seqFrame=null;seqPrevStep=-1;updateSeqPlayhead();seqSetStatus("READY");
}

function seqPlayAll(){
  stopOtherMode("seq");
  seqPlaying = true;
  seqStart = performance.now();
  seqPrevStep = -1;
  seqSetStatus("PLAYING ALL PATTERNS");
  if(seqFrame) cancelAnimationFrame(seqFrame);
  seqFrame = requestAnimationFrame(seqTick);
}
function seqStopAll(){
  seqPlaying = false;
  if(seqFrame) cancelAnimationFrame(seqFrame);
  seqFrame = null;
  seqPrevStep = -1;
  document.querySelectorAll(".seq-cell.current").forEach(el=>el.classList.remove("current"));
  seqSetStatus("STOPPED");
}

function seqTogglePlay(){seqPlaying?seqStopTransport():seqStartTransport();}
function seqClear(){
  seqPatterns[seqSelected]=defaultPattern();renderSequencer();seqSetStatus("CLEARED");
}
function seqFillHats(){
  const p=seqPattern();p.rows[2]=Array(seqSteps).fill(false);
  for(let i=0;i<seqSteps;i+=2)p.rows[2][i]=true;
  renderSequencer();
}
function seqRandomize(){
  const p=seqPattern();
  for(let r=0;r<9;r++)for(let s=0;s<seqSteps;s++)
    p.rows[r][s]=Math.random()<([.12,.16,.55,.08,.035,.10,.12,.06,.06][r]);
  renderSequencer();
}
function seqSelect(n){
  stopOtherMode("seq");
  seqSelected=n;renderSequencer();
  if(!seqPlaying)seqStartTransport();
  seqSetStatus(`PLAYING PATTERN ${n+1}`);
}
function seqClearSlot(n){
  seqPatterns[n]=defaultPattern();
  if(seqSelected===n)renderSequencer();
}

// ---------- PAD INPUT ----------
const lastLiveHitAt=new Map(),heldKeys=new Set();
const LIVE_HIT_GUARD_MS=80;

function triggerPad(key,fromPlayback=false){
  const pad=padDefs.find(p=>p[0]===key);if(!pad)return;
  if(!fromPlayback){
    const now=performance.now(),last=lastLiveHitAt.get(key)??-Infinity;
    if(now-last<LIVE_HIT_GUARD_MS)return;
    lastLiveHitAt.set(key,now);
  }
  playSample(pad[2]);flashPad(key);
  if(!fromPlayback&&(loopRecording||loopOverdub)){
    const s=loopSlot(),t=recordedLoopTime(),last=s.events[s.events.length-1];
    if(last&&last.key===key&&Math.abs(last.time-t)<.08)return;
    s.events.push({time:t,key,sound:pad[2]});s.events.sort((a,b)=>a.time-b.time);renderLoopEvents();
  }
}

// ---------- CONTROLS ----------
function runControl(name){
  switch(name){
    case "record":toggleLoopRecord();break;
    case "play":loopPlaySelected();break;
    case "overdub":toggleLoopOverdub();break;
    case "stop":loopGlobalStop();break;
    case "clear":clearLoopSelected();break;
    case "clearAll":clearAllLoops();break;
    case "metronome":loopToggleMetronome();break;
  }
}
function updateControlBadges(){
  document.querySelectorAll("[data-control]").forEach(el=>{
    el.textContent=`[ ${displayKey(controlDefs[el.dataset.control])} ]`;
  });
}

// ---------- MAPPING WINDOW ----------
function createMappingRow(container,label,current,onMap,onRemove){
  const row=document.createElement("div");row.className="mapping-row";
  row.innerHTML=`<span>${label}</span><code>${displayKey(current)}</code>`;
  const map=document.createElement("button");map.type="button";map.textContent="MAP";
  const rem=document.createElement("button");rem.type="button";rem.textContent="REMOVE";
  map.onclick=()=>{window._mappingTarget=onMap;row.classList.add("waiting");setTimeout(()=>row.classList.remove("waiting"),1500);};
  rem.onclick=()=>onRemove();
  row.append(map,rem);container.appendChild(row);
}
function renderMapping(){
  const p=$("mappingPads"),c=$("mappingControls");p.innerHTML="";c.innerHTML="";
  padDefs.forEach((pad,i)=>createMappingRow(p,`${i+1}. ${pad[1]}`,pad[0],key=>{
    if(!mappingInUse(key,i,null)){padDefs[i][0]=key;saveMappings();renderPads();renderMapping();}
  },()=>{padDefs[i][0]="";saveMappings();renderPads();renderMapping();}));
  Object.keys(CONTROL_LABELS).forEach(name=>createMappingRow(c,CONTROL_LABELS[name],controlDefs[name],key=>{
    if(!mappingInUse(key,-1,name)){controlDefs[name]=key;saveMappings();updateControlBadges();renderMapping();}
  },()=>{controlDefs[name]="";saveMappings();updateControlBadges();renderMapping();}));
}
function openMapping(){renderMapping();$("mappingOverlay").classList.add("open");$("mappingOverlay").ariaHidden="false";}
function closeMapping(){window._mappingTarget=null;$("mappingOverlay").classList.remove("open");$("mappingOverlay").ariaHidden="true";}

// ---------- RENDER PADS ----------
function renderPads(){
  $("pads").innerHTML="";
  padDefs.forEach(([key,name,sound])=>{
    const b=document.createElement("button");b.className="pad";b.dataset.key=key||"";
    b.innerHTML=`<span class="pad-key">${displayKey(key)}</span><span>${name}</span>`;
    b.onclick=()=>{ensureAudio();triggerPad(key,false);};
    $("pads").appendChild(b);
  });
}

// ---------- INIT ----------
function init(){
  renderPads();renderLoopSlots();syncLoopControls();renderLoopEvents();renderSequencer();
  updateControlBadges();

      const old=p.rows;
      p.steps=seqSteps;
      p.rows=Array.from({length:9},(_,r)=>Array.from({length:seqSteps},(_,s)=>old[r]?.[s]||false));
    });
    renderSequencer();
  };
  $("seqSwing").oninput=e=>{seqSwing=Number(e.target.value);$("seqSwingOut").value=`${seqSwing}%`;};
  $("seqPlay").onclick=seqTogglePlay;
  $("seqStop").onclick=seqStopTransport;
  $("seqClear").onclick=seqClear;
  $("seqFill").onclick=seqFillHats;
  $("seqRandom").onclick=seqRandomize;
  $("seqMetronome").onclick=()=>{seqMetronome=!seqMetronome;$("seqMetronome").textContent=`METRONOME: ${seqMetronome?"ON":"OFF"}`;};

  for(let i=0;i<9;i++){
    const b=document.createElement("button");b.type="button";b.className="seq-slot";b.textContent=i+1;
    b.onclick=()=>seqSelect(i);$("seqSlots").appendChild(b);
  }

  $("openMapping").onclick=openMapping;
  $("closeMapping").onclick=closeMapping;$("closeMappingBottom").onclick=closeMapping;
  $("clearAllMappings").onclick=()=>{padDefs.forEach(p=>p[0]="");Object.keys(controlDefs).forEach(k=>controlDefs[k]="");saveMappings();renderPads();updateControlBadges();renderMapping();};
  $("resetMapping").onclick=()=>{padDefs=clone(DEFAULT_PADS);controlDefs=clone(DEFAULT_CONTROLS);saveMappings();renderPads();updateControlBadges();renderMapping();};

  $("loopTab").onclick=()=>switchMode("loop");
  $("seqTab").onclick=()=>switchMode("seq");
  switchMode("loop");
  loadSamples();
}
function switchMode(mode){
  stopOtherMode(mode);
  const seq=mode==="seq";
  $("loopPane").hidden=seq;$("seqPane").hidden=!seq;
  $("loopTab").classList.toggle("active",!seq);$("seqTab").classList.toggle("active",seq);
  $("loopTab").setAttribute("aria-selected",String(!seq));$("seqTab").setAttribute("aria-selected",String(seq));
  if(seq)renderSequencer();
}

// Keyboard mapping + slot/pattern hotkeys.
document.addEventListener("keydown",e=>{
  if(e.target.matches("input,select,textarea"))return;

  const key=normalizeKey(e);if(!key)return;

  if($("mappingOverlay").classList.contains("open")){
    if(window._mappingTarget&&key){
      if(!mappingInUse(key,-1,null)){window._mappingTarget(key);window._mappingTarget=null;}
      e.preventDefault();return;
    }
    if(key==="escape"){closeMapping();e.preventDefault();}
    return;
  }

  if(e.repeat)return;
  if(heldKeys.has(key))return;
  heldKeys.add(key);

  // Number keys are mode-specific.
  if(/^[1-9]$/.test(e.key)){
    const n=Number(e.key);
    if($("seqPane").hidden===false){
      if(e.shiftKey)seqClearSlot(n-1);else seqSelect(n-1);
    }else{
      if(e.shiftKey){loopSelected=n-1;clearLoopSelected();}
      else {loopSelected=n-1;syncLoopControls();renderLoopSlots();renderLoopEvents();}
    }
    e.preventDefault();return;
  }

  const pad=padDefs.find(p=>p[0]===key);
  if(pad){triggerPad(key,false);e.preventDefault();return;}

  const control=Object.entries(controlDefs).find(([,mapped])=>mapped===key)?.[0];
  if(control){runControl(control);e.preventDefault();}
});
document.addEventListener("keyup",e=>{const k=normalizeKey(e);if(k)heldKeys.delete(k);});
window.addEventListener("blur",()=>heldKeys.clear());

window.addEventListener("DOMContentLoaded",init);
