import { createReadStream, existsSync } from 'node:fs';
import { cp, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
// Project Pages serve the build from /meldra/; local dev and e2e stay at the root.
const BASE = process.env.MELDRA_BASE || '/';
const SOUNDTRACK_DIR = resolve(ROOT, 'Soundtrack');
const OUT_DIR = resolve(ROOT, 'dist', 'Soundtrack');

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/**
 * Serves the repository's Soundtrack/ folder in dev and copies it into the build.
 *
 * The MP3s are intentionally not imported as modules: they are large, optional at
 * build time, and only the active track should ever be fetched. Missing files do not
 * fail the build; the client falls back to a silent, non-reactive aurora and logs why.
 */
function serveSoundtrack(req: IncomingMessage, res: ServerResponse): void {
  const notFound = (): void => {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Not found');
  };
  void (async () => {
    let raw: string;
    try {
      raw = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      res.statusCode = 400;
      res.end('Bad soundtrack path');
      return;
    }
    const file = resolve(SOUNDTRACK_DIR, `.${raw}`);
    if (!file.startsWith(SOUNDTRACK_DIR + sep)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }
    let info;
    try {
      info = await stat(file);
    } catch {
      notFound();
      return;
    }
    if (!info.isFile()) {
      notFound();
      return;
    }

    const type = AUDIO_MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const total = info.size;
    const range = req.headers.range;
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.setHeader('content-type', type);

    if (!range) {
      res.setHeader('content-length', String(total));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.statusCode = 416;
      res.setHeader('content-range', `bytes */${total}`);
      res.end();
      return;
    }
    let start = match[1] ? Number(match[1]) : total - Number(match[2]);
    let end = match[1] && match[2] ? Number(match[2]) : total - 1;
    start = Math.max(0, start);
    end = Math.min(end, total - 1);
    if (start > end) {
      res.statusCode = 416;
      res.setHeader('content-range', `bytes */${total}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('content-length', String(end - start + 1));
    res.setHeader('content-range', `bytes ${start}-${end}/${total}`);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file, { start, end }).pipe(res);
  })().catch(() => notFound());
}

function soundtrackDev(): Plugin {
  return {
    name: 'meldra-soundtrack-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/Soundtrack', (req, res) => serveSoundtrack(req, res));
    },
  };
}

function soundtrackBuild(): Plugin {
  return {
    name: 'meldra-soundtrack-build',
    apply: 'build',
    async closeBundle() {
      if (!existsSync(SOUNDTRACK_DIR)) {
        this.warn(
          'Soundtrack/ is missing: the client builds without music. Add the six MP3s and rebuild.',
        );
        return;
      }
      try {
        await cp(SOUNDTRACK_DIR, OUT_DIR, { recursive: true });
      } catch (error) {
        this.warn(`Could not copy Soundtrack/ into the build: ${String(error)}`);
      }
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [soundtrackDev(), soundtrackBuild()],
  build: { target: 'es2022', assetsInlineLimit: 0 },
  server: { port: 5191, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
