import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const WEB_ROOT = path.resolve(__dirname, '../..');

const CLOSE_UP_THUMB = path.join(
  WEB_ROOT,
  'public/data/thumbnails/celeb_00573e3e.jpg',
);
const FULL_BODY_CANDIDATES = [
  path.join(WEB_ROOT, 'tests/fixtures/full-body-synthetic.jpg'),
  path.join(WEB_ROOT, 'tests/fixtures/full-body-small.jpg'),
];

async function waitForModelsReady(page: import('@playwright/test').Page) {
  await page.goto('#/diagnose');
  await expect(page.getByRole('heading', { name: 'AI外見診断' })).toBeVisible();
  await expect(page.getByText('診断モデルを読み込み中')).toBeHidden({
    timeout: 60_000,
  });
}

async function uploadAndWait(
  page: import('@playwright/test').Page,
  file: string,
) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(file);
  // Either completes successfully or shows an error message.
  await Promise.race([
    page.getByText('診断完了').waitFor({ timeout: 90_000 }),
    page
      .locator('[role="alert"], .bg-red-900\\/50')
      .waitFor({ timeout: 90_000 }),
  ]);
  const errorBox = page.locator('.bg-red-900\\/50');
  if (await errorBox.isVisible()) {
    const text = await errorBox.innerText();
    throw new Error(`diagnose error banner: ${text}`);
  }
  await expect(page.getByText('診断完了')).toBeVisible({ timeout: 30_000 });
}

test.describe('等身 diagnose flow', () => {
  test.beforeEach(({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        // eslint-disable-next-line no-console
        console.log(`[browser error] ${msg.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      // eslint-disable-next-line no-console
      console.log(`[pageerror] ${error.message}`);
    });
  });

  test('close-up thumbnail does not surface 推定等身', async ({ page }) => {
    await waitForModelsReady(page);
    await uploadAndWait(page, CLOSE_UP_THUMB);
    await expect(page.getByText('推定等身')).toHaveCount(0);
  });

  test('full-body photo surfaces 推定等身', async ({ page }) => {
    await waitForModelsReady(page);

    let triggered = false;
    let lastError: Error | null = null;
    for (const candidate of FULL_BODY_CANDIDATES) {
      try {
        await page.reload();
        await expect(page.getByText('診断モデルを読み込み中')).toBeHidden({
          timeout: 60_000,
        });
        await uploadAndWait(page, candidate);
        // LookalikeResult is lazy-loaded — wait briefly for the hydrated panel.
        const etsuzen = page.getByText('推定等身').first();
        try {
          await etsuzen.waitFor({ state: 'visible', timeout: 15_000 });
          triggered = true;
          break;
        } catch (innerError) {
          lastError = innerError as Error;
        }
      } catch (error) {
        lastError = error as Error;
      }
    }

    expect(triggered, `no candidate produced 推定等身 (lastError=${lastError?.message ?? 'none'})`).toBe(true);
  });
});
