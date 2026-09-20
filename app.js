// ============================================================
// DRUM LOOP STATION V4
// Real samples + 9 loop slots + fully customizable pad/control keys
// ============================================================

const DEFAULT_PADS = [
  ["a","KICK","kick"],["s","SNARE","snare"],["d","SNARE","snare"],
  ["f","CLOSED HH","closed_hihat"],["g","CLOSED HH","closed_hihat"],
  ["h","OPEN HH","open_hihat"],["j","CRASH","crash"],["k","RIDE","ride"],
  ["l","CLAP","clap"],["z","CLAP","clap"],["x","HIGH TOM","tom_high"],["c","LOW TOM","tom_low"]
];

const DEFAULT_CONTROLS = {
  record: "r",
  play: " ",
  overdub: "t",
  stop: "escape",
  clear: "backspace",
  clearAll: "",
  metronome: "m"
};

const CONTROL_LABELS = {
  record:"RECORD",
  play:"PLAY / STOP",
  overdub:"OVERDUB",
  stop:"STOP",
  clear:"CLEAR SLOT",
  clearAll:"CLEAR ALL",
  metronome:"METRONOME"
};

const SAMPLE_FILES = {
  kick:"samples/kickdrum.wav",
  snare:"samples/snare.wav",
  closed_hihat:"samples/closed_hihat.wav",
  open_hihat:"samples/open_hihat.wav",
  crash:"samples/crash.wav",
  ride:"samples/ride.wav",
  clap:"samples/clap.wav",
  tom_high:"samples/tom_high.wav",
  tom_low:"samples/tom_low.wav"
};

const $ = id => document.getElementById(id);

const padsEl = $("pads");
const slotsEl = $("slots");
const eventsEl = $("events");
const playheadEl = $("playhead");
const statusEl = $("status");
const positionEl = $("position");
const sampleStatus = $("sampleStatus");
const bpmEl = $("bpm");
const barsEl = $("bars");
const quantizeEl = $("quantize");
const mappingOverlay = $("mappingOverlay");

let padDefs = loadJSON("drumLoopPadMapping", DEFAULT_PADS).map(p => [...p]);
let controlDefs = loadJSON("drumLoopControlMapping", DEFAULT_CONTROLS);

let audioCtx = null;
let master = null;
const audioBuffers = {};

let slots = Array.from({length:9}, () => ({
  events: [], bpm:120, bars:4
}));

// FL-style step sequencer patterns. Each of the 9 numbered slots stores
// one pattern independently from the loop-station event loop.
const SEQUENCER_STEPS = 16;
const sequencerRows = [
  "kick", "snare", "closed_hihat", "open_hihat",
  "crash", "ride", "clap", "tom_high", "tom_low"
];

let sequencerMode = false;
let currentPatternSlot = 1;
let patterns = Array.from({length:9}, () => ({
  steps: Array.from({length:9}, () => Array(SEQUENCER_STEPS).fill(false)),
  length: SEQUENCER_STEPS
}));

let selectedSlot = 0;
let playing = false;
let recording = false;
let overdubbing = false;
let metronome = false;
let loopStart = 0;
let animationId = null;
let lastBeat = -1;

// Multiple slots may play simultaneously. Each slot has its own playback clock.
const playingSlots = new Set();
const slotPlaybackStart = new Map();
let previousElapsed = null;

function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function saveMappings() {
  localStorage.setItem("drumLoopPadMapping", JSON.stringify(padDefs));
  localStorage.setItem("drumLoopControlMapping", JSON.stringify(controlDefs));
}

function currentLoop() { return slots[selectedSlot]; }

function loopLength() {
  return (60 / currentLoop().bpm) * 4 * currentLoop().bars;
}

function beatLength() {
  return 60 / currentLoop().bpm;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function displayKey(key) {
  if (!key) return "—";
  if (key === " ") return "SPACE";
  if (key === "escape") return "ESC";
  if (key === "backspace") return "BACKSPACE";
  if (key === "enter") return "ENTER";
  if (key === "tab") return "TAB";
  return key.toUpperCase();
}

function normalizeKey(event) {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.code === "Space") return " ";
  if (event.key === "Escape") return "escape";
  if (event.key === "Backspace") return "backspace";
  if (event.key === "Enter") return "enter";
  if (event.key === "Tab") return "tab";
  if (event.key.length === 1) return event.key.toLowerCase();
  return null;
}

