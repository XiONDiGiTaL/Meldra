import { expect, test } from '@playwright/test';

async function waitingForPlaying(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('#board')).toHaveAttribute('data-phase', 'playing', { timeout: 15_000 });
}

test('two independent clients create, join and share one co-op arena', async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/');
  await guest.goto('/');

  // --- lobby: create and join by code
  await host.getByLabel('Display name').fill('Host');
  await host.locator('[data-mode="coop"]').click();
  const code = (await host.locator('.room-code .code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  await guest.getByLabel('Display name').fill('Guest');
  await guest.getByLabel('Join a room').fill(code);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();

  await expect(guest.locator('.player-name', { hasText: 'Host' })).toBeVisible();
  await expect(host.locator('.player-name', { hasText: 'Guest' })).toBeVisible();
  await expect(host.getByRole('button', { name: 'Start match' })).toBeDisabled();

  // The one-time explainer is dismissible and links into the full guide.
  await expect(guest.getByText('New here? A cleared row only counts as a Meld')).toBeVisible();
  await guest.getByRole('button', { name: 'Show me how' }).click();
  await expect(guest.getByRole('heading', { name: 'How to play Meldra' })).toBeVisible();
  await guest.getByRole('button', { name: 'Got it' }).click();
  await expect(guest.getByText('New here? A cleared row only counts as a Meld')).toHaveCount(0);

  await guest.getByRole('button', { name: 'I’m ready' }).click();
  await expect(host.getByRole('button', { name: 'Start match' })).toBeEnabled();
  await host.getByRole('button', { name: 'Start match' }).click();

  await waitingForPlaying(host);
  await waitingForPlaying(guest);
  await expect(host.locator('html')).toHaveAttribute('data-music-wanted', 'coop');
  await expect(guest.locator('html')).toHaveAttribute('data-music-wanted', 'coop');
  await expect
    .poll(() => host.locator('html').getAttribute('data-music-live'), { timeout: 10_000 })
    .toBe('1');
  await expect
    .poll(() => guest.locator('html').getAttribute('data-music-live'), { timeout: 10_000 })
    .toBe('1');

  // Each client sees the other player in the correct slot.
  await expect(host.locator('.player-chip .name').nth(1)).toHaveText('Guest');
  await expect(guest.locator('.player-chip .name').nth(1)).toHaveText('Host');
  await expect(guest.locator('#board')).toHaveAttribute('data-local-player', '1');

  // --- host actions reach the guest
  const initialBoard = await host.locator('#board').getAttribute('data-board');
  await host.keyboard.press('ArrowLeft');
  await host.keyboard.press('Space');
  await expect
    .poll(async () => host.locator('#board').getAttribute('data-board'))
    .not.toBe(initialBoard);
  await expect
    .poll(async () => guest.locator('#board').getAttribute('data-board'))
    .toBe(await host.locator('#board').getAttribute('data-board'));

  const scoreAfterHostDrop = await host.locator('.stat .v').first().textContent();
  await expect
    .poll(async () => guest.locator('.stat .v').first().textContent())
    .toBe(scoreAfterHostDrop);

  // --- guest actions reach the host (server-side authority confirms them)
  await guest.keyboard.press('ArrowRight');
  await guest.keyboard.press('Space');
  await expect
    .poll(async () => host.locator('.stat .v').first().textContent())
    .not.toBe(scoreAfterHostDrop);
  await expect
    .poll(async () => guest.locator('#board').getAttribute('data-board'))
    .toBe(await host.locator('#board').getAttribute('data-board'));

  // --- pause is shared
  await host.keyboard.press('Escape');
  await expect(guest.getByText('Paused')).toBeVisible();
  await host.getByRole('button', { name: 'Resume' }).click();
  await expect(guest.getByText('Paused')).toBeHidden();

  // --- both players hard-drop into a shared defeat, then rematch
  for (let i = 0; i < 45; i++) {
    if (await host.locator('.overlay').isVisible().catch(() => false)) break;
    await host.keyboard.press('Space');
    await host.waitForTimeout(60);
  }
  await expect(host.getByRole('heading', { name: 'The arena closed' })).toBeVisible({ timeout: 10_000 });
  await expect(guest.getByRole('heading', { name: 'The arena closed' })).toBeVisible({ timeout: 10_000 });
  await host.getByRole('button', { name: 'Play again' }).click();
  await waitingForPlaying(host);
  await waitingForPlaying(guest);
  await expect(host.locator('html')).toHaveAttribute('data-music-wanted', 'coop');
  await expect(guest.locator('html')).toHaveAttribute('data-music-wanted', 'coop');
  await expect(guest.locator('#board')).toHaveAttribute('data-board', /^\.+\/./);

  // --- a guest reload reconnects into the running match (invite link + token)
  await guest.goto(`/?room=${code}`);
  await waitingForPlaying(guest);
  await expect(host.getByText('Paused')).toBeHidden({ timeout: 10_000 });
  await expect
    .poll(async () => guest.locator('#board').getAttribute('data-board'))
    .toBe(await host.locator('#board').getAttribute('data-board'));

  // --- returning to the room keeps both clients in the lobby
  await host.keyboard.press('Escape');
  await host.getByRole('button', { name: 'Back to the room' }).click();
  await expect(host.getByRole('button', { name: 'Start match' })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'I’m ready' })).toBeVisible();
  await expect(guest.locator('.room-code .code')).toHaveText(code);
  await expect(host.locator('html')).toHaveAttribute('data-music-wanted', 'afterHours');
  await expect(guest.locator('html')).toHaveAttribute('data-music-wanted', 'afterHours');

  // --- the host closing the room sends the guest back to the title with a reason
  await host.getByRole('button', { name: 'Leave room' }).click();
  await expect(guest.getByRole('heading', { name: 'Different colours. One shared fate.' })).toBeVisible({
    timeout: 10_000,
  });

  await hostContext.close();
  await guestContext.close();
});

