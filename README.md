# Drum Loop Station
https://gltch2434.github.io/drum-machine/

Static web app (HTML/CSS/vanilla JS/Web Audio). Deploy on GitHub Pages: push the folder, enable Pages.
Loop Station and Sequencer are independent instruments (own BPM, clock, playhead, metronome, quantization); only one runs at a time.
`samples/` contains generated placeholder WAVs. Replace them with your own using the same filenames.

- **Record session / Export WAV**: hit "Record session", play anything (pads, loops, sequencer — metronome clicks are not recorded), then "Export WAV" renders the captured hits to a downloadable 16-bit WAV.
- **Custom samples**: click "load sample" on any pad to pick an audio file (wav/mp3/ogg/…); it replaces that sound everywhere (pads, sequencer, loops). Right-click the pad to restore the default. Custom samples last for the page session only.
