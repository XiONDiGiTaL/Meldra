/**
 * Meldra relay server.
 *
 *   /relay    room relay for host-authoritative co-op (one host + one guest per room)
 *   /health   liveness probe
 *   rest      the built client from ./dist, when present
 *
 * The relay never simulates the game: it forwards opaque messages between the two
 * browsers that share a room code. The host client owns the authoritative state.
 */
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../shared/constants.js';

const PORT = Number(process.env.PORT ?? 8787);
const STATIC_DIR = process.env.STATIC_DIR ?? 'dist';
const MAX_ROOMS = Number(process.env.MELDRA_MAX_ROOMS ?? 400);
const MAX_CLIENTS_PER_ROOM = 2;
const ROOM_IDLE_MS = 5 * 60_000;
const MAX_MESSAGE_BYTES = 16 * 1024;
// A held key repeats at ~30 Hz and the guest relays each edge; leave room for a few
// simultaneous keys without ever turning normal play into a dropped connection.
const MAX_MESSAGES_PER_SECOND = 200;
const ORIGINS = (process.env.MELDRA_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

interface Room {
  clients: Set<WebSocket>;
  emptySince: number;
}

interface Session {
  room: string | null;
  count: number;
  windowStart: number;
}

const rooms = new Map<string, Room>();
const sessions = new Map<WebSocket, Session>();
let peerSeq = 0;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: sessions.size, protocol: PROTOCOL_VERSION }));
    return;
  }

  if (url.pathname === '/relay') {
    res.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('This endpoint expects a WebSocket connection.');
    return;
  }

  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(STATIC_DIR, path === '/' ? 'index.html' : path);
  if (path.endsWith('/')) file = join(STATIC_DIR, path, 'index.html');

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    const cache = file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600';
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const total = info.size;
      if (match && (match[1] || match[2])) {
        let start = match[1] ? Number(match[1]) : total - Number(match[2]);
        let end = match[1] && match[2] ? Number(match[2]) : total - 1;
        start = Math.max(0, start);
        end = Math.min(end, total - 1);
        if (start <= end) {
          res.writeHead(206, {
            'content-type': type,
            'cache-control': cache,
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${total}`,
            'content-length': String(end - start + 1),
          });
          if (req.method === 'HEAD') res.end();
          else createReadStream(file, { start, end }).pipe(res);
          return;
        }
      }
      res.writeHead(416, { 'content-range': `bytes */${total}` });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': type,
      'cache-control': cache,
      'accept-ranges': 'bytes',
      'content-length': String(info.size),
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  } catch {
    if (path.startsWith('/Soundtrack/') || path.startsWith('/assets/')) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('Not found');
      return;
    }
    try {
      // SPA fallback so /?room=CODE always loads the game.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(await readFile(join(STATIC_DIR, 'index.html')));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Meldra relay. Build the client with `npm run build` to serve it from here.');
    }
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/relay') {
    socket.destroy();
    return;
  }
  const origin = req.headers.origin ?? '';
  if (ORIGINS.length > 0 && !ORIGINS.includes(origin)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

function send(ws: WebSocket | undefined, payload: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function leaveRoom(ws: WebSocket): void {
  const session = sessions.get(ws);
  if (!session?.room) return;
  const room = rooms.get(session.room);
  if (!room) return;
  room.clients.delete(ws);
  const leavingId = (ws as WebSocket & { peerId?: string }).peerId;
  for (const client of room.clients) {
    send(client, { k: 'peer-left', id: leavingId });
  }
  if (room.clients.size === 0) room.emptySince = Date.now();
}

wss.on('connection', (ws: WebSocket) => {
  peerSeq += 1;
  (ws as WebSocket & { peerId?: string }).peerId = `peer-${peerSeq}`;
  sessions.set(ws, { room: null, count: 0, windowStart: Date.now() });

  ws.on('message', (raw) => {
    const session = sessions.get(ws);
    if (!session) return;
    const rawSize = Array.isArray(raw)
      ? raw.reduce((total, part) => total + part.byteLength, 0)
      : raw.byteLength;
    if (rawSize > MAX_MESSAGE_BYTES) {
      ws.close();
      return;
    }
    const now = Date.now();
    if (now - session.windowStart > 1000) {
      session.windowStart = now;
      session.count = 0;
    }
    session.count += 1;
    if (session.count > MAX_MESSAGES_PER_SECOND) {
      send(ws, { k: 'err', code: 'rate-limited' });
      ws.close();
      return;
    }

    let message: { k?: string; room?: string; d?: unknown };
    try {
      message = JSON.parse(String(raw)) as { k?: string; room?: string; d?: unknown };
    } catch {
      return;
    }

    if (message.k === 'join' && typeof message.room === 'string') {
      const code = message.room.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== ROOM_CODE_LENGTH || [...code].some((ch) => !ROOM_CODE_ALPHABET.includes(ch))) {
        send(ws, { k: 'err', code: 'bad-room' });
        ws.close();
        return;
      }
      if (session.room) return;
      if (rooms.size >= MAX_ROOMS) {
        send(ws, { k: 'err', code: 'server-full' });
        ws.close();
        return;
      }
      let room = rooms.get(code);
      if (!room) {
        room = { clients: new Set(), emptySince: 0 };
        rooms.set(code, room);
      }
      if (room.clients.size >= MAX_CLIENTS_PER_ROOM) {
        send(ws, { k: 'err', code: 'room-full' });
        ws.close();
        return;
      }
      room.clients.add(ws);
      room.emptySince = 0;
      session.room = code;
      send(ws, { k: 'ready', id: (ws as WebSocket & { peerId?: string }).peerId, room: code });
      return;
    }

    if (message.k === 'msg' && session.room) {
      const room = rooms.get(session.room);
      if (!room) return;
      const from = (ws as WebSocket & { peerId?: string }).peerId;
      for (const client of room.clients) {
        if (client === ws) continue;
        send(client, { k: 'msg', from, d: message.d });
      }
    }
  });

  ws.on('close', () => {
    leaveRoom(ws);
    sessions.delete(ws);
  });

  ws.on('error', () => {
    try {
      ws.close();
    } catch {
      /* already closing */
    }
  });
});

// Reap stale empty rooms.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && room.emptySince > 0 && now - room.emptySince > ROOM_IDLE_MS) {
      rooms.delete(code);
    }
  }
}, 60_000).unref?.();

const shutdown = (): void => {
  for (const client of sessions.keys()) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`Meldra relay listening on http://localhost:${PORT} (static: ${STATIC_DIR})`);
});
