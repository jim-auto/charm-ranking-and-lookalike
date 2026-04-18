import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '../..');

const CLOSE_UP_THUMB = path.join(
  WEB_ROOT,
  'public/data/thumbnails/celeb_00573e3e.jpg',
);

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

test.describe('diagnose smoke', () => {
  test.beforeEach(({ page }) => {
    page.on('pageerror', (error) => {
      // eslint-disable-next-line no-console
      console.log(`[pageerror] ${error.message}`);
    });
  });

  test('close-up thumbnail reaches 診断完了 without 推定等身', async ({ page }) => {
    await waitForModelsReady(page);
    await uploadAndWait(page, CLOSE_UP_THUMB);
    // 等身 is no longer displayed anywhere in the diagnose flow.
    await expect(page.getByText('推定等身')).toHaveCount(0);
  });
});