function mappingInUse(key, padIndex = -1, controlName = null) {
  if (!key) return false;

  if (padDefs.some((pad, i) => i !== padIndex && pad[0] === key)) {
    return true;
  }

  return Object.entries(controlDefs).some(
    ([name, mapped]) => name !== controlName && mapped === key
  );
}

// ---------------- AUDIO ----------------

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    master = audioCtx.createGain();
    master.gain.value = 0.9;
    master.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

async function loadSamples() {
  ensureAudio();
  sampleStatus.textContent = "Loading samples...";
  let loaded = 0;

  for (const [name, path] of Object.entries(SAMPLE_FILES)) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      audioBuffers[name] = await audioCtx.decodeAudioData(data);
      loaded++;
    } catch (error) {
      console.error("Could not load sample:", path, error);
    }
  }

  if (loaded === Object.keys(SAMPLE_FILES).length) {
    sampleStatus.textContent = `${loaded}/${loaded} samples loaded`;
    sampleStatus.classList.add("ready");
  } else {
    sampleStatus.textContent =
      `${loaded}/${Object.keys(SAMPLE_FILES).length} samples loaded — check samples/ filenames`;
  }
}

function playSample(sound) {
  ensureAudio();
  const buffer = audioBuffers[sound];
  if (!buffer) return;

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(master);
  source.start();
}

function flashPad(key) {
  const element = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (!element) return;
  element.classList.add("active");
  setTimeout(() => element.classList.remove("active"), 80);
}

// ---------------- PAD + LOOP EVENTS ----------------

function quantizeTime(time) {
  const q = Number(quantizeEl.value);
  if (!q) return time;
  const step = beatLength() * 4 / q;
  return Math.round(time / step) * step;
}

// Prevent accidental duplicate live hits caused by repeated/duplicate
// input events from the browser or pointing device. Playback is never debounced.
const LIVE_HIT_GUARD_MS = 80;
const lastLiveHitAt = new Map();

function triggerPad(key, fromPlayback = false) {
  const pad = padDefs.find(p => p[0] === key);
  if (!pad) return;

  if (!fromPlayback) {
    const nowMs = performance.now();
    const previousMs = lastLiveHitAt.get(key) ?? -Infinity;

    if (nowMs - previousMs < LIVE_HIT_GUARD_MS) {
      return;
    }

    lastLiveHitAt.set(key, nowMs);
  }

  playSample(pad[2]);
  flashPad(key);

  if (!fromPlayback && (recording || overdubbing)) {
    const padEventTime = quantizeTime(recordedHitTime());
    const events = currentLoop().events;
    const last = events[events.length - 1];

    // Ignore an identical event arriving essentially at the same timestamp.
    if (last && last.key === key && Math.abs(last.time - padEventTime) < 0.08) {
      return;
    }

    events.push({
      time: padEventTime,
      sound: pad[2],
      key
    });

    events.sort((a, b) => a.time - b.time);
    renderEvents();
  }
}


// ---------------- SEQUENCER MODE ----------------

const SAMPLE_BY_ROW = {
  kick: "kickdrum",
  snare: "snare",
  closed_hihat: "closed_hihat",
  open_hihat: "open_hihat",
  crash: "crash",
  ride: "ride",
  clap: "clap",
  tom_high: "tom_high",
  tom_low: "tom_low"
};

const ROW_LABELS = {
  kick:"Kick", snare:"Snare", closed_hihat:"Closed HH", open_hihat:"Open HH",
  crash:"Crash", ride:"Ride", clap:"Clap", tom_high:"High Tom", tom_low:"Low Tom"
};

function ensureSequencerPanel() {
  let panel = document.getElementById("sequencerPanel");
  if (panel) return panel;

  panel = document.createElement("section");
  panel.id = "sequencerPanel";
  panel.className = "sequencer-panel";
  panel.innerHTML = `
    <div class="sequencer-head">
      <div>
        <strong>STEP SEQUENCER</strong>
        <span id="patternSlotLabel">PATTERN 1</span>
      </div>
      <div class="sequencer-actions">
        <button type="button" id="seqClear">CLEAR PATTERN</button>
        <button type="button" id="seqFill">FILL HH</button>
      </div>
    </div>
    <div class="sequencer-grid-wrap">
      <div id="sequencerGrid" class="sequencer-grid"></div>
    </div>
    <div class="sequencer-help">1–9 = save/select & play pattern · Shift+1–9 = clear pattern · Space = play/stop</div>
  `;

  const anchor = document.querySelector("#sequencerPane") || document.querySelector("main") || document.body;
  anchor.appendChild(panel);

  $("seqClear").addEventListener("click", () => {
    patterns[currentPatternSlot-1] = {
      steps: Array.from({length:9},()=>Array(SEQUENCER_STEPS).fill(false)),
      length: SEQUENCER_STEPS
    };
    renderSequencer();
  });

  $("seqFill").addEventListener("click", () => {
    const p = patterns[currentPatternSlot-1];
    p.steps[2].fill(false);
    for (let i=0;i<SEQUENCER_STEPS;i+=2) p.steps[2][i]=true;
    renderSequencer();
  });

  return panel;
}

