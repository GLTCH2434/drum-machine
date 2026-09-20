
// ============================================================
// DRUM LOOP STATION
// Real samples + 9 loop slots + customizable keyboard mapping
// ============================================================

// ------------------------------------------------------------
// PAD DEFINITIONS
// ------------------------------------------------------------

const defaultPads = [
    ["a", "KICK", "kick"],
    ["s", "SNARE", "snare"],
    ["d", "SNARE", "snare"],

    ["f", "CLOSED HH", "closed_hihat"],
    ["g", "CLOSED HH", "closed_hihat"],

    ["h", "OPEN HH", "open_hihat"],
    ["j", "CRASH", "crash"],
    ["k", "RIDE", "ride"],

    ["l", "CLAP", "clap"],
    ["z", "CLAP", "clap"],

    ["x", "HIGH TOM", "tom_high"],
    ["c", "LOW TOM", "tom_low"]
];


// ------------------------------------------------------------
// SAMPLE FILES
// ------------------------------------------------------------

const sampleFiles = {
    kick:        "samples/kickdrum.wav",
    snare:       "samples/snare.wav",
    closed_hihat:"samples/closed_hihat.wav",
    open_hihat:  "samples/open_hihat.wav",
    crash:       "samples/crash.wav",
    ride:        "samples/ride.wav",
    clap:        "samples/clap.wav",
    tom_high:    "samples/tom_high.wav",
    tom_low:     "samples/tom_low.wav"
};


// ------------------------------------------------------------
// ELEMENTS
// ------------------------------------------------------------

const padsEl = document.getElementById("pads");
const slotsEl = document.getElementById("slots");
const eventsEl = document.getElementById("events");
const playheadEl = document.getElementById("playhead");

const statusEl = document.getElementById("status");
const positionEl = document.getElementById("position");
const sampleStatus = document.getElementById("sampleStatus");

const bpmEl = document.getElementById("bpm");
const barsEl = document.getElementById("bars");
const quantizeEl = document.getElementById("quantize");


// ------------------------------------------------------------
// AUDIO
// ------------------------------------------------------------

let audioCtx = null;
let master = null;

const audioBuffers = {};


// ------------------------------------------------------------
// LOAD CUSTOM KEY MAPPING
// ------------------------------------------------------------

let padDefs = JSON.parse(
    localStorage.getItem("drumLoopPadMapping") || "null"
);

if (!Array.isArray(padDefs) || padDefs.length !== defaultPads.length) {
    padDefs = defaultPads.map(pad => [...pad]);
}


// ------------------------------------------------------------
// LOOP SYSTEM
// ------------------------------------------------------------

let slots = Array.from(
    { length: 9 },
    () => ({
        events: [],
        bpm: 120,
        bars: 4
    })
);

let selectedSlot = 0;

let playing = false;
let recording = false;
let overdubbing = false;
let metronome = false;

let loopStart = 0;
let animationId = null;
let lastBeat = -1;


// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function currentLoop() {
    return slots[selectedSlot];
}


function loopLength() {
    const loop = currentLoop();

    return (
        (60 / loop.bpm) *
        4 *
        loop.bars
    );
}


function beatLength() {
    return 60 / currentLoop().bpm;
}


function setStatus(text) {
    statusEl.textContent = text;
}


// ------------------------------------------------------------
// INITIALIZE AUDIO
// ------------------------------------------------------------

function ensureAudio() {

    if (!audioCtx) {

        audioCtx =
            new (
                window.AudioContext ||
                window.webkitAudioContext
            )();

        master = audioCtx.createGain();

        master.gain.value = 0.9;

        master.connect(audioCtx.destination);
    }

    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
}


// ------------------------------------------------------------
// LOAD ALL SAMPLES
// ------------------------------------------------------------

async function loadSamples() {

    ensureAudio();

    const entries = Object.entries(sampleFiles);

    let loaded = 0;

    sampleStatus.textContent =
        "Loading samples...";


    for (const [name, path] of entries) {

        try {

            const response =
                await fetch(path);

            if (!response.ok) {
                throw new Error(
                    `Failed to load ${path}`
                );
            }

            const arrayBuffer =
                await response.arrayBuffer();

            const audioBuffer =
                await audioCtx.decodeAudioData(
                    arrayBuffer
                );

            audioBuffers[name] =
                audioBuffer;

            loaded++;

        } catch (error) {

            console.error(
                `Sample loading error: ${path}`,
                error
            );
        }
    }


    if (loaded === entries.length) {

        sampleStatus.textContent =
            `${loaded}/${entries.length} samples loaded`;

        sampleStatus.classList.add("ready");

    } else {

        sampleStatus.textContent =
            `${loaded}/${entries.length} samples loaded — check the samples/ folder`;
    }
}


