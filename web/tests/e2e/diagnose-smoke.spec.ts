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
      console.log(`[pageerror] ${error.message}`);
    });
  });

  test('close-up thumbnail reaches 診断完了 without 推定等身', async ({ page }) => {
    await waitForModelsReady(page);
    await uploadAndWait(page, CLOSE_UP_THUMB);
    // 等身 is no longer displayed anywhere in the diagnose flow.
    await expect(page.getByText('推定等身')).toHaveCount(0);
  });

  test('shows privacy guidance when canvas readback is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) {
        if (this.canvas.dataset.diagnosisCompatibilityProbe === 'true') {
          throw new DOMException('Blocked by privacy settings', 'SecurityError');
        }
        return originalGetImageData.apply(this, args);
      };
    });

    await page.goto('#/diagnose');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Brave Shields', { timeout: 30_000 });
    await expect(alert).toContainText('フィンガープリント防止');
  });

  test('shows upload guidance when the selected image is empty', async ({ page }) => {
    await waitForModelsReady(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'icloud-photo.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(0),
    });

    await expect(page.getByRole('alert')).toContainText('iCloud', { timeout: 30_000 });
  });

  test('shows image preparation guidance when canvas drawing fails', async ({ page }) => {
    await page.addInitScript(() => {
      const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (this.canvas.dataset.diagnosisCanvas === 'true') {
          throw new DOMException('Canvas memory limit', 'InvalidStateError');
        }
        return Reflect.apply(originalDrawImage, this, args);
      };
    });

    await waitForModelsReady(page);
    await page.locator('input[type="file"]').setInputFiles(CLOSE_UP_THUMB);
    await expect(page.getByRole('alert')).toContainText('Safari', { timeout: 30_000 });
  });
});