function renderSequencer() {
  const panel = document.getElementById("sequencerPanel");
  const grid = document.getElementById("sequencerGrid");
  const label = document.getElementById("patternSlotLabel");
  if (!panel || !grid) return;

  panel.hidden = !sequencerMode;
  const pattern = patterns[currentPatternSlot - 1];
  if (!pattern) return;

  grid.innerHTML = "";

  const corner = document.createElement("div");
  corner.className = "seq-corner";
  grid.appendChild(corner);

  for (let s = 0; s < SEQUENCER_STEPS; s++) {
    const h = document.createElement("div");
    h.className = "seq-step-number";
    h.textContent = s + 1;
    h.dataset.step = s;
    grid.appendChild(h);
  }

  sequencerRows.forEach((row, r) => {
    const rowLabel = document.createElement("div");
    rowLabel.className = "seq-row-label";
    rowLabel.textContent = ROW_LABELS[row];
    grid.appendChild(rowLabel);

    for (let s = 0; s < SEQUENCER_STEPS; s++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "seq-cell";
      cell.dataset.row = r;
      cell.dataset.step = s;
      cell.setAttribute("aria-label", `${ROW_LABELS[row]} step ${s + 1}`);
      cell.setAttribute("aria-pressed", pattern.steps[r][s] ? "true" : "false");

      if (pattern.steps[r][s]) cell.classList.add("active");
      if (s % 4 === 0) cell.classList.add("beat");

      cell.addEventListener("click", () => {
        pattern.steps[r][s] = !pattern.steps[r][s];
        if (pattern.steps[r][s]) {
          ensureAudio();
          playSample(SAMPLE_BY_ROW[row]);
        }
        renderSequencer();
      });

      grid.appendChild(cell);
    }
  });

  if (label) label.textContent = `PATTERN ${currentPatternSlot}`;

  updateSequencerPlayhead();
}

function updateSequencerPlayhead() {
  const grid = document.getElementById("sequencerGrid");
  if (!grid) return;

  grid.querySelectorAll(".seq-step-number, .seq-cell").forEach(el => {
    el.classList.remove("current-step");
  });

  if (!sequencerMode || !transportRunning) return;

  const stepDuration = secondsPerBeat() / 4;
  const position = currentMasterPosition();
  const step = Math.floor(position / stepDuration) % SEQUENCER_STEPS;

  grid.querySelectorAll(`[data-step="${step}"]`).forEach(el => {
    el.classList.add("current-step");
  });
}

function setSequencerStep(step, active) {
  const pattern = patterns[currentPatternSlot - 1];
  if (!pattern || step < 0 || step >= SEQUENCER_STEPS) return;

  pattern.steps.forEach((row, r) => {
    if (active && row[step]) {
      playSample(SAMPLE_BY_ROW[sequencerRows[r]]);
    }
  });
}

function playCurrentPatternStep(step) {
  const pattern = patterns[currentPatternSlot - 1];
  if (!pattern) return;

  for (let r = 0; r < sequencerRows.length; r++) {
    if (pattern.steps[r][step]) {
      playSample(SAMPLE_BY_ROW[sequencerRows[r]]);
    }
  }
}

function switchMainTab(mode) {
  sequencerMode = mode === "sequencer";

  const loopPane = document.getElementById("loopStationPane");
  const seqPane = document.getElementById("sequencerPane");
  const loopTab = document.getElementById("loopStationTab");
  const seqTab = document.getElementById("sequencerTab");

  if (loopPane) loopPane.hidden = sequencerMode;
  if (seqPane) seqPane.hidden = !sequencerMode;

  if (loopTab) {
    loopTab.classList.toggle("active", !sequencerMode);
    loopTab.setAttribute("aria-selected", String(!sequencerMode));
  }
  if (seqTab) {
    seqTab.classList.toggle("active", sequencerMode);
    seqTab.setAttribute("aria-selected", String(sequencerMode));
  }

  renderSequencer();
}

function toggleSequencerMode() {
  switchMainTab(!sequencerMode ? "sequencer" : "loop");
}

function patternStepTime(step, pattern) {
  // One step = 1/16 note.
  return step * (secondsPerBeat() / 4);
}

function playPatternSlot(slotNumber) {
  if (slotNumber < 1 || slotNumber > 9) return;

  currentPatternSlot = slotNumber;
  const pattern = patterns[slotNumber - 1];
  if (!pattern) return;

  ensureAudio();

  // Patterns use the same master clock as the loop station.
  // Pressing a number selects the pattern; if transport is stopped, start it.
  if (!transportRunning) {
    masterLastPosition = 0;
    masterStartTime = performance.now() / 1000;
    transportRunning = true;
    lastBeat = -1;
    if (!masterAnimationId) masterAnimationId = requestAnimationFrame(masterTick);
  }

  renderSequencer();
  updateTransportStatus();
}


// Number keys are pattern controls while Sequencer Mode is active.
// They no longer merely select loop slots in this mode.
function handleSequencerNumberKey(event) {
  if (!sequencerMode) return false;

  if (event.shiftKey && /^[1-9]$/.test(event.key)) {
    const n = Number(event.key);
    patterns[n - 1] = {
      steps: Array.from({length: 9}, () => Array(SEQUENCER_STEPS).fill(false)),
      length: SEQUENCER_STEPS
    };
    currentPatternSlot = n;
    renderSequencer();
    return true;
  }

  if (/^[1-9]$/.test(event.key)) {
    playPatternSlot(Number(event.key));
    return true;
  }

  return false;
}

// ---------------- UI ----------------

function renderPads() {
  padsEl.innerHTML = "";

  padDefs.forEach(([key, name]) => {
    const button = document.createElement("button");
    button.className = "pad";

    if (key) button.dataset.key = key;

    button.innerHTML = `
      <span class="key">${displayKey(key)}</span>
      <span class="name">${name}</span>
    `;

    button.addEventListener("pointerdown", () => {
      if (key) triggerPad(key);
    });

    padsEl.appendChild(button);
  });
}

function renderSlots() {
  slotsEl.innerHTML = "";

  slots.forEach((slot, index) => {
    const button = document.createElement("button");
    button.className = "slot";

    if (index === selectedSlot) button.classList.add("selected");
    if (slot.events.length) button.classList.add("has-loop");
    if (playingSlots.has(index)) button.classList.add("playing");

    button.innerHTML =
      `<span class="num">${index + 1}</span><span class="dot"></span>`;

    button.title = playingSlots.has(index)
      ? `Slot ${index + 1} playing`
      : `Select slot ${index + 1}`;

    button.addEventListener("click", () => selectSlot(index));
    slotsEl.appendChild(button);
  });

  $("slotValue").textContent = selectedSlot + 1;
  $("timelineSlot").textContent = selectedSlot + 1;
}

function renderEvents() {
  eventsEl.innerHTML = "";
  const length = loopLength();

  currentLoop().events.forEach((event, index) => {
    const element = document.createElement("div");
    element.className = "event";
    element.style.left = `${(event.time / length) * 100}%`;
    element.style.setProperty("--level", `${(index % 5) * 5}px`);
    eventsEl.appendChild(element);
  });
}

function resetPosition() {
  playheadEl.style.left = "0%";
  positionEl.textContent =
    `0.00 / ${loopLength().toFixed(2)} s`;
}

function selectSlot(index) {
  if (index === selectedSlot) return;

  selectedSlot = index;

  const loop = currentLoop();
  bpmEl.value = loop.bpm;
  barsEl.value = loop.bars;
  $("bpmValue").textContent = loop.bpm;
  $("bpmOut").textContent = loop.bpm;
  $("barsValue").textContent = loop.bars;

  renderSlots();
  renderEvents();
  resetPosition();
  setStatus(loop.events.length ? "READY" : "EMPTY");
}

// ---------------- MASTER TRANSPORT / PLAYBACK ----------------

// V7 uses one musical clock for all slots. Slots do not have independent
// wall-clock loops; they all resolve their events against this timeline.
// A slot may contain 1, 2, 4 or 8 bars, but all slots share the same BPM.

const MASTER_BPM_MIN = 60;
const MASTER_BPM_MAX = 180;