// ------------------------------------------------------------
// PLAY SAMPLE
// ------------------------------------------------------------

function playSample(sound) {

    ensureAudio();

    const buffer =
        audioBuffers[sound];

    if (!buffer) {

        console.warn(
            `Sample not loaded: ${sound}`
        );

        return;
    }


    const source =
        audioCtx.createBufferSource();

    source.buffer = buffer;

    source.connect(master);

    source.start();
}


// ------------------------------------------------------------
// PAD FLASH
// ------------------------------------------------------------

function flashPad(key) {

    const pad =
        document.querySelector(
            `[data-key="${key}"]`
        );

    if (!pad) {
        return;
    }

    pad.classList.add("active");

    setTimeout(() => {

        pad.classList.remove("active");

    }, 80);
}


// ------------------------------------------------------------
// QUANTIZATION
// ------------------------------------------------------------

function quantizeTime(time) {

    const q =
        Number(quantizeEl.value);

    if (!q) {
        return time;
    }

    const step =
        beatLength() * 4 / q;

    return Math.round(
        time / step
    ) * step;
}


// ------------------------------------------------------------
// PLAY PAD
// ------------------------------------------------------------

function triggerPad(
    key,
    fromPlayback = false
) {

    const pad =
        padDefs.find(
            pad => pad[0] === key
        );

    if (!pad) {
        return;
    }


    const sound = pad[2];


    // Play actual WAV sample
    playSample(sound);

    // Visual feedback
    flashPad(key);


    // Record event
    if (
        !fromPlayback &&
        (recording || overdubbing)
    ) {

        let time =
            performance.now() / 1000 -
            loopStart;


        time =
            Math.max(
                0,
                Math.min(
                    loopLength(),
                    quantizeTime(time)
                )
            );


        if (time >= loopLength()) {
            time = 0;
        }


        currentLoop().events.push({

            time: time,

            sound: sound,

            key: key

        });


        renderEvents();

        renderSlots();
    }
}


// ------------------------------------------------------------
// LOOP SLOT UI
// ------------------------------------------------------------

function renderSlots() {

    slotsEl.innerHTML = "";


    slots.forEach(
        (slot, index) => {

            const button =
                document.createElement(
                    "button"
                );


            button.className =
                "slot";


            if (
                index === selectedSlot
            ) {
                button.classList.add(
                    "selected"
                );
            }


            if (
                slot.events.length
            ) {
                button.classList.add(
                    "has-loop"
                );
            }


            button.innerHTML = `
                <span class="num">
                    ${index + 1}
                </span>

                <span class="dot"></span>
            `;


            button.addEventListener(
                "click",
                () => {

                    selectSlot(index);

                }
            );


            slotsEl.appendChild(
                button
            );
        }
    );


    document.getElementById(
        "slotValue"
    ).textContent =
        selectedSlot + 1;


    document.getElementById(
        "timelineSlot"
    ).textContent =
        selectedSlot + 1;
}


// ------------------------------------------------------------
// SELECT SLOT
// ------------------------------------------------------------

function selectSlot(index) {

    if (
        index === selectedSlot
    ) {
        return;
    }


    stopPlayback();


    selectedSlot = index;


    const loop =
        currentLoop();


    bpmEl.value =
        loop.bpm;

    barsEl.value =
        loop.bars;


    document.getElementById(
        "bpmValue"
    ).textContent =
        loop.bpm;


    document.getElementById(
        "bpmOut"
    ).textContent =
        loop.bpm;


    document.getElementById(
        "barsValue"
    ).textContent =
        loop.bars;


    renderSlots();

    renderEvents();

    resetPosition();


    setStatus(
        loop.events.length
            ? "READY"
            : "EMPTY"
    );
}


// ------------------------------------------------------------
// RENDER LOOP EVENTS
// ------------------------------------------------------------

