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
  events: [], bpm:120, bars:4, _previousElapsed: null
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
    let time = performance.now() / 1000 - loopStart;
    time = Math.max(0, Math.min(loopLength(), quantizeTime(time)));
    if (time >= loopLength()) time = 0;

    const events = currentLoop().events;
    const last = events[events.length - 1];

    // Never store two nearly simultaneous copies of the same physical hit.
    // This is intentionally separate from audio playback so legitimate
    // repeated notes remain possible after the guard interval.
    if (last && last.key === key && Math.abs(last.time - time) < 0.08) {
      return;
    }

    events.push({
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

// ---------------- PLAYBACK ----------------

function slotLength(slot) {
  return (60 / slot.bpm) * 4 * slot.bars;
}

function startSlotPlayback(index) {
  const slot = slots[index];
  if (!slot || !slot.events.length || playingSlots.has(index)) return;

  ensureAudio();

  playingSlots.add(index);
  slotPlaybackStart.set(index, performance.now() / 1000);
  renderSlots();
  updateTransportStatus();
}

function stopSlotPlayback(index) {
  playingSlots.delete(index);
  slotPlaybackStart.delete(index);
  renderSlots();
  updateTransportStatus();
}

function startPlayback() {
  ensureAudio();

  // PLAY starts the selected slot without stopping any other active slot.
  startSlotPlayback(selectedSlot);

  if (!animationId) {
    previousElapsed = null;
    lastBeat = -1;
    animationId = requestAnimationFrame(tick);
  }
}

function stopPlayback() {
  // STOP is a global transport stop.
  playingSlots.clear();
  slotPlaybackStart.clear();

  recording = false;
  overdubbing = false;
  $("record").classList.remove("recording");

  previousElapsed = null;
  lastBeat = -1;

  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  resetPosition();
  renderSlots();
  setStatus("READY");
}

function stopSelectedSlot() {
  stopSlotPlayback(selectedSlot);

  if (!playingSlots.size && animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
    previousElapsed = null;
    resetPosition();
  }
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

function fireCrossedEvents(slot, previous, elapsed, wrapped) {
  if (!slot.events.length) return;

  for (const event of slot.events) {
    let crossed = false;

    if (previous === null) {
      // On the first frame, only fire events at the loop start.
      crossed = event.time <= 0.02;
    } else if (!wrapped) {
      // Normal forward movement: each event is crossed exactly once.
      crossed = event.time > previous && event.time <= elapsed;
    } else {
      // Loop wrapped: cross the tail of the loop, then its beginning.
      crossed =
        event.time > previous ||
        event.time <= elapsed;
    }

    if (crossed) {
      triggerPad(event.key, true);
    }
  }
}

function tick() {
  if (!playingSlots.size) {
    animationId = null;
    previousElapsed = null;
    return;
  }

  const now = performance.now() / 1000;

  // Render/play the selected slot's timeline position.
  const selectedStart = slotPlaybackStart.get(selectedSlot);
  const selected = slots[selectedSlot];

  if (selectedStart && selected && selected.events.length) {
    const selectedLength = slotLength(selected);
    const selectedElapsed = (now - selectedStart) % selectedLength;

    playheadEl.style.left = `${(selectedElapsed / selectedLength) * 100}%`;
    positionEl.textContent =
      `${selectedElapsed.toFixed(2)} / ${selectedLength.toFixed(2)} s`;
  }

  // Every active slot has its own independent loop clock.
  for (const index of Array.from(playingSlots)) {
    const slot = slots[index];
    const startTime = slotPlaybackStart.get(index);

    if (!slot || !startTime || !slot.events.length) {
      stopSlotPlayback(index);
      continue;
    }

    const length = slotLength(slot);
    const elapsed = (now - startTime) % length;

    // Use the slot's previous position to detect the exact crossing.
    // This fixes the old 25 ms overlap that could trigger one recorded event
    // on two consecutive animation frames, causing audible double hits.
    let previous = slot._previousElapsed ?? null;
    const wrapped = previous !== null && elapsed < previous;

    fireCrossedEvents(slot, previous, elapsed, wrapped);
    slot._previousElapsed = elapsed;
  }

  const selectedSlotData = slots[selectedSlot];
  if (selectedSlotData && selectedSlotData.events.length) {
    const selectedElapsed =
      (now - (slotPlaybackStart.get(selectedSlot) ?? now)) %
      slotLength(selectedSlotData);

    const beat = Math.floor(selectedElapsed / beatLength());

    if (metronome && beat !== lastBeat) {
      lastBeat = beat;
      metronomeClick(beat % 4 === 0);
    }
  }

  animationId = requestAnimationFrame(tick);
}
// ---------------- RECORD / OVERDUB ----------------

function beginRecording() {
  ensureAudio();

  currentLoop().events = [];
  currentLoop().bpm = Number(bpmEl.value);
  currentLoop().bars = Number(barsEl.value);
  currentLoop()._previousElapsed = null;

  recording = true;
  overdubbing = false;
  loopStart = performance.now() / 1000;

  // Recording is a selected-slot operation. Other slots keep playing.
  startSlotPlayback(selectedSlot);
  slotPlaybackStart.set(selectedSlot, loopStart);
  currentLoop()._previousElapsed = null;

  $("record").classList.add("recording");
  setStatus("RECORDING");

  if (!animationId) {
    previousElapsed = null;
    animationId = requestAnimationFrame(tick);
  }

  renderSlots();
  renderEvents();
}

function toggleOverdub() {
  ensureAudio();

  if (!playingSlots.has(selectedSlot)) {
    startSlotPlayback(selectedSlot);
  }

  overdubbing = !overdubbing;
  recording = overdubbing;

  updateTransportStatus();

  if (!animationId) {
    animationId = requestAnimationFrame(tick);
  }
}

function runControl(name) {
  switch (name) {
    case "record":
      recording ? stopPlayback() : beginRecording();
      break;
    case "play":
      if (playingSlots.has(selectedSlot)) {
        stopSlotPlayback(selectedSlot);
        if (!playingSlots.size && animationId) {
          cancelAnimationFrame(animationId);
          animationId = null;
          previousElapsed = null;
          resetPosition();
        }
      } else {
        startPlayback();
      }
      break;
    case "overdub":
      toggleOverdub();
      break;
    case "stop":
      stopPlayback();
      break;
    case "clear":
      stopSlotPlayback(selectedSlot);
      currentLoop().events = [];
      currentLoop()._previousElapsed = null;
      renderSlots();
      renderEvents();
      setStatus("CLEARED");
      break;
    case "clearAll":
      if (!confirm("Clear all 9 loop slots?")) return;
      stopPlayback();
      slots = Array.from({length:9}, () => ({
        events: [], bpm:120, bars:4, _previousElapsed: null
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

// ---------------- INIT ----------------

renderPads();
renderMapping();
renderSlots();
renderEvents();
resetPosition();
updateControlBadges();
