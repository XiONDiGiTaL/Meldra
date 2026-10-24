import { expect, test } from '@playwright/test';

async function waitingForPlaying(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('#board')).toHaveAttribute('data-phase', 'playing', { timeout: 20_000 });
}

test('the menu exposes Solo, Together, Duel and the extra modes', async ({ page }) => {
  await page.goto('/');
  for (const mode of ['solo', 'coop', 'versus', 'endless']) {
    await expect(page.locator(`[data-mode="${mode}"]`)).toBeVisible();
  }
  await page.locator('.more-modes summary').click();
  for (const mode of ['relay', 'rift', 'architect']) {
    await expect(page.locator(`[data-mode="${mode}"]`)).toBeVisible();
  }

  await page.locator('[data-mode="solo"]').click();
  await waitingForPlaying(page);
  await expect(page.locator('.game')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-music-wanted', 'solo');
});

test('Duel creates a two-player room with its own goal and music', async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/');
  await guest.goto('/');
  await host.getByLabel('Display name').fill('Blue');
  await host.locator('[data-mode="versus"]').click();
  const code = (await host.locator('.room-code .code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{5}$/);
  await expect(host.locator('.panel-pad h3')).toHaveText('Duel');

  await guest.getByLabel('Display name').fill('Rose');
  await guest.getByLabel('Join a room').fill(code);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(guest.locator('.player-name', { hasText: 'Blue' })).toBeVisible();

  await guest.getByRole('button', { name: 'I’m ready' }).click();
  await host.getByRole('button', { name: 'Start match' }).click();
  await waitingForPlaying(host);
  await waitingForPlaying(guest);
  await expect(host.locator('html')).toHaveAttribute('data-music-wanted', 'versus');
  await expect(guest.locator('html')).toHaveAttribute('data-music-wanted', 'versus');
  await expect(host.getByText('First to 8 rows wins')).toBeVisible();
  await expect(host.locator('.player-chip .name').nth(1)).toContainText('Rose');

  const before = await host.locator('#board').getAttribute('data-board');
  await host.keyboard.press('Space');
  await expect.poll(async () => host.locator('#board').getAttribute('data-board')).not.toBe(before);
  await expect
    .poll(async () => guest.locator('#board').getAttribute('data-board'))
    .toBe(await host.locator('#board').getAttribute('data-board'));

  await hostContext.close();
  await guestContext.close();
});

test('Relay hands the single falling piece back and forth', async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/');
  await guest.goto('/');
  await host.getByLabel('Display name').fill('One');
  await host.locator('.more-modes summary').click();
  await host.locator('[data-mode="relay"]').click();
  const code = (await host.locator('.room-code .code').textContent())?.trim() ?? '';

  await guest.getByLabel('Display name').fill('Two');
  await guest.getByLabel('Join a room').fill(code);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await guest.getByRole('button', { name: 'I’m ready' }).click();
  await host.getByRole('button', { name: 'Start match' }).click();
  await waitingForPlaying(host);
  await waitingForPlaying(guest);

  await expect(host.getByText('Your turn')).toBeVisible();
  await host.keyboard.press('Space');
  await expect(host.locator('#board')).toHaveAttribute('data-turn', '1');
  await expect(guest.getByText('Your turn')).toBeVisible();
  await guest.keyboard.press('Space');
  await expect(guest.locator('#board')).toHaveAttribute('data-turn', '0');

  await hostContext.close();
  await guestContext.close();
});

test('Rift opens with the first survival wave', async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/');
  await guest.goto('/');
  await host.getByLabel('Display name').fill('Rift A');
  await host.locator('.more-modes summary').click();
  await host.locator('[data-mode="rift"]').click();
  const code = (await host.locator('.room-code .code').textContent())?.trim() ?? '';

  await guest.getByLabel('Display name').fill('Rift B');
  await guest.getByLabel('Join a room').fill(code);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await guest.getByRole('button', { name: 'I’m ready' }).click();
  await host.getByRole('button', { name: 'Start match' }).click();
  await waitingForPlaying(host);
  await expect(host.getByText('Wave 1 of 3')).toBeVisible();
  await expect(host.locator('html')).toHaveAttribute('data-music-wanted', 'coop');

  await hostContext.close();
  await guestContext.close();
});

test('Architect starts half-full and Endless has no target', async ({ page }) => {
  await page.goto('/');
  await page.locator('.more-modes summary').click();
  await page.locator('[data-mode="architect"]').click();
  await waitingForPlaying(page);
  await expect(page.getByText('Clear 10 rows from the debris')).toBeVisible();
  await expect
    .poll(async () => (await page.locator('#board').getAttribute('data-board'))?.includes('0') ?? false)
    .toBe(true);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to title' }).click();
  await page.locator('[data-mode="endless"]').click();
  await waitingForPlaying(page);
  await expect(page.getByText('Survive — no target')).toBeVisible();
});

test('the static build joins a room over the production broadcast relay', async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto('/?net=supabase');
  await guest.goto('/?net=supabase');
  await host.getByLabel('Display name').fill('Relay Host');
  await host.locator('[data-mode="coop"]').click();
  const code = (await host.locator('.room-code .code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  await guest.getByLabel('Display name').fill('Relay Guest');
  await guest.getByLabel('Join a room').fill(code);
  await guest.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(guest.locator('.player-name', { hasText: 'Relay Host' })).toBeVisible({ timeout: 15_000 });
  await expect(host.locator('.player-name', { hasText: 'Relay Guest' })).toBeVisible({ timeout: 15_000 });

  await guest.getByRole('button', { name: 'I’m ready' }).click();
  await host.getByRole('button', { name: 'Start match' }).click();
  await waitingForPlaying(host);
  await waitingForPlaying(guest);

  const before = await host.locator('#board').getAttribute('data-board');
  await host.keyboard.press('Space');
  await expect.poll(async () => host.locator('#board').getAttribute('data-board')).not.toBe(before);
  await expect
    .poll(async () => guest.locator('#board').getAttribute('data-board'), { timeout: 10_000 })
    .toBe(await host.locator('#board').getAttribute('data-board'));

  await hostContext.close();
  await guestContext.close();
});