function renderEvents() {

    eventsEl.innerHTML = "";


    const length =
        loopLength();


    currentLoop()
        .events
        .forEach(
            (event, index) => {

                const element =
                    document.createElement(
                        "div"
                    );


                element.className =
                    "event";


                element.style.left =
                    `${(
                        event.time /
                        length
                    ) * 100}%`;


                element.style.setProperty(
                    "--level",
                    `${(index % 5) * 5}px`
                );


                eventsEl.appendChild(
                    element
                );
            }
        );
}


// ------------------------------------------------------------
// POSITION RESET
// ------------------------------------------------------------

function resetPosition() {

    playheadEl.style.left =
        "0%";


    positionEl.textContent =
        `0.00 / ${loopLength().toFixed(2)} s`;
}


// ------------------------------------------------------------
// START PLAYBACK
// ------------------------------------------------------------

function startPlayback() {

    ensureAudio();


    if (playing) {
        return;
    }


    playing = true;


    loopStart =
        performance.now() / 1000;


    lastBeat = -1;


    setStatus(
        recording
            ? "RECORDING"
            : overdubbing
                ? "OVERDUB"
                : "PLAYING"
    );


    tick();
}


// ------------------------------------------------------------
// STOP
// ------------------------------------------------------------

function stopPlayback() {

    playing = false;

    recording = false;

    overdubbing = false;


    cancelAnimationFrame(
        animationId
    );


    document
        .getElementById("record")
        .classList.remove(
            "recording"
        );


    resetPosition();

    setStatus("READY");
}


// ------------------------------------------------------------
// LOOP ENGINE
// ------------------------------------------------------------

function tick() {

    if (!playing) {
        return;
    }


    const now =
        performance.now() / 1000;


    const length =
        loopLength();


    const elapsed =
        (now - loopStart) %
        length;


    const events =
        currentLoop().events;


    for (
        const event of events
    ) {

        const previous =
            (
                elapsed -
                0.025 +
                length
            ) % length;


        if (
            event.time >= previous &&
            event.time < elapsed
        ) {

            triggerPad(
                event.key,
                true
            );
        }


        if (
            elapsed < 0.03 &&
            event.time >=
            length - 0.025
        ) {

            triggerPad(
                event.key,
                true
            );
        }
    }


    const beat =
        Math.floor(
            elapsed /
            beatLength()
        );


    if (
        metronome &&
        beat !== lastBeat
    ) {

        lastBeat = beat;

        playMetronomeClick(
            beat % 4 === 0
        );
    }


    playheadEl.style.left =
        `${(
            elapsed /
            length
        ) * 100}%`;


    positionEl.textContent =
        `${elapsed.toFixed(2)} / ${length.toFixed(2)} s`;


    animationId =
        requestAnimationFrame(
            tick
        );
}


// ------------------------------------------------------------
// METRONOME
// ------------------------------------------------------------

function playMetronomeClick(
    accent = false
) {

    ensureAudio();


    const oscillator =
        audioCtx.createOscillator();


    const gain =
        audioCtx.createGain();


    oscillator.frequency.value =
        accent ? 1000 : 700;


    gain.gain.setValueAtTime(
        0.08,
        audioCtx.currentTime
    );


    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioCtx.currentTime + 0.04
    );


    oscillator.connect(gain);

    gain.connect(master);


    oscillator.start();

    oscillator.stop(
        audioCtx.currentTime + 0.05
    );
}


// ------------------------------------------------------------
// RECORD
// ------------------------------------------------------------

function beginRecording() {

    ensureAudio();


    const loop =
        currentLoop();


    loop.events = [];

    loop.bpm =
        Number(bpmEl.value);

    loop.bars =
        Number(barsEl.value);


    recording = true;

    overdubbing = false;


    loopStart =
        performance.now() / 1000;


    document
        .getElementById("record")
        .classList.add(
            "recording"
        );


    setStatus(
        "RECORDING"
    );


    if (!playing) {

        playing = true;

        lastBeat = -1;

        tick();
    }


    renderSlots();

    renderEvents();
}


// ------------------------------------------------------------
// OVERDUB
// ------------------------------------------------------------

function toggleOverdub() {

    ensureAudio();


    if (!playing) {
        startPlayback();
    }


    overdubbing =
        !overdubbing;


    recording =
        overdubbing;


    setStatus(
        overdubbing
            ? "OVERDUB"
            : "PLAYING"
    );
}


// ------------------------------------------------------------
// RENDER PADS
// ------------------------------------------------------------

