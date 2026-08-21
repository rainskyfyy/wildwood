import { defineConfig, devices } from '@playwright/test';
import * as fs from 'node:fs';

/**
 * Playwright E2E 配置 (M1.3)
 *
 * 设计要点:
 * - 默认从本地 mock web export 服务拉取页面,沙箱/CI 都可跑
 * - 真正的 Godot web build(M1.2 + M3.10)就绪后,通过环境变量切换
 *   WILDEWOOD_E2E_BASE_URL=http://localhost:8080(Web 服务器指向 dist/)
 *   即覆盖默认
 * - 截图按 suite 分目录归档,失败时自动重试 1 次
 * - 系统 chromium:沙箱/CI 若有 /opt/chromium.org/chromium/chrome,自动复用
 *   (避免重新下载 200MB 浏览器);若没装,回退 Playwright 自带 chromium
 * - video 关闭:沙箱/CI 不一定装了 ffmpeg;截图 + trace 已足够排查
 */
const BASE_URL = process.env.WILDEWOOD_E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const SYSTEM_CHROMIUM = '/opt/chromium.org/chromium/chrome';
const USE_SYSTEM_CHROMIUM = !!process.env.PLAYWRIGHT_USE_SYSTEM_CHROMIUM
  || (process.env.CI !== 'true' && fs.existsSync(SYSTEM_CHROMIUM));

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // mock server 单进程,串行更稳
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off', // 沙箱没装 ffmpeg,关闭 video 录制
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // 沙箱里没有 GPU,接受软件渲染
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--disable-gpu'],
      ...(USE_SYSTEM_CHROMIUM ? { executablePath: SYSTEM_CHROMIUM } : {}),
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 一次性启停 mock server;真实 Godot build 时可在 CI step 里手动启
  // webServer 在 cwd = playwright.config.ts 所在目录(即 tests/e2e/)下执行,
  // 所以路径用相对 tests/e2e/ 的形式
  webServer: {
    command: 'node mock-godot-export/serve.js',
    url: BASE_URL,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
