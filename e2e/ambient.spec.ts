import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'test-results/visual';

interface BoardStats {
  filled: number;
  top: number;
  phase: string;
  heights: number[];
}

async function boardStats(page: Page): Promise<BoardStats> {
  return page.locator('#board').evaluate((canvas) => {
    const rows = (canvas.dataset.board ?? '').split('/');
    let filled = 0;
    let top = rows.length;
    const heights = new Array<number>(rows[0]?.length ?? 10).fill(0);
    rows.forEach((row, index) => {
      let rowFilled = false;
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== '.') {
          filled++;
          rowFilled = true;
          if (heights[x] === 0) heights[x] = rows.length - index;
        }
      }
      if (rowFilled) top = Math.min(top, index + 1);
    });
    return { filled, top, phase: canvas.dataset.phase ?? '', heights };
  });
}

async function startSolo(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('[data-mode="solo"]').click();
  await expect(page.locator('#board')).toHaveAttribute('data-phase', 'playing', { timeout: 20_000 });
}

const KIND_WIDTH = [4, 2, 3, 3, 3, 3, 3];

/**
 * Stack pieces greedily on the lowest columns, so the arena fills across its width
 * instead of growing one tower. Stops at a height or a cell count, whichever comes first.
 */
async function fillBoard(
  page: Page,
  options: { stopAtTop?: number; minFilled?: number; maxPieces?: number } = {},
): Promise<BoardStats> {
  const { stopAtTop = 0, minFilled = 0, maxPieces = 90 } = options;
  let stats = await boardStats(page);
  for (let i = 0; i < maxPieces; i++) {
    if ((stopAtTop > 0 && stats.top <= stopAtTop) || (minFilled > 0 && stats.filled >= minFilled)) break;
    if ((await page.locator('#board').getAttribute('data-phase')) !== 'playing') break;
    await page.waitForTimeout(80);
    const piece = (await page.locator('#board').getAttribute('data-piece'))?.split(',') ?? [];
    const kind = Number(piece[0] ?? 0);
    const pieceWidth = KIND_WIDTH[kind] ?? 3;
    const x = Number(piece[2] ?? 1);

    let bestX = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate <= 10 - pieceWidth; candidate++) {
      let tallest = 0;
      let sum = 0;
      for (let column = candidate; column < candidate + pieceWidth; column++) {
        tallest = Math.max(tallest, stats.heights[column] ?? 0);
        sum += stats.heights[column] ?? 0;
      }
      const score = tallest * 10 + sum;
      if (score < bestScore) {
        bestScore = score;
        bestX = candidate;
      }
    }

    const key = bestX < x ? 'ArrowLeft' : 'ArrowRight';
    for (let step = 0; step < Math.abs(bestX - x); step++) await page.keyboard.press(key);
    await page.keyboard.press('Space');
    await page.waitForTimeout(110);
    stats = await boardStats(page);
  }
  return stats;
}

async function setAurora(page: Page, label: 'Off' | 'Subtle' | 'Enhanced'): Promise<void> {
  await page.keyboard.press('Escape');
  await page.locator('.overlay').getByRole('button', { name: 'How to play' }).click();
  await expect(page.getByRole('heading', { name: 'How to play Meldra' })).toBeVisible();
  await page.getByRole('group', { name: 'Liquid Aurora' }).getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: 'Resume' }).click();
}

test('soundtrack files are served with byte ranges for seeking', async ({ request }) => {
  const path = '/Soundtrack/Meldra_%20Same%20Frequency%20(Co-Op%20Mode).mp3';
  const full = await request.get(path);
  expect(full.status()).toBe(200);
  expect(full.headers()['content-type']).toContain('audio/mpeg');
  expect(full.headers()['accept-ranges']).toBe('bytes');
  const partial = await request.get(path, { headers: { Range: 'bytes=0-255' } });
  expect(partial.status()).toBe(206);
  expect(partial.headers()['content-range']).toContain('bytes 0-255/');
});

test('lobby and solo music route correctly, and mute never stops the visuals', async ({ page }) => {
  await startSolo(page);
  await expect(page.locator('html')).toHaveAttribute('data-music-wanted', 'solo');
  await expect(page.locator('.aurora-canvas')).toBeVisible();
  await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-level', 'subtle');

  await expect
    .poll(async () => page.locator('html').getAttribute('data-music-live'), { timeout: 10_000 })
    .toBe('1');
  const energies = new Set<string>();
  for (let i = 0; i < 8; i++) {
    energies.add((await page.locator('.aurora-canvas').getAttribute('data-energy')) ?? '');
    await page.waitForTimeout(300);
  }
  // The live analyser must produce changing energy, not the constant ambient fallback.
  expect(energies.size).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Turn music on or off' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-music', 'off');
  await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-live', '0');
  await expect(page.locator('.aurora-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Turn music on or off' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-music-wanted', 'solo');
  await expect
    .poll(async () => page.locator('html').getAttribute('data-music-live'), { timeout: 10_000 })
    .toBe('1');
});

test('a missing soundtrack leaves the game playable with an ambient fallback', async ({ page }) => {
  await page.route('**/Soundtrack/**', (route) => route.fulfill({ status: 404, body: 'missing' }));
  await startSolo(page);
  await expect(page.locator('html')).toHaveAttribute('data-music', 'silent', { timeout: 10_000 });
  await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-live', '0');

  const samples = new Set<string>();
  for (let i = 0; i < 6; i++) {
    samples.add((await page.locator('.aurora-canvas').getAttribute('data-energy')) ?? '');
    await page.waitForTimeout(400);
  }
  expect(samples.size).toBeGreaterThan(1);

  await page.keyboard.press('Space');
  await expect
    .poll(async () => Number(await page.locator('.stat .v').first().textContent()))
    .toBeGreaterThan(0);
  await expect(page.locator('#board')).toHaveAttribute('data-phase', 'playing');
});

test('aurora levels persist, render behind a populated board and never hide it', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  await startSolo(page);

  const early = await boardStats(page);
  expect(early.filled).toBeLessThan(20);
  await page.screenshot({ path: `${SHOTS}/aurora-early.png` });

  const filled = await fillBoard(page, { minFilled: 90 });
  expect(filled.filled).toBeGreaterThan(70);
  expect(filled.phase).toBe('playing');

  // A real danger state selects Pressure Loop; the aurora reacts without turning red.
  const danger = await fillBoard(page, { stopAtTop: 6, maxPieces: 40 });
  expect(danger.phase).toBe('playing');
  await expect(page.locator('.board-wrap')).toHaveClass(/danger/);
  await expect(page.locator('html')).toHaveAttribute('data-music-wanted', 'pressure');
  await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-danger', '1');
  await page.screenshot({ path: `${SHOTS}/aurora-danger-subtle.png` });

  // Enhanced is stronger but must stay behind the grid.
  await setAurora(page, 'Enhanced');
  await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-level', 'enhanced');
  await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-live', '1');
  await page.screenshot({ path: `${SHOTS}/aurora-danger-enhanced.png` });

  // Off removes the layer entirely without touching the board.
  await setAurora(page, 'Off');
  await expect(page.locator('.aurora-canvas')).toHaveAttribute('data-level', 'off');
  const offPixels = await page.locator('.aurora-canvas').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const ctx = element.getContext('2d');
    if (!ctx) return 0;
    const data = ctx.getImageData(0, 0, element.width, element.height).data;
    let alpha = 0;
    for (let i = 3; i < data.length; i += 397) alpha += data[i];
    return alpha;
  });
  expect(offPixels).toBe(0);
  await expect(page.locator('#board')).toBeVisible();

  // Settings survive a reload and the lobby theme is remembered.
  await setAurora(page, 'Subtle');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-aurora', 'subtle');
  const stored = await page.evaluate(() => localStorage.getItem('meldra.settings.v1'));
  expect(stored).toContain('"aurora":"subtle"');
});

test('reduced motion keeps a static aurora and the selected lobby theme', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'How to play' }).first().click();
  await page.getByRole('group', { name: 'Lobby theme' }).getByRole('button', { name: 'Pixelated Memories' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-music-wanted', 'pixelated');
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.locator('[data-mode="solo"]').click();
  await expect(page.locator('#board')).toHaveAttribute('data-phase', 'playing', { timeout: 20_000 });
  await page.locator('.aurora-canvas').waitFor();
  const first = await page.locator('.aurora-canvas').getAttribute('data-energy');
  await page.waitForTimeout(800);
  const second = await page.locator('.aurora-canvas').getAttribute('data-energy');
  expect(first).toBe(second);
  await context.close();
});

test('phone layout keeps the aurora framed and the arena readable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  mkdirSync(SHOTS, { recursive: true });
  await startSolo(page);
  const filled = await fillBoard(page, { stopAtTop: 9, minFilled: 40, maxPieces: 24 });
  expect(filled.filled).toBeGreaterThan(24);
  await page.screenshot({ path: `${SHOTS}/aurora-phone.png` });

  const frame = await page.locator('.aurora-canvas').boundingBox();
  const board = await page.locator('#board').boundingBox();
  expect(frame).not.toBeNull();
  expect(board).not.toBeNull();
  expect((frame?.width ?? 0) - (board?.width ?? 0)).toBeGreaterThanOrEqual(52);
  expect((frame?.width ?? 0) - (board?.width ?? 0)).toBeLessThanOrEqual(60);
  expect(Math.abs((frame?.x ?? 0) + (frame?.width ?? 0) / 2 - ((board?.x ?? 0) + (board?.width ?? 0) / 2))).toBeLessThan(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await context.close();
});