function renderPads() {

    padsEl.innerHTML = "";


    padDefs.forEach(
        ([key, name]) => {

            const button =
                document.createElement(
                    "button"
                );


            button.className =
                "pad";


            button.dataset.key =
                key;


            button.innerHTML = `
                <span class="key">
                    ${key.toUpperCase()}
                </span>

                <span class="name">
                    ${name}
                </span>
            `;


            button.addEventListener(
                "pointerdown",
                () => {
                    triggerPad(key);
                }
            );


            padsEl.appendChild(
                button
            );
        }
    );
}


// ------------------------------------------------------------
// CUSTOM KEY MAPPING
// ------------------------------------------------------------

function saveMapping() {

    localStorage.setItem(
        "drumLoopPadMapping",
        JSON.stringify(
            padDefs
        )
    );
}


function renderMapping() {

    const mapping =
        document.getElementById(
            "mapping"
        );


    if (!mapping) {
        return;
    }


    mapping.innerHTML = "";


    padDefs.forEach(
        (pad, index) => {

            const row =
                document.createElement(
                    "div"
                );


            row.className =
                "mapping-row";


            const name =
                document.createElement(
                    "span"
                );


            name.className =
                "mapping-name";


            name.textContent =
                `${index + 1}. ${pad[1]}`;


            const keyButton =
                document.createElement(
                    "button"
                );


            keyButton.className =
                "mapping-key";


            keyButton.textContent =
                pad[0].toUpperCase();


            keyButton.addEventListener(
                "click",
                () => {

                    keyButton.textContent =
                        "PRESS";


                    keyButton.classList.add(
                        "listening"
                    );


                    function captureKey(event) {

                        if (
                            event.key ===
                            "Escape"
                        ) {

                            keyButton.textContent =
                                padDefs[index][0]
                                    .toUpperCase();

                            keyButton.classList.remove(
                                "listening"
                            );

                            document.removeEventListener(
                                "keydown",
                                captureKey,
                                true
                            );

                            return;
                        }


                        if (
                            event.ctrlKey ||
                            event.altKey ||
                            event.metaKey
                        ) {
                            return;
                        }


                        if (
                            event.key.length !== 1
                        ) {
                            return;
                        }


                        const newKey =
                            event.key.toLowerCase();


                        const conflict =
                            padDefs.findIndex(
                                (p, i) =>
                                    i !== index &&
                                    p[0] === newKey
                            );


                        if (
                            conflict !== -1
                        ) {

                            alert(
                                `"${event.key}" is already assigned to ${padDefs[conflict][1]}`
                            );

                            return;
                        }


                        padDefs[index][0] =
                            newKey;


                        saveMapping();

                        renderPads();

                        renderMapping();


                        document.removeEventListener(
                            "keydown",
                            captureKey,
                            true
                        );
                    }


                    document.addEventListener(
                        "keydown",
                        captureKey,
                        true
                    );
                }
            );


            row.appendChild(name);

            row.appendChild(keyButton);

            mapping.appendChild(row);
        }
    );
}


// ------------------------------------------------------------
// RESET MAPPING
// ------------------------------------------------------------

document
    .getElementById(
        "resetMapping"
    )
    .addEventListener(
        "click",
        () => {

            padDefs =
                defaultPads.map(
                    pad => [...pad]
                );


            saveMapping();

            renderPads();

            renderMapping();
        }
    );


// ------------------------------------------------------------
// INITIALIZE PADS
// ------------------------------------------------------------

renderPads();

renderMapping();

renderSlots();

renderEvents();

resetPosition();


// ------------------------------------------------------------
// AUDIO BUTTON
// ------------------------------------------------------------

document
    .getElementById("audioStart")
    .addEventListener(
        "click",
        async () => {

            ensureAudio();

            await loadSamples();

            document
                .getElementById(
                    "audioStart"
                )
                .textContent =
                "AUDIO READY";
        }
    );


// ------------------------------------------------------------
// PLAY / STOP
// ------------------------------------------------------------

document
    .getElementById("play")
    .addEventListener(
        "click",
        () => {

            if (playing) {
                stopPlayback();
            } else {
                startPlayback();
            }
        }
    );


document
    .getElementById("stop")
    .addEventListener(
        "click",
        stopPlayback
    );


// ------------------------------------------------------------
// RECORD
// ------------------------------------------------------------

document
    .getElementById("record")
    .addEventListener(
        "click",
        () => {

            if (recording) {
                stopPlayback();
            } else {
                beginRecording();
            }
        }
    );


