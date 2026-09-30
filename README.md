# Drum Loop Station

https://gltch2434.github.io/drum-machine/

Static web app (HTML/CSS/vanilla JS/Web Audio). Deploy on GitHub Pages: push the folder, enable Pages.

## Overview

Two independent instruments — **Loop Station** and **Sequencer** — each with its own BPM, clock, playhead, metronome, and quantization. Only one runs at a time.

`samples/` contains generated placeholder WAVs. Replace them with your own using the same filenames.

---

## Quick Start

1. Open `index.html` in a browser (or visit the GitHub Pages URL)
2. Click a pad or press its mapped key to play sounds
3. Switch between **Loop Station** and **Sequencer** tabs
4. Use **Key mapping** to customize pad keys, rename pads, and load custom samples

---

## Keyboard Layout (Defaults)

| Key | Pad | Sound |
|-----|-----|-------|
| `a` | 1 | Kick |
| `s` | 2 | Snare |
| `d` | 3 | Closed HH |
| `f` | 4 | Closed HH |
| `g` | 5 | Open HH |
| `h` | 6 | Open HH |
| `j` | 7 | Crash |
| `k` | 8 | Ride |
| `l` | 9 | Clap |
| `z` | 10 | High Tom |
| `x` | 11 | Low Tom |
| `c` | 12 | Low Tom |

**Transport (Loop Station):**
| Key | Action |
|-----|--------|
| `r` | Record |
| `Space` | Play / Stop |
| `t` | Overdub |
| `Escape` | Stop |
| `Backspace` | Clear selected slot |
| `m` | Metronome toggle |

All mappings are customizable and persist in `localStorage`.

---

## Loop Station

**9 slots** — each slot stores its own loop (events + BPM + bars).

### Controls

| Button | Action |
|--------|--------|
| **Record** | Starts recording a new loop (clears slot) |
| **Play / Stop** | Plays or stops the selected slot |
| **Overdub** | Adds layers to existing loop (arms record while playing) |
| **Stop** | Stops playback, resets playhead |
| **Clear selected** | Empties current slot |
| **Clear all** | Empties all 9 slots |
| **Metronome** | Toggle click track |

### Settings

- **BPM** (60–180) — per-slot, saved with the loop
- **Bars** (1, 2, 4, 8) — loop length
- **Quantize** (OFF, 1/4, 1/8, 1/16, 1/32) — snaps recorded hits to grid

### Timeline

Visual timeline shows recorded hits as colored dots. Playhead moves in real time. Position display shows `current / total` seconds.

### Workflow

1. Select a slot (click number or press `1–9`)
2. Set BPM / Bars / Quantize
3. Hit **Record** — timer starts
4. Play pads — hits are quantized and stored
5. Hit **Overdub** to layer more
6. Hit **Play / Stop** to audition
7. Switch slots to build a song

---

## Sequencer

**9 patterns × 9 rows × 16/32 steps** — classic step sequencer.

### Controls

| Button | Action |
|--------|--------|
| **Play / Pause** | Toggle selected pattern |
| **Play all** | Play patterns sequentially (chains non-empty patterns) |
| **Stop all** | Stop and reset |
| **Metronome** | Toggle click track |
| **Clear** | Clear selected pattern |
| **Fill hi-hat** | Fills closed HH row on even steps |
| **Randomize** | Random pattern (weighted: kicks/snares/hats more likely) |

### Settings

- **BPM** (60–200)
- **Steps** (16 or 32)
- **Swing** (0–60%) — delays even steps
- **Quantize** (OFF, 1/4, 1/8, 1/16, 1/32) — currently display only; steps are fixed grid

### Grid

- Click cells to toggle steps
- **Mute buttons** (left) silence rows
- **Blue outline** = current step during playback
- **Darker columns** = downbeats (every 4 steps)

### Pattern Chaining

Enable **Play all** → patterns play in order (0→8), skipping empty ones. Loops indefinitely.

---

## Pads (Shared)

12 velocity-sensitive pads at bottom. Work in both modes.

- **Click / tap** — play sound
- **Keyboard** — use mapped keys
- **Right-click** — restore default sample (if custom loaded)
- **Key mapping modal** — rename, load custom sample, restore default

Custom samples replace the sound everywhere (pads, sequencer, loop station) for the session only.

---

## Record Session / Export WAV

Global session recorder (header buttons).

| Button | Action |
|--------|--------|
| **Record session** | Starts capturing all pad hits (live + loop playback + sequencer). Metronome clicks are NOT recorded. |
| **Export WAV** | Renders captured hits to a 16-bit 44.1 kHz stereo WAV and downloads it. |

### How it works

1. Click **Record session** — timer appears on button
2. Play anything (pads, loops, sequencer)
3. Click **Record session** again to stop
4. Click **Export WAV** — downloads `drum-session-YYYY-MM-DD-HH-MM-SS.wav`

Uses `OfflineAudioContext` for precise rendering.

---

## Key Mapping Modal

Click **Key mapping** in header.

### Pad Mappings

For each of the 12 pads:
- **Input field** — edit display name (persists)
- **Map key** — press any key to assign (removes existing mapping for that key)
- **Load sample** — pick audio file (wav/mp3/ogg/…) to replace that pad's sound
- **Restore default** — appears after loading custom sample; reverts to built-in

### Loop Control Mappings

Assign keys to transport functions (Record, Play/Stop, Overdub, Stop, Clear selected, Clear all, Metronome).

### Buttons

| Button | Action |
|--------|--------|
| **Remove all** | Clears all key mappings |
| **Restore defaults** | Resets pads + controls to factory defaults |
| **Close** | Close modal |

All mappings and custom names persist in `localStorage`.

---

## Custom Samples

- Load via **Key mapping → Load sample** (any pad)
- Supported formats: whatever browser `decodeAudioData` handles (WAV, MP3, OGG, FLAC, etc.)
- Replaces sound globally for that pad name (kick, snare, etc.)
- Session only — not saved to disk. Refresh = back to defaults.
- Right-click pad or click **Restore default** in mapping modal to revert.

---

## Persistence (localStorage)

| Key | Contents |
|-----|----------|
| `drumLoopPadMapping` | Pad key → pad index |
| `drumLoopControlMapping` | Key → control action |
| `drumLoopPadNames` | Sample name → custom display name |

Clear browser data to reset everything.

---

## Technical Notes

- **AudioContext** — created on first interaction (autoplay policy)
- **Web Audio API** — `AudioBufferSourceNode` for playback, `OfflineAudioContext` for export
- **Timing** — `requestAnimationFrame` for loop station, `setInterval` + `AudioContext.currentTime` scheduling for sequencer
- **No build step** — pure ES modules, runs anywhere static files are served
- **Mobile friendly** — touch events, responsive grid, reduced-motion support

---

## File Structure

```
/drum-machine
├── index.html      # UI structure
├── app.js          # All logic (~700 lines)
├── style.css       # Dark theme, responsive
├── samples/        # 9 default WAVs
└── README.md       # This file
```

---

## License

MIT — do whatever you want.