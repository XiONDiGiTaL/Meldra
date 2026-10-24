# Third-party notices

Meldra's game code, interface design, canvas block art, and synthesized sound cues are original
work created for this project. No third-party art, sound effects, textures, fonts, or other
protected assets are bundled. The six soundtrack files in `Soundtrack/` (listed in
`Soundtrack/README.md`) were supplied by the project owner for Meldra and committed to this
repository; no stock-library attribution is recorded for them.

## Bundled media

| Asset | Source | Use |
| --- | --- | --- |
| `Meldra_ After Hours (Main Lobby).mp3` | Project owner | Lobby |
| `Meldra_ Pixelated Memories (Alternate Lobby).mp3` | Project owner | Optional lobby theme |
| `Meldra_ One More Round (Solo Mode).mp3` | Project owner | Solo |
| `Meldra_ Same Frequency (Co-Op Mode).mp3` | Project owner | Co-op |
| `Meldra_ Friendly Fire (Versus Mode).mp3` | Project owner | Duel |
| `Meldra_ Pressure Loop (High Risk).mp3` | Project owner | High-risk override |

They are served locally; no external music service is involved.

## Runtime and build dependencies

| Package | Version | License | Use |
| --- | --- | --- | --- |
| [`ws`](https://github.com/websockets/ws) | ^8.18.0 | MIT | WebSocket room relay on the Node server |
| [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) | ^2.118.0 | MIT | Browser Realtime broadcast transport for online rooms |
| [`vite`](https://vitejs.dev/) | ^5.4.10 | MIT | Development server and production bundling |
| [`vitest`](https://vitest.dev/) | ^2.1.4 | MIT | Unit and simulation tests |
| [`typescript`](https://www.typescriptlang.org/) | ^5.6.3 | Apache-2.0 | Type checking |
| [`tsx`](https://github.com/privatenumber/tsx) | ^4.19.2 | MIT | Running the TypeScript relay server |
| [`@playwright/test`](https://playwright.dev/) | ^1.56.1 | Apache-2.0 | Two-browser end-to-end tests |
| `@types/node`, `@types/ws` | matching majors | MIT | Type declarations |

Dependency license texts are available in each package under `node_modules`. No dependency is
vendored or modified.

## Hosting and relay services

- **GitHub Pages** serves the static build at `https://xiondigital.net/meldra/` through the
  repository's Pages workflow.
- **Supabase Realtime** (owned by the project owner's existing Supabase account) carries ephemeral
  broadcast messages for online rooms. Only the publishable anon key is present in the client. No
  database table, auth user, or service-role credential is used by Meldra.
- **Cloudflare** continues to proxy the existing `xiondigital.net` DNS records. Meldra did not add
  or modify a DNS record, route, or proxy setting.

## Fonts

The interface uses the operating system's UI font stack (Segoe UI Variable / Segoe UI / system-ui /
Helvetica / Arial). No web font files are downloaded or redistributed.

## Reference material

- **Kanka Kombat** and **LeapBuddies** are the same author's projects. They were read as
  implementation references for room handling and bilingual UI patterns. No source code was
  copied into Meldra.
- **Tetris Effect: Connected** is a commercial game by Monstar Inc. / Enhance. Its installation
  was detected on this machine but was **not** launched, decompiled, unpacked, or mined for
  assets during this work, and no protected expression from it is included in Meldra.
- **REA** (rea-agents 6.7.0, MIT) is a locally installed analysis toolkit. It was inspected and
  its version command was run. It was deliberately **not** pointed at the commercial reference
  game, because binary analysis and asset extraction are outside the project's reference rules.

## Originality statement

Meldra uses standard falling-block movement conventions (which are not protectable) but its
shared-arena rule set, "Meld" objective, terminology, interface, palettes, ownership markers,
feedback design, code, and audio cues are original to this project. See `DESIGN_DECISIONS.md`.
