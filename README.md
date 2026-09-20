# Drum Loop Station V4

Browser drum machine and 9-slot looping station for GitHub Pages.

## Samples

Put these exact files in `samples/`:

- `kickdrum.wav`
- `snare.wav`
- `closed_hihat.wav`
- `open_hihat.wav`
- `crash.wav`
- `ride.wav`
- `clap.wav`
- `tom_high.wav`
- `tom_low.wav`

## Custom mappings

The main app frame contains only the drum pads and controls.

Click **KEY MAPPING** to open the separate mapping window.

You can customize:

### Pads
All 12 pads can be mapped independently.

### Controls
- Record
- Play / Stop
- Overdub
- Stop
- Clear Slot
- Clear All
- Metronome

### Mapping features
- MAP → press the desired keyboard key
- REMOVE → unassign a key
- REMOVE ALL MAPPINGS → start completely from scratch
- RESTORE DEFAULTS → restore the original layout
- Duplicate pad/control assignments are prevented
- Mappings persist using browser localStorage
- Every mapped control displays its current key directly on the control button

Default control mappings:

- `R` Record
- `Space` Play/Stop
- `T` Overdub
- `Esc` Stop
- `Backspace` Clear Slot
- `M` Metronome
- `Clear All` starts unassigned

Loop slots 1–9 remain fixed:
- `1–9` select a slot
- `Shift+1–9` clears a slot


### V5 input fix
- Added one-hit-per-key-down handling.
- Added a 55 ms live-hit guard to prevent duplicate/multiple triggers during recording and overdub.
- Playback-triggered events are not debounced.