// ------------------------------------------------------------
// OVERDUB
// ------------------------------------------------------------

document
    .getElementById("overdub")
    .addEventListener(
        "click",
        toggleOverdub
    );


// ------------------------------------------------------------
// CLEAR SELECTED SLOT
// ------------------------------------------------------------

document
    .getElementById("clear")
    .addEventListener(
        "click",
        () => {

            currentLoop().events = [];

            renderSlots();

            renderEvents();

            setStatus(
                "CLEARED"
            );
        }
    );


// ------------------------------------------------------------
// CLEAR ALL SLOTS
// ------------------------------------------------------------

document
    .getElementById("clearAll")
    .addEventListener(
        "click",
        () => {

            if (
                !confirm(
                    "Clear all 9 loop slots?"
                )
            ) {
                return;
            }


            slots =
                Array.from(
                    { length: 9 },
                    () => ({
                        events: [],
                        bpm: 120,
                        bars: 4
                    })
                );


            selectedSlot = 0;


            renderSlots();

            renderEvents();

            resetPosition();

            setStatus(
                "ALL CLEARED"
            );
        }
    );


// ------------------------------------------------------------
// METRONOME
// ------------------------------------------------------------

document
    .getElementById("metronome")
    .addEventListener(
        "click",
        () => {

            metronome =
                !metronome;


            document
                .getElementById(
                    "metronome"
                )
                .textContent =
                `METRONOME: ${
                    metronome
                        ? "ON"
                        : "OFF"
                }`;
        }
    );


// ------------------------------------------------------------
// BPM
// ------------------------------------------------------------

bpmEl.addEventListener(
    "input",
    () => {

        currentLoop().bpm =
            Number(
                bpmEl.value
            );


        document
            .getElementById(
                "bpmValue"
            )
            .textContent =
            bpmEl.value;


        document
            .getElementById(
                "bpmOut"
            )
            .textContent =
            bpmEl.value;


        renderEvents();
    }
);


// ------------------------------------------------------------
// BARS
// ------------------------------------------------------------

barsEl.addEventListener(
    "change",
    () => {

        currentLoop().bars =
            Number(
                barsEl.value
            );


        document
            .getElementById(
                "barsValue"
            )
            .textContent =
            barsEl.value;


        renderEvents();

        resetPosition();
    }
);


// ------------------------------------------------------------
// QUANTIZATION
// ------------------------------------------------------------

quantizeEl.addEventListener(
    "change",
    () => {

        document
            .getElementById(
                "quantizeValue"
            )
            .textContent =
            quantizeEl.options[
                quantizeEl.selectedIndex
            ].text;
    }
);


// ------------------------------------------------------------
// KEYBOARD
// ------------------------------------------------------------

document.addEventListener(
    "keydown",
    event => {

        if (
            event.repeat
        ) {
            return;
        }


        if (
            event.target.matches(
                "input,select,textarea"
            )
        ) {
            return;
        }


        const key =
            event.key.toLowerCase();


        // 1–9 = loop slots
        if (
            /^[1-9]$/.test(key)
        ) {

            event.preventDefault();


            const slot =
                Number(key) - 1;


            if (event.shiftKey) {

                slots[slot].events = [];

                renderSlots();

                if (
                    slot ===
                    selectedSlot
                ) {
                    renderEvents();
                }

                setStatus(
                    `SLOT ${
                        slot + 1
                    } CLEARED`
                );

            } else {

                selectSlot(slot);
            }


            return;
        }


        // Drum pads
        if (
            padDefs.some(
                pad =>
                    pad[0] === key
            )
        ) {

            event.preventDefault();

            triggerPad(key);

            return;
        }


        // Space
        if (
            event.code === "Space"
        ) {

            event.preventDefault();

            if (playing) {
                stopPlayback();
            } else {
                startPlayback();
            }

            return;
        }


        // Record
        if (
            key === "r"
        ) {

            event.preventDefault();

            document
                .getElementById(
                    "record"
                )
                .click();

            return;
        }


        // Overdub
        if (
            key === "t"
        ) {

            event.preventDefault();

            document
                .getElementById(
                    "overdub"
                )
                .click();

            return;
        }


        // Clear
        if (
            event.key ===
            "Backspace"
        ) {

            event.preventDefault();

            document
                .getElementById(
                    "clear"
                )
                .click();
        }
    }
);