let transportRunning = false;
let masterStartTime = 0;
let masterLastPosition = 0;
let masterAnimationId = null;
let masterNextEvent = new Map();

function secondsPerBeat() {
  return 60 / Number(bpmEl.value);
}

function masterBarLength() {
  return secondsPerBeat() * 4;
}

function masterCycleLength() {
  // The transport cycle is the configured bar count. Individual slots may
  // be shorter and wrap inside this master cycle.
  return masterBarLength() * Number(barsEl.value);
}

function slotLength(slot) {
  const bars = Number(slot.bars) || 1;
  return secondsPerBeat() * 4 * bars;
}

function currentMasterPosition(now = performance.now() / 1000) {
  if (!transportRunning) return masterLastPosition;
  const cycle = masterCycleLength();
  if (cycle <= 0) return 0;
  return ((now - masterStartTime) % cycle + cycle) % cycle;
}

function resetSlotSchedulers() {
  masterNextEvent.clear();
  for (let i = 0; i < slots.length; i++) {
    masterNextEvent.set(i, 0);
  }
}

function slotPosition(slot, masterPosition) {
  const length = slotLength(slot);
  if (!length) return 0;
  return masterPosition % length;
}

function playSlotEventsAtPosition(index, previousMaster, currentMaster, wrapped) {
  const slot = slots[index];
  if (!slot || !slot.events.length || !playingSlots.has(index)) return;

  const length = slotLength(slot);
  let next = masterNextEvent.get(index) ?? 0;

  // Keep the event cursor aligned with the current slot position after a
  // loop/transport start.
  const currentSlotPos = currentMaster % length;
  const previousSlotPos = previousMaster % length;

  // Events are stored in seconds within the slot loop.
  // Advance only when the event timestamp has actually been crossed.
  // This prevents animation-frame overlap from firing one event twice.
  let guard = 0;
  while (next < slot.events.length && guard++ < slot.events.length + 1) {
    const event = slot.events[next];
    const t = Number(event.time) || 0;

    let crossed;
    if (wrapped || currentSlotPos < previousSlotPos) {
      crossed = t > previousSlotPos || t <= currentSlotPos;
    } else {
      crossed = t > previousSlotPos && t <= currentSlotPos;
    }

    if (!crossed) break;

    triggerPad(event.key, true);
    next++;

    if (next >= slot.events.length) {
      next = 0;
      // If this is a normal cycle wrap, the next event is handled on the
      // following crossing rather than being fired twice now.
      break;
    }
  }

  masterNextEvent.set(index, next);
}

function startTransport() {
  ensureAudio();

  if (transportRunning) return;

  const cycle = masterCycleLength();
  const now = performance.now() / 1000;

  // Resume from the current musical position when possible.
  masterStartTime = now - masterLastPosition;

  transportRunning = true;
  resetSlotSchedulers();

  // Align event cursors with the current position so starting playback does
  // not unexpectedly fire every event in a loop.
  const position = masterLastPosition;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot.events.length || !playingSlots.has(i)) continue;

    const p = position % slotLength(slot);
    let cursor = slot.events.findIndex(e => Number(e.time) > p);
    if (cursor < 0) cursor = 0;
    masterNextEvent.set(i, cursor);
  }

  updateTransportStatus();
  if (!masterAnimationId) masterAnimationId = requestAnimationFrame(masterTick);
}

function startSlotPlayback(index) {
  const slot = slots[index];
  if (!slot || !slot.events.length) return;

  ensureAudio();
  playingSlots.add(index);

  // When joining an already-running master clock, begin at the next musical
  // boundary for clean synchronization rather than starting a private clock.
  if (!transportRunning) {
    masterLastPosition = 0;
    startTransport();
  }

  // Align this slot to the current master position.
  const p = currentMasterPosition();
  const len = slotLength(slot);
  let cursor = slot.events.findIndex(e => Number(e.time) > (p % len));
  if (cursor < 0) cursor = 0;
  masterNextEvent.set(index, cursor);

  renderSlots();
  updateTransportStatus();
}

function stopSlotPlayback(index) {
  playingSlots.delete(index);
  masterNextEvent.delete(index);

  renderSlots();
  updateTransportStatus();

  if (!playingSlots.size && transportRunning) {
    stopTransport();
  }
}

function stopTransport() {
  transportRunning = false;
  masterLastPosition = 0;
  masterStartTime = 0;
  masterNextEvent.clear();

  if (masterAnimationId) {
    cancelAnimationFrame(masterAnimationId);
    masterAnimationId = null;
  }

  resetPosition();
  updateTransportStatus();
}

