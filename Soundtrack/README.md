# Meldra soundtrack

Six original tracks supplied for Meldra. Playback is local to each player's browser; audio is never
sent through the room relay. A co-op match therefore needs each player's own copy of the files,
which are committed in this folder and served by the Vite dev server and the Node relay.

| File | Duration | Size | Game state |
| --- | ---: | ---: | --- |
| `Meldra_ After Hours (Main Lobby).mp3` | 3:17.9 (197.92 s) | 5.29 MB | Home, lobby, mode selection, settings |
| `Meldra_ Pixelated Memories (Alternate Lobby).mp3` | 3:24.8 (204.80 s) | 4.81 MB | Optional lobby theme |
| `Meldra_ One More Round (Solo Mode).mp3` | 3:02.4 (182.36 s) | 4.26 MB | Solo practice |
| `Meldra_ Same Frequency (Co-Op Mode).mp3` | 2:52.8 (172.80 s) | 4.67 MB | Shared-arena co-op |
| `Meldra_ Friendly Fire (Versus Mode).mp3` | 1:19.9 (79.92 s) | 2.05 MB | Versus player and versus AI (reserved mapping) |
| `Meldra_ Pressure Loop (High Risk).mp3` | 1:31.2 (91.20 s) | 2.27 MB | High-risk override in solo, co-op and versus |

All files were decoded in Chromium: 48 kHz, stereo MP3, seekable (`accept-ranges`), and both ends
carry signal (the first and last two seconds are not silent).

## Measured envelope

These numbers come from decoding the files and computing RMS over the first and last two seconds.
They are measurements, not a substitute for listening, and they drove the loop strategy.

| Track | Mean RMS | First 2 s | Last 2 s | Last/first 100 ms difference |
| --- | ---: | ---: | ---: | ---: |
| After Hours | 0.166 | 0.095 | 0.207 | 0.017 |
| Pixelated Memories | 0.170 | 0.079 | 0.009 | 0.005 |
| One More Round | 0.145 | 0.091 | 0.080 | 0.005 |
| Same Frequency | 0.153 | 0.114 | 0.041 | 0.004 |
| Friendly Fire | 0.120 | 0.110 | 0.073 | 0.113 |
| Pressure Loop | 0.140 | 0.122 | 0.091 | 0.106 |

Interpretation:

- **One More Round** has closely matched ends and is the most loop-friendly of the six.
- **Pixelated Memories** fades almost to silence at the end; a native loop would restart into a much
  louder intro.
- **Same Frequency** also steps down at the end, though less sharply.
- **Friendly Fire** and **Pressure Loop** have an audible level jump at the seam.
- **After Hours** ends louder than it begins.

## Loop and transition behaviour

- The client does **not** rely on `HTMLAudioElement.loop`. That would hard-cut the tail and produce
  either a gap or a click on five of the six tracks.
- With 1.25 s remaining, the idle deck starts a fresh copy of the same track and crossfades in over
  900 ms while the old copy fades out. This smooths the seam on every track and removes the silent
  gap on Pixelated Memories.
- A track change (lobby → solo, solo → pressure) uses a two-deck 900 ms crossfade. The old deck is
  paused and its source released after the fade, so only one track is ever at full volume.
- If Web Audio is unavailable, the manager falls back to one `<audio>` element at a time with an
  immediate switch; it never plays two full-volume tracks together.
- MP3 encoder padding is not removed. The crossfade masks it; gapless playback is not claimed.

## Loading, autoplay and failure

- Only the wanted track is requested; the six files are never fetched at page load.
- Browsers may block the first play until a user gesture. The manager resumes on the first pointer
  or key event and never throws. A guest who reloads into a running match has no gesture yet, so
  music starts on their first interaction.
- A missing or undecodable file logs one warning, marks the track unavailable, and leaves the game
  silent. The Liquid Aurora switches to its non-audio ambient fallback, so the scene still looks
  complete.
- Music can be muted independently of sound effects, and its volume is separate.

## Rights

These tracks were supplied by the project owner for Meldra and committed to this repository. No
third-party stock-library attribution is recorded in the project. See `../THIRD_PARTY_NOTICES.md`.
