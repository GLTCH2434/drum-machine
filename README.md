# Drum Loop Station V2

GitHub Pages drum machine + 9-slot live looper.

## Pads
A Kick
S/D Snare
F/G Closed Hi-Hat
H Open Hi-Hat
J Crash
K Ride
L/Z Clap
X High Tom
C Low Tom

## Loop slots
1–9 select a slot.
Shift+1–9 clears that slot.

Each slot has independent:
- events
- BPM
- bar count

## Controls
R Record
Space Play/Stop
T Overdub
Backspace Clear selected slot

## Samples
Put these files in `samples/`:
- kickdrum.wav
- snare.wav
- closed_hihat.wav
- open_hihat.wav
- crash.wav
- ride.wav
- clap.wav
- tom_high.wav
- tom_low.wav

If your files have different names, edit `sampleFiles` in `app.js`.

## GitHub Pages
Upload the folder to a repository and enable GitHub Pages from the `main` branch root.


## Custom key mapping

Click any key in the **KEY MAPPING** panel, then press the keyboard key you want.

- Duplicate assignments are blocked.
- `Escape` cancels remapping.
- Mappings are saved automatically in browser local storage.
- **RESET DEFAULTS** restores A/S/D/F/G/H/J/K/L/Z/X/C.
