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

let selectedSlot = 0;
let playing = false;
let recording = false;
let overdubbing = false;
let metronome = false;
let loopStart = 0;
let animationId = null;
let lastBeat = -1;

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

function triggerPad(key, fromPlayback = false) {
  const pad = padDefs.find(p => p[0] === key);
  if (!pad) return;

  playSample(pad[2]);
  flashPad(key);

  if (!fromPlayback && (recording || overdubbing)) {
    let time = performance.now() / 1000 - loopStart;
    time = Math.max(0, Math.min(loopLength(), quantizeTime(time)));
    if (time >= loopLength()) time = 0;

    currentLoop().events.push({
      time,
      sound: pad[2],
      key
    });

    renderEvents();
    renderSlots();
  }
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

    button.innerHTML =
      `<span class="num">${index + 1}</span><span class="dot"></span>`;

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

  stopPlayback();
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

// ---------------- PLAYBACK ----------------

function startPlayback() {
  ensureAudio();
  if (playing) return;

  playing = true;
  loopStart = performance.now() / 1000;
  lastBeat = -1;

  setStatus(recording ? "RECORDING" : overdubbing ? "OVERDUB" : "PLAYING");
  tick();
}

function stopPlayback() {
  playing = false;
  recording = false;
  overdubbing = false;
  cancelAnimationFrame(animationId);
  $("record").classList.remove("recording");
  resetPosition();
  setStatus("READY");
}

function tick() {
  if (!playing) return;

  const now = performance.now() / 1000;
  const length = loopLength();
  const elapsed = (now - loopStart) % length;

  for (const event of currentLoop().events) {
    const previous = (elapsed - 0.025 + length) % length;

    if (event.time >= previous && event.time < elapsed) {
      triggerPad(event.key, true);
    }

    if (elapsed < 0.03 && event.time >= length - 0.025) {
      triggerPad(event.key, true);
    }
  }

  const beat = Math.floor(elapsed / beatLength());

  if (metronome && beat !== lastBeat) {
    lastBeat = beat;
    metronomeClick(beat % 4 === 0);
  }

  playheadEl.style.left = `${(elapsed / length) * 100}%`;
  positionEl.textContent =
    `${elapsed.toFixed(2)} / ${length.toFixed(2)} s`;

  animationId = requestAnimationFrame(tick);
}

function metronomeClick(accent) {
  ensureAudio();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.frequency.value = accent ? 1000 : 700;
  gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    audioCtx.currentTime + 0.04
  );

  osc.connect(gain);
  gain.connect(master);

  osc.start();
  osc.stop(audioCtx.currentTime + 0.05);
}

// ---------------- RECORD / OVERDUB ----------------

function beginRecording() {
  ensureAudio();

  currentLoop().events = [];
  currentLoop().bpm = Number(bpmEl.value);
  currentLoop().bars = Number(barsEl.value);

  recording = true;
  overdubbing = false;
  loopStart = performance.now() / 1000;

  $("record").classList.add("recording");
  setStatus("RECORDING");

  if (!playing) {
    playing = true;
    tick();
  }

  renderSlots();
  renderEvents();
}

function toggleOverdub() {
  ensureAudio();

  if (!playing) startPlayback();

  overdubbing = !overdubbing;
  recording = overdubbing;

  setStatus(overdubbing ? "OVERDUB" : "PLAYING");
}

function runControl(name) {
  switch (name) {
    case "record":
      recording ? stopPlayback() : beginRecording();
      break;
    case "play":
      playing ? stopPlayback() : startPlayback();
      break;
    case "overdub":
      toggleOverdub();
      break;
    case "stop":
      stopPlayback();
      break;
    case "clear":
      currentLoop().events = [];
      renderSlots();
      renderEvents();
      setStatus("CLEARED");
      break;
    case "clearAll":
      if (!confirm("Clear all 9 loop slots?")) return;
      slots = Array.from({length:9}, () => ({
        events: [], bpm:120, bars:4
      }));
      selectedSlot = 0;
      renderSlots();
      renderEvents();
      resetPosition();
      setStatus("ALL CLEARED");
      break;
    case "metronome":
      metronome = !metronome;
      updateControlBadges();
      $("metronome").innerHTML =
        `<span class="key-badge" data-control="metronome"></span> METRONOME: ${metronome ? "ON" : "OFF"}`;
      updateControlBadges();
      break;
  }
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
  $("bpmValue").textContent = bpmEl.value;
  $("bpmOut").textContent = bpmEl.value;
  renderEvents();
});

barsEl.addEventListener("change", () => {
  currentLoop().bars = Number(barsEl.value);
  $("barsValue").textContent = barsEl.value;
  renderEvents();
  resetPosition();
});

quantizeEl.addEventListener("change", () => {
  $("quantizeValue").textContent =
    quantizeEl.options[quantizeEl.selectedIndex].text;
});

// ---------------- KEYBOARD ----------------

document.addEventListener("keydown", event => {
  if (event.repeat) return;
  if (event.target.matches("input,select,textarea")) return;
  if (mappingOverlay.classList.contains("open")) return;

  const key = normalizeKey(event);
  if (!key) return;

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

// ---------------- INIT ----------------

renderPads();
renderMapping();
renderSlots();
renderEvents();
resetPosition();
updateControlBadges();