function startPlayback() {
  startSlotPlayback(selectedSlot);
}

function stopPlayback() {
  // Global STOP.
  playingSlots.clear();
  stopTransport();

  recording = false;
  overdubbing = false;
  $("record").classList.remove("recording");
  setStatus("READY");
}

function updateTransportStatus() {
  if (recording) {
    setStatus("RECORDING");
  } else if (overdubbing) {
    setStatus("OVERDUB");
  } else if (playingSlots.size) {
    setStatus(`PLAYING ${playingSlots.size} SLOT${playingSlots.size === 1 ? "" : "S"}`);
  } else {
    setStatus("READY");
  }
}

function masterTick() {
  if (!transportRunning) {
    masterAnimationId = null;
    return;
  }

  const now = performance.now() / 1000;
  const cycle = masterCycleLength();
  const elapsedAbsolute = now - masterStartTime;
  const current = ((elapsedAbsolute % cycle) + cycle) % cycle;
  const previous = masterLastPosition;

  const wrapped = current < previous;

  // Render selected slot position continuously, including while recording.
  // This gives a moving visual cue even before the first drum hit exists.
  const selected = slots[selectedSlot];
  if (selected) {
    const len = slotLength(selected);
    const pos = current % len;
    playheadEl.style.left = `${(pos / len) * 100}%`;
    positionEl.textContent = `${pos.toFixed(2)} / ${len.toFixed(2)} s`;
  }

  for (let i = 0; i < slots.length; i++) {
    if (!playingSlots.has(i)) continue;
    playSlotEventsAtPosition(i, previous, current, wrapped);
  }

  // Sequencer: one master-clock step every 1/16 note. The step is fired once
  // when the playhead crosses it, so it cannot double-trigger between frames.
  if (sequencerMode) {
    const stepLength = secondsPerBeat() / 4;
    const previousStep = Math.floor(previous / stepLength);
    const currentStep = Math.floor(current / stepLength);

    if (wrapped || currentStep < previousStep) {
      for (let s = previousStep + 1; s < Math.ceil(cycle / stepLength); s++) {
        playCurrentPatternStep(s % SEQUENCER_STEPS);
      }
      for (let s = 0; s <= currentStep; s++) {
        playCurrentPatternStep(s % SEQUENCER_STEPS);
      }
    } else if (currentStep > previousStep) {
      for (let s = previousStep + 1; s <= currentStep; s++) {
        playCurrentPatternStep(s % SEQUENCER_STEPS);
      }
    }

    updateSequencerPlayhead();
  }

  // Metronome follows the master clock.
  const beat = Math.floor(current / secondsPerBeat());
  if (metronome && beat !== lastBeat) {
    lastBeat = beat;
    metronomeClick(beat % 4 === 0);
  }

  masterLastPosition = current;
  masterAnimationId = requestAnimationFrame(masterTick);
}
// ---------------- RECORD / OVERDUB ----------------

function quantizeTime(time) {
  const mode = quantizeEl.value;
  if (mode === "off") return time;

  const divisions = {
    "1/4": 1,
    "1/8": 2,
    "1/16": 4,
    "1/32": 8
  };

  const d = divisions[mode];
  if (!d) return time;

  const grid = secondsPerBeat() / d;
  return Math.round(time / grid) * grid;
}

function beginRecording() {
  ensureAudio();

  const slot = currentLoop();
  slot.events = [];
  slot.bpm = Number(bpmEl.value);
  slot.bars = Number(barsEl.value);
  slot._recording = true;

  // Recording starts on the current master position. If nothing is playing,
  // this is zero. The resulting loop length is always musical.
  masterLastPosition = 0;
  masterStartTime = performance.now() / 1000;
  masterLastPosition = 0;

  playingSlots.add(selectedSlot);
  transportRunning = true;
  resetSlotSchedulers();

  recording = true;
  overdubbing = false;
  lastLiveHitAt.clear();

  $("record").classList.add("recording");
  updateTransportStatus();
  renderSlots();
  renderEvents();

  if (!masterAnimationId) {
    masterAnimationId = requestAnimationFrame(masterTick);
  }
}