test('invalid room codes are rejected with a visible message', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Join a room').fill('ZZZZZ');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('No room answered that code', { timeout: 9000 });
});

test('mobile solo play: palette, touch controls, drag, Turkish switch and help', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/');

  // The palette preview repaints immediately when the selection changes.
  const preview = page.locator('.preview-wrap canvas');
  const canvasHash = (locator: typeof preview): Promise<number> =>
    locator.evaluate((canvas) => {
      const el = canvas as HTMLCanvasElement;
      const data = el.getContext('2d')?.getImageData(0, 0, el.width, el.height).data;
      if (!data) return 0;
      let hash = 0;
      for (let i = 0; i < data.length; i += 41) hash = (hash * 31 + data[i]) >>> 0;
      return hash;
    });
  const beforePalette = await canvasHash(preview);
  await page.getByRole('button', { name: 'Next palette' }).click();
  await expect(page.locator('.palette-name')).toHaveText('Ember');
  await expect.poll(() => canvasHash(preview)).not.toBe(beforePalette);

  // The compact landing screen still offers the guide on a phone.
  await expect(page.getByRole('button', { name: 'New here? Read the short guide' })).toBeVisible();

  await page.locator('[data-mode="solo"]').click();
  await waitingForPlaying(page);

  // The phone layout fits one viewport: no page scrolling, pads on screen.
  const touchPad = page.locator('.touch');
  await expect(touchPad).toBeVisible();
  const padBox = await touchPad.boundingBox();
  expect(padBox).not.toBeNull();
  expect((padBox?.y ?? 0) + (padBox?.height ?? 0)).toBeLessThanOrEqual(845);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);

  // Touch controls drive the game.
  const drop = page.getByRole('button', { name: 'Drop' });
  await expect(drop).toBeVisible();
  await drop.tap();
  await expect
    .poll(async () => Number(await page.locator('.stat .v').first().textContent()))
    .toBeGreaterThan(0);

  // Dragging on the arena moves the active piece without scrolling the page.
  const board = page.locator('#board');
  const pieceX = async (): Promise<number> => Number((await board.getAttribute('data-piece'))?.split(',')[2] ?? 0);
  const startX = await pieceX();
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  const before = await board.getAttribute('data-board');
  if (box) {
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.25, { steps: 8 });
    await page.mouse.up();
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  if (startX > 0) await expect.poll(pieceX).toBeLessThan(startX);

  // Turkish switch updates the running interface.
  await page.getByRole('button', { name: 'TR' }).click();
  await expect(page.getByText('Takım puanı')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duraklat' })).toBeVisible();
  await expect(board).toHaveAttribute('data-phase', /.+/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  // Pausing exposes the control guide, which documents the real controls in Turkish.
  await page.getByRole('button', { name: 'Duraklat' }).click();
  await expect(page.getByText('Duraklatıldı')).toBeVisible();
  await page.getByRole('button', { name: 'Nasıl oynanır' }).click();
  await expect(page.getByRole('heading', { name: 'Meldra nasıl oynanır' })).toBeVisible();
  await expect(page.getByText('Birbirinizin satırlarını tamamlayın')).toBeVisible();
  await expect(page.getByText('Müzik ve atmosfer')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Sıvı Kutup Işığı' })).toBeVisible();
  expect(await page.locator('.modal').evaluate((modal) => modal.scrollWidth <= modal.clientWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Anladım' }).click();
  await expect(page.getByRole('heading', { name: 'Meldra nasıl oynanır' })).toBeHidden();
  await page.getByRole('button', { name: 'Devam' }).click();

  // The arena is still live after the modal round-trip.
  await expect(page.locator('.game')).toBeVisible();
  await expect(board).toHaveAttribute('data-phase', 'playing');
  expect(before).toBeTruthy();
  await context.close();
});
