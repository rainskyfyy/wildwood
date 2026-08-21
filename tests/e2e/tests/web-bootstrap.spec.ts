import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * M1.3 验收点 ③:Playwright 能打开 Web 导出页面并截屏
 *
 * 这是 web 端 E2E 的最小可用集合,验证:
 * - 页面能加载(200)
 * - 关键 DOM 元素存在(canvas / loading / boot-status)
 * - 截图能保存(用于回归对比)
 * - 控制台无致命错误
 *
 * 真实 Godot web build 就绪后(M1.2 + M3.10),只改 BASE_URL 即可复用。
 */

const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots');

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test('web export page loads and renders canvas shell', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(`console.error: ${msg.text()}`);
    }
  });

  await page.goto('/');

  // 关键 DOM 元素校验
  await expect(page).toHaveTitle(/Wildwood/);
  const canvas = page.locator('#wildwood-canvas');
  await expect(canvas).toBeVisible();

  // canvas 实际尺寸(项目配置 1280×720)
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // boot status 在 mock 里会切到 ready
  await expect(page.locator('[data-boot-status="ready"]')).toBeVisible({ timeout: 5000 });

  // 截图(验收硬要求)
  const screenshotPath = path.join(SCREENSHOT_DIR, `web-bootstrap-${testInfo.project.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  expect(fs.existsSync(screenshotPath)).toBe(true);

  // 致命错误判定:非 mock 自报的 "load wasm" 警告
  const fatal = errors.filter((e) => !e.includes('wasm') && !e.includes('MOCK') && !e.includes('Failed to load resource'));
  expect(fatal, `unexpected page errors:\n${fatal.join('\n')}`).toEqual([]);
});

test('page meta contains viewport meta tag', async ({ page }) => {
  await page.goto('/');
  const meta = page.locator('meta[name="viewport"]');
  await expect(meta).toHaveCount(1);
  const content = await meta.getAttribute('content');
  expect(content).toMatch(/width=device-width/);
});

test('page exposes build version badge', async ({ page }) => {
  await page.goto('/');
  // M1.13 / M1.2 阶段会注入真实版本号,这里校验属性存在即可
  const version = page.locator('[data-build-version]');
  await expect(version).toHaveCount(1);
  const v = await version.getAttribute('data-build-version');
  expect(v).toBeTruthy();
});