function finishRecording() {
  const slot = currentLoop();
  const length = slotLength(slot);

  slot.events = slot.events
    .map(e => ({...e, time: Math.max(0, Math.min(e.time, length - 0.001))}))
    .sort((a,b) => a.time - b.time);

  slot._recording = false;
  recording = false;
  $("record").classList.remove("recording");

  // The newly recorded loop immediately joins the master transport.
  playingSlots.add(selectedSlot);

  // Rebuild playback cursor.
  const pos = currentMasterPosition();
  let cursor = slot.events.findIndex(e => Number(e.time) > (pos % length));
  if (cursor < 0) cursor = 0;
  masterNextEvent.set(selectedSlot, cursor);

  renderSlots();
  renderEvents();
  updateTransportStatus();
}

function toggleRecording() {
  if (recording) {
    finishRecording();
    return;
  }

  beginRecording();
}

function toggleOverdub() {
  ensureAudio();

  if (!currentLoop().events.length) {
    beginRecording();
    overdubbing = true;
    updateTransportStatus();
    return;
  }

  if (!playingSlots.has(selectedSlot)) {
    startSlotPlayback(selectedSlot);
  }

  overdubbing = !overdubbing;
  recording = overdubbing;

  if (recording) {
    loopStart = performance.now() / 1000;
    lastLiveHitAt.clear();
  }

  updateTransportStatus();
}

function recordedHitTime() {
  const slot = currentLoop();
  const len = slotLength(slot);

  if (!transportRunning) return 0;

  const now = performance.now() / 1000;
  const pos = currentMasterPosition(now);
  return pos % len;
}

// ---------------- MAPPING WINDOW ----------------

function updateControlBadges() {
  document.querySelectorAll(".key-badge").forEach(badge => {
    const key = controlDefs[badge.dataset.control] || "";
    badge.textContent = displayKey(key);
    badge.classList.toggle("empty", !key);
  });
}

function renderMapping() {
  const pads = $("mappingPads");
  const controls = $("mappingControls");

  pads.innerHTML = "";
  controls.innerHTML = "";

  padDefs.forEach((pad, index) => {
    pads.appendChild(
      createMappingRow(
        `${index + 1}. ${pad[1]}`,
        pad[0],
        "pad",
        index
      )
    );
  });

  Object.keys(CONTROL_LABELS).forEach(name => {
    controls.appendChild(
      createMappingRow(
        CONTROL_LABELS[name],
        controlDefs[name],
        "control",
        name
      )
    );
  });

  updateControlBadges();
}

function createMappingRow(label, currentKey, type, identifier) {
  const row = document.createElement("div");
  row.className = "mapping-row";

  const name = document.createElement("span");
  name.className = "mapping-name";
  name.textContent = label;

  const assignment = document.createElement("span");
  assignment.className = "mapping-assignment";
  assignment.textContent = displayKey(currentKey);

  const mapButton = document.createElement("button");
  mapButton.className = "mapping-key";
  mapButton.textContent = "MAP";

  const removeButton = document.createElement("button");
  removeButton.className = "mapping-remove";
  removeButton.textContent = "REMOVE";

  mapButton.addEventListener("click", () => {
    mapButton.textContent = "PRESS";
    mapButton.classList.add("listening");

    function capture(event) {
      event.preventDefault();
      event.stopPropagation();

      // Escape cancels mapping.
      if (event.key === "Escape") {
        document.removeEventListener("keydown", capture, true);
        renderMapping();
        return;
      }

      const newKey = normalizeKey(event);
      if (!newKey) return;

      if (mappingInUse(
        newKey,
        type === "pad" ? identifier : -1,
        type === "control" ? identifier : null
      )) {
        alert(`"${displayKey(newKey)}" is already mapped.`);
        return;
      }

      if (type === "pad") {
        padDefs[identifier][0] = newKey;
      } else {
        controlDefs[identifier] = newKey;
      }

      saveMappings();
      renderPads();
      renderMapping();

      document.removeEventListener("keydown", capture, true);
    }

    document.addEventListener("keydown", capture, true);
  });

  removeButton.addEventListener("click", () => {
    if (type === "pad") {
      padDefs[identifier][0] = "";
    } else {
      controlDefs[identifier] = "";
    }

    saveMappings();
    renderPads();
    renderMapping();
  });

  row.append(name, assignment, mapButton, removeButton);
  return row;
}

function removeAllMappings() {
  padDefs.forEach(pad => pad[0] = "");
  Object.keys(controlDefs).forEach(name => controlDefs[name] = "");
  saveMappings();
  renderPads();
  renderMapping();
}

function restoreDefaults() {
  padDefs = DEFAULT_PADS.map(pad => [...pad]);
  controlDefs = {...DEFAULT_CONTROLS};
  saveMappings();
  renderPads();
  renderMapping();
}

