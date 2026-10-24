/**
 * Captures the README screenshots from a locally served build.
 *
 *   1. npm run build
 *   2. PORT=8788 STATIC_DIR=dist npm run server
 *   3. npm run screenshots
 *
 * The script only uses the same visible controls a player uses, so the images always
 * show a real session rather than injected state.
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.SHOT_BASE ?? 'http://localhost:8788';
const OUT = 'docs/screenshots';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function newPage(browser: Browser, viewport = DESKTOP, scale = 1.5): Promise<Page> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  // The lobby explainer is a real first-run aid; screenshots should not repeat it.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('meldra.settings.v1', JSON.stringify({ seenHelp: true }));
    } catch {
      /* private mode */
    }
  });
  const page = await context.newPage();
  if (process.env.SHOT_DEBUG === '1') {
    page.on('console', (message) => {
      if (message.type() === 'error') console.log('[browser]', message.text());
    });
    page.on('websocket', (socket) => {
      console.log('[ws]', socket.url());
      socket.on('framesent', (frame) => console.log('[ws >]', String(frame.payload).slice(0, 140)));
      socket.on('framereceived', (frame) => console.log('[ws <]', String(frame.payload).slice(0, 140)));
      socket.on('close', () => console.log('[ws] closed'));
    });
  }
  return page;
}

async function menu(page: Page): Promise<void> {
  await page.goto(BASE);
  await page.locator('.home-card').waitFor();
  await page.waitForTimeout(1200);
}

async function playing(page: Page): Promise<void> {
  await page.locator('#board[data-phase="playing"]').waitFor({ timeout: 20_000 });
}

/** Hard-drops one piece into the requested column, spreading the stack across the arena. */
async function dropAt(page: Page, column: number): Promise<void> {
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < column; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await page.waitForTimeout(90);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
  console.log(`saved ${OUT}/${name}.png`);
}

async function createRoom(page: Page, name: string, mode: string): Promise<string> {
  await menu(page);
  await page.getByLabel('Display name').fill(name);
  await page.locator(`[data-mode="${mode}"]`).click();
  await page.locator('.room-code .code').waitFor();
  return (await page.locator('.room-code .code').textContent())?.trim() ?? '';
}

async function joinRoom(page: Page, name: string, code: string): Promise<void> {
  await menu(page);
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Join a room').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.locator('.player-name').nth(1).waitFor();
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // --- main menu, desktop
  {
    const page = await newPage(browser);
    await menu(page);
    await shot(page, 'menu');
    await page.context().close();
  }

  // --- how to play, opened from the menu
  {
    const page = await newPage(browser);
    await menu(page);
    await page.getByRole('button', { name: 'New here? Read the short guide' }).click();
    await page.getByRole('heading', { name: 'How to play Meldra' }).waitFor();
    await page.waitForTimeout(400);
    await shot(page, 'how-to-play');
    await page.context().close();
  }

  // --- solo / endless arena with a stack in progress
  {
    const page = await newPage(browser);
    await menu(page);
    await page.locator('[data-mode="solo"]').click();
    await playing(page);
    await page.waitForTimeout(900);
    for (const column of [0, 5, 1, 4, 2, 3, 0, 5, 2, 4]) await dropAt(page, column);
    await page.waitForTimeout(700);
    await shot(page, 'solo');
    await page.context().close();
  }

  // --- co-op lobby with both players present
  {
    const host = await newPage(browser);
    const guest = await newPage(browser);
    const code = await createRoom(host, 'Nova', 'coop');
    await joinRoom(guest, 'Sol', code);
    await guest.getByRole('button', { name: 'I’m ready' }).click();
    await host.locator('.player-name', { hasText: 'Sol' }).waitFor();
    await host.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await host.waitForTimeout(500);
    await shot(host, 'co-op');
    await host.context().close();
    await guest.context().close();
  }

  // --- duel in progress, host view
  {
    const host = await newPage(browser);
    const guest = await newPage(browser);
    const code = await createRoom(host, 'Nova', 'versus');
    await joinRoom(guest, 'Sol', code);
    await guest.getByRole('button', { name: 'I’m ready' }).click();
    await host.getByRole('button', { name: 'Start match' }).click();
    await playing(host);
    await playing(guest);
    await host.waitForTimeout(700);
    for (const column of [0, 5, 1, 4, 2, 3, 0, 5]) await dropAt(host, column);
    for (const column of [5, 0, 4, 1]) await dropAt(guest, column);
    await host.waitForTimeout(700);
    await shot(host, 'duel');
    await host.context().close();
    await guest.context().close();
  }

  // --- phone layout
  {
    const page = await newPage(browser, PHONE, 2);
    await menu(page);
    await shot(page, 'mobile');
    await page.context().close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
