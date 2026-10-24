# Changelog

All notable changes to Meldra are recorded here. Dates use ISO 8601. "Verified" means the behaviour
was executed in this environment; it does not mean a physical-device or production-hosting test.

## 0.2.0 — 2026-10-23

Static deployment, a real online transport, a compact menu, and the mode roster.

### Added

- **Duel (versus):** two players share the same arena, but only the player who closes a row scores
  it; first to eight wins. A blocked spawn loses the duel for that player. Per-player row counters
  are in the HUD and the result screen.
- **Relay:** one piece in play at a time, alternating turns, five shared Melds to win. The engine
  gates actions and gravity on the active turn; both clients show whose turn it is.
- **Rift:** three 60-second co-op survival waves with a rising gravity ramp and a wave counter.
- **Architect:** a deterministic half-built stack with a ten-row objective.
- **Endless:** a no-target solo survival mode with a high-score loop.
- **Mode picker:** a compact menu with Solo, Together, Duel and Endless visible, plus a collapsed
  "More ways to play" section for Relay, Rift and Architect. The join strip sits on the same card.
- **Production online transport:** Supabase Realtime broadcast, reused from Kanka Kombat's room
  architecture. No database, no auth, no game server; the host stays authoritative. Guests send a
  heartbeat so the host can detect a silent tab, and guests retry `hello` until the host answers.
- **GitHub Pages deployment:** `.github/workflows/pages.yml` runs `npm ci`, unit tests,
  `MELDRA_BASE=/meldra/ npm run build`, then `actions/deploy-pages`. Vite's base path and the
  soundtrack URL derive from the configured base, so all assets load from `/meldra/`.
- **Screenshots and README:** a public URL, mode table, rules, architecture, transport rationale,
  deployment notes, and screenshots of the menu, solo arena, Duel, co-op lobby, guide and phone UI.

### Changed

- The main menu is now a single compact card instead of a stretched two-column hero. Identity and
  the palette preview sit in a narrower side panel; the full control guide moved into How to play.
- The technical note "Rooms need the Meldra relay server. Locally: npm run server." was removed from
  the interface in both languages. Relay setup remains a developer-only README topic.
- Game result overlays, goals, music routing and player chips now understand every mode.
- Version is 0.2.0.

### Fixed

- The one-time lobby explainer now stays gone once the guide has been seen and never appears in
  Duel; its dismissal ran before the panel was composed, so the tip was re-attached immediately.
- Host snapshots are sent at 20 Hz instead of 60 Hz, with an immediate final snapshot at game end.
  Rapid guest input can no longer exhaust the relay's per-connection message budget mid-match, and
  the budget itself now leaves room for held-key repeats.
- Guest rooms distinguish a slow broadcast subscribe from a missing room; local relays report an
  unknown code in 6 seconds, production in 12.
- A guest reload keeps its room token and reconnects through the broadcast transport.
- Host and guest timers are cleared when a room closes, so a departed guest cannot fire a stale
  watchdog notification.
- A deliberate leave sends its `bye` before closing the broadcast channel.

### Screenshots

- `scripts/screenshots.ts` regenerates `docs/screenshots/*.png` from a running local build using
  only real player controls (menu, guide, solo arena, co-op lobby, Duel, phone layout).

### Testing

- `npm test` — 51 unit tests, including Duel scoring and top-out, Relay turn gating, Architect
  debris, Endless and Rift objectives.
- `npm run test:e2e` — 15 Playwright tests, including two contexts over the real Supabase broadcast
  transport, Duel mode inheritance, Relay turn handoff, Rift waves, Architect/Endless, the compact
  menu, and the previously covered co-op/reconnect/mobile/music/aurora flows.
- `MELDRA_BASE=/meldra/ npm run build` — all JS/CSS references resolve under `/meldra/`, and the
  soundtrack copy contains all six MP3s.

### Known issues

- Clash (four-player team versus) is still a proposal; it needs a wider arena and four-player rooms.
- Host authority and the 30-second reconnect window are unchanged.
- The Supabase transport uses the existing project's free-tier broadcast quotas and public anon key;
  it is not a ranked or persistent-room service.

## 0.1.1 — 2026-10-23

Soundtrack integration and the Liquid Aurora ambient layer.

### Added

- **Six-track soundtrack manager** (`src/client/soundtrack.ts`, `music.ts`): explicit state map for
  lobby (After Hours / Pixelated Memories), solo, co-op, versus and high-risk tracks; two playback
  decks with 900 ms crossfades; music mute and volume independent of sound effects; persisted lobby
  theme; local playback only (audio never crosses the relay).
- **High-risk music:** hysteretic danger latch (enter at 6 empty rows, leave at 8 after 2.5 s,
  1.2 s re-entry cooldown) selects `Pressure Loop` in solo and co-op and returns to the mode track
  when the board clears. Co-op clients evaluate the shared authoritative board.
- **Loop handling:** measured the supplied files and replaced native `audio.loop` with a 1.25 s
  self-crossfade into the idle deck, plus an `ended` restart safety net for throttled tabs.
- **Autoplay and failure handling:** blocked playback arms a one-time pointer/key unlock; missing or
  undecodable files log once, mark the track unavailable, and keep the game playable. One retry is
  scheduled for transient network failures.
- **Liquid Aurora** (`src/client/aurora.ts`): a 30 fps canvas layer behind the arena with five
  translucent ribbons, four edge washes, smoothed bass/mid/energy response from one shared
  `AnalyserNode`, a non-audio ambient fallback, subtle danger response and a static reduced-motion
  frame. The frame hugs the arena (width + 56 px) rather than the whole column, with two side
  curtains for visible ribbon movement.
- **Settings:** Off/Subtle/Enhanced Aurora, music on/off, music volume, and lobby theme in the
  existing How-to-play panel; all persisted in `meldra.settings.v1`. Top-bar ♫ toggle for quick mute.
- **Asset pipeline:** Vite serves `Soundtrack/` in development with byte-range support and copies it
  into `dist/Soundtrack/` on build; the Node relay now serves audio MIME types, byte ranges, and a
  proper 404 for missing media instead of an HTML fallback.
- **Tests:** 17 new unit tests (track mapping, danger hysteresis, spectrum bands, smoothing, aurora
  levels, manager lifecycle, loop crossfade, missing files) and 6 new Playwright tests (asset
  ranges, solo routing and live analysis, mute, populated/danger screenshots, persisted settings,
  reduced motion, phone framing, missing-soundtrack fallback). Co-op tests assert both clients are
  on the co-op track and return to the lobby theme.
- **Documentation:** `Soundtrack/README.md` with assignments, measured durations/RMS and loop
  behaviour; new D15/D16 design decisions; README music/visuals section; third-party notes.

### Changed

- The board background is now 90–93% opaque instead of fully opaque, so the aurora reads as light
  behind the arena while grid and piece contrast are preserved.
- The canvas layout is refitted after mount and on tab visibility, fixing a case where a game view
  created before layout completed kept an unstyled 300 × 150 canvas.
- Development port is 5191 (5190 belongs to another local project).

### Fixed

- Aurora level changes now update `data-level` immediately; switching to Off clears the canvas and
  live/energy markers instead of leaving the previous level visible.

### Localization

- Added English and Turkish strings for the music setting, volume, lobby themes, Aurora levels,
  hints, mute toasts and the music accessibility label.

### Mobile

- The aurora frame is sized to the arena + 28 px per side, verified at 390 × 844: it stays centred,
  within the viewport, and leaves the pads and board fully usable.

### Testing

Executed and passing in this environment (Node 24, Chromium via Playwright):

- `npm test` — 45 tests, including the existing engine and i18n suites.
- `npm run test:e2e` — 9 tests, including two independent co-op clients with matching music state,
  real soundtrack playback with live analyser energy, populated-board and danger screenshots,
  persisted enhanced/off settings, reduced motion, phone framing, and a 404 soundtrack fallback.
- `npm run build` — typecheck plus Vite build; `dist/Soundtrack/` contains all six MP3s.
- `npm run dev` — served `/Soundtrack/...` with `206 Partial Content` and `audio/mpeg` via the new
  Vite middleware.
- Measured all six files in Chromium: 79.92–204.80 s, 48 kHz stereo, seekable; first/last 2 s RMS and
  seam differences recorded in `Soundtrack/README.md`.
- Visually inspected Playwright screenshots of an early board, a board filled across its width, a
  danger state, Subtle vs Enhanced, and a 390 × 844 phone layout.

**Not verified:** a physical iPhone or Safari; human listening on speakers/headphones; a full
three-minute loop crossing in real time; versus/AI music because those modes do not exist; screen
readers; low-end GPU timing.

### Known issues

- Browser autoplay rules delay music until the first gesture, including after a guest reload.
- Loop points are crossfaded, not gapless; MP3 encoder padding remains.
- `Friendly Fire` is mapped but there is no versus or AI mode to select it.
- The aurora is intentionally almost invisible in the centre of the board; it is a rim light, not a
  full-screen visualizer.

## 0.1.0 — 2026-10-23

First playable cooperative prototype. The repository previously contained only a README, so this
entry covers the initial implementation.

### Added

- **Deterministic game engine** (`src/shared/engine.ts`, `pieces.ts`, `types.ts`, `constants.ts`)
  with a 10 × 20 arena, two independent pieces, 20 Hz tick simulation, seven-bag queues, gravity
  ramp, 400 ms lock delay with 12 resets, simple wall kicks, hard/soft drop scoring, line clearing,
  per-player contribution counters, and seeded event log.
- **Co-op rule set:** a cleared row containing both players' cells is a Meld; five Melds win;
  either player's spawn failure loses the shared match. Co-op and solo objective handling.
- **Overlap policy:** fixed spawn lanes; first locked cell wins on a same-tick collision; the
  partner's active piece is lifted clear instead of being embedded.
- **Host-authoritative online rooms** (`src/client/net.ts`) over a relay with guest-side prediction
  and snapshot reconciliation, shared pause, rematch, return-to-lobby, and abandoned-match handling.
- **Room relay server** (`src/server/index.ts`): static hosting for `dist/`, `/health`, `/relay`,
  two sockets per room, room code validation, 16 KiB payload cap, 80 msg/s limit, idle-room reaping.
- **Lobby:** create room, copy code, copy invite link (`?room=CODE`), player cards with palette,
  host/guest badges, live connection state, readiness, host-only start, leave room.
- **One-time lobby explainer** that states the Meld rule, links to the full guide, and stays
  dismissed once opened or closed.
- **Cached block sprites** for the arena renderer so per-cell gradients and weave patterns are
  painted once per palette/kind/owner/size instead of every frame.
- **English/Turkish localization** (`src/client/i18n.ts`) with a typed dictionary, browser-language
  detection on first visit, persisted manual choice, live switching, and complete UI/error/help
  coverage.
- **Four block palettes** with a canvas preview of real arena art, cycle controls, persisted choice,
  and palette reflection in lobby cards and in-game HUD.
- **Non-colour ownership cues:** rim + corner dot for player one, diagonal weave + ring for player
  two, plus a per-kind glyph.
- **Main-screen control guide** for the detected input type, plus an in-game help modal explaining
  the shared arena, Meld rule, shared defeat, scoring, ping, ownership cues, and phone controls.
- **Solo practice mode** (12 rows) using the same engine, renderer, and controls.
- **Responsive interface** for desktop, tablet, and phone-sized portrait layouts, with safe-area
  insets, a compact mobile HUD, and dynamic board sizing.
- **Touch input:** six on-screen pads with hold-to-repeat, horizontal drag-to-move with pointer
  capture, downward drag for soft drop, and scroll suppression during play.
- **Feedback:** 3-second countdown, danger tint, one-gap row hints, row-clear flashes, Meld bursts,
  column pings with a three-second highlight, floating clear/Meld labels, and original WebAudio cues
  with a persisted mute toggle.
- **Tests:** 28 Vitest unit tests and 3 Playwright end-to-end tests (see below).
- **Documentation:** README, DESIGN_DECISIONS, this changelog, THIRD_PARTY_NOTICES, `.gitignore`.

### Changed

- Replaced the vision-only README with instructions, implemented rules, architecture, testing
  status, deployment notes, and explicit limitations.

### Fixed

- Guest sockets no longer report "online" merely because the relay accepted the socket; a guest is
  online only after the host answers with `welcome`, so an unknown room code now produces a visible
  "No room answered that code" error instead of a silent lobby.
- Host room view hydration: the host now stores its emitted view, preventing heartbeat lobby
  messages from navigating the host out of a running match.
- Corrected partner HUD slot selection for the guest (partner is `1 − localPlayer`, not slot 1).
- Solo result copy no longer reuses the co-op defeat text; solo HUD shows rows against the solo
  objective instead of an empty Meld counter.
- Lobby re-render churn: periodic lobby heartbeats no longer replace player cards when nothing
  changed, which had made buttons intermittently unclickable during automation.

### Localization

- Added complete English and Turkish strings for every screen, control, error, toast, help section,
  result state, and accessibility label.
- Added tests asserting key parity, non-empty values, and matching `{placeholder}` sets between the
  two languages.

### Mobile

- Reworked the ≤700 px layout: compact score/objective/pause row, player chips with next previews
  above the arena, board sizing based on viewport minus a chrome budget, and touch pads that remain
  inside a 390 × 844 viewport.
- Hid the redundant top-bar help chip on phones; help remains available on the home screen, lobby,
  and in the pause overlay.
- Verified no page scroll during touch play and no horizontal overflow in Turkish.

### Testing

Executed and passing in this environment (Node 24, Chromium via Playwright):

- `npm test` — 28 tests: spawning, countdown gating, wall collision, kicks, lock delay, soft/hard
  drop scoring, single and multi-row clears, Meld detection and target victory, contribution
  credit, overlap resolution, spawn defeat, deterministic replay hashes, board encoding round trip,
  snapshot fields, state cloning, room-code normalization/validation, protocol version, i18n parity.
- `npm run test:e2e` — 3 tests:
  1. Two isolated browser contexts create/join a room by code, read the one-time Meld explainer,
     ready up, start, see partner actions reflected in identical locked-board state, share pause,
     hard-drop to a shared defeat, rematch, reload the guest into the running match, return to the
     lobby together, and send the guest back to the title when the host closes the room.
  2. An unknown room code shows the expected error.
  3. A 390 × 844 touch viewport changes the palette with a live preview repaint, shows the touch
     control guide, starts solo play, fits the arena and pads in one viewport, taps Drop, drags the
     active piece, switches to Turkish live, and opens the help guide from the pause overlay.
- `npm run dev` served the client on its own port and created a room over the relay on 8787.

**Not verified:** physical iPhone 13 (only Chromium device emulation), Safari/iOS rendering,
real WAN latency or cross-network connectivity, a deployed relay, two real people on separate
machines, screen readers, and sustained performance on low-end hardware.

### Known issues

- The host is authoritative and trusted; no host migration exists, and closing the host tab ends the
  room.
- A browser-throttled host tab slows the simulation; the catch-up loop is capped at five ticks.
- Guest reconnection is limited to a 30-second grace window and requires the room token (persisted
  per tab for the session).
- Audio is synthesized cues only; there is no music or per-channel volume.
- Only the Together co-op mode and solo practice exist; other modes in the README are proposals.
- The relay is in-memory and single-process; it is not horizontally scalable, and rooms disappear
  after five idle minutes.