function openMapping() {
  renderMapping();
  mappingOverlay.classList.add("open");
  mappingOverlay.setAttribute("aria-hidden", "false");
}

function closeMapping() {
  mappingOverlay.classList.remove("open");
  mappingOverlay.setAttribute("aria-hidden", "true");
}

$("openMapping").addEventListener("click", openMapping);
$("closeMapping").addEventListener("click", closeMapping);
$("closeMappingBottom").addEventListener("click", closeMapping);

mappingOverlay.addEventListener("click", event => {
  if (event.target === mappingOverlay) closeMapping();
});

$("clearAllMappings").addEventListener("click", () => {
  if (confirm("Remove every pad and control mapping?")) {
    removeAllMappings();
  }
});

$("resetMapping").addEventListener("click", () => {
  if (confirm("Restore all default mappings?")) {
    restoreDefaults();
  }
});

// ---------------- BUTTONS ----------------

$("audioStart").addEventListener("click", async () => {
  ensureAudio();
  await loadSamples();
  $("audioStart").textContent = "AUDIO READY";
});

$("play").addEventListener("click", () => runControl("play"));
$("stop").addEventListener("click", () => runControl("stop"));
$("record").addEventListener("click", () => runControl("record"));
$("overdub").addEventListener("click", () => runControl("overdub"));
$("clear").addEventListener("click", () => runControl("clear"));
$("clearAll").addEventListener("click", () => runControl("clearAll"));
$("metronome").addEventListener("click", () => runControl("metronome"));

// ---------------- SETTINGS ----------------

bpmEl.addEventListener("input", () => {
  currentLoop().bpm = Number(bpmEl.value);
  currentLoop()._previousElapsed = null;
  $("bpmValue").textContent = bpmEl.value;
  $("bpmOut").textContent = bpmEl.value;
  renderEvents();
});

barsEl.addEventListener("change", () => {
  currentLoop().bars = Number(barsEl.value);
  currentLoop()._previousElapsed = null;
  $("barsValue").textContent = barsEl.value;
  renderEvents();
  resetPosition();
});

quantizeEl.addEventListener("change", () => {
  $("quantizeValue").textContent =
    quantizeEl.options[quantizeEl.selectedIndex].text;
});

// ---------------- KEYBOARD ----------------

const heldKeys = new Set();

document.addEventListener("keydown", event => {
  if (event.repeat) return;
  if (event.target.matches("input,select,textarea")) return;

  const key = normalizeKey(event);
  if (!key) return;

  if (handleSequencerNumberKey(event)) {
    event.preventDefault();
    return;
  }

  // Some browser/OS combinations can deliver duplicate keydown notifications.
  // Treat a physical key as one hit until its keyup is received.
  if (heldKeys.has(key)) return;
  heldKeys.add(key);
  if (mappingOverlay.classList.contains("open")) {
    heldKeys.delete(key);
    return;
  }

  // 1–9 select slots; Shift+1–9 clears slots.
  if (/^[1-9]$/.test(key)) {
    event.preventDefault();
    const slot = Number(key) - 1;

    if (event.shiftKey) {
      slots[slot].events = [];
      renderSlots();
      if (slot === selectedSlot) renderEvents();
      setStatus(`SLOT ${slot + 1} CLEARED`);
    } else {
      selectSlot(slot);
    }
    return;
  }

  const pad = padDefs.find(p => p[0] === key);
  if (pad) {
    event.preventDefault();
    triggerPad(key);
    return;
  }

  const control = Object.entries(controlDefs)
    .find(([, mapped]) => mapped === key);

  if (control) {
    event.preventDefault();
    runControl(control[0]);
  }
});

document.addEventListener("keyup", event => {
  const key = normalizeKey(event);
  if (key) heldKeys.delete(key);
});

window.addEventListener("blur", () => {
  heldKeys.clear();
});




function initMainTabs() {
  const loopTab = document.getElementById("loopStationTab");
  const seqTab = document.getElementById("sequencerTab");

  if (loopTab) loopTab.addEventListener("click", () => switchMainTab("loop"));
  if (seqTab) seqTab.addEventListener("click", () => switchMainTab("sequencer"));

  switchMainTab("loop");
}

// ---------------- INIT ----------------
initMainTabs();
renderSequencer();
ensureSequencerPanel();

renderPads();
renderMapping();
renderSlots();
renderEvents();
resetPosition();
updateControlBadges();
