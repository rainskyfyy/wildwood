// Wildwood M1.10 验收 ③:浏览器 console 无错误
//
// 用 Godot 4.3 的 HTML5 export 跑,捕获 console.error / console.warn,
// 断言: 启动 30s 内 console.error = 0
//
// 沙箱内无 Godot + 无 headless 浏览器 (chromium 在沙箱里可用,但 Godot HTML5 export
// 需要 web 共享库),这个 spec 是给 CI 用的 (M1.3 Playwright 框架已就位).
//
// 用法(在 CI):
//   1. godot --headless --export-release "Web" build/index.html
//   2. python3 -m http.server 8000 --directory build
//   3. npx playwright test tests/e2e/tests/console-clean.spec.ts

import { test, expect, type ConsoleMessage } from '@playwright/test';

const SERVER_URL = process.env.WILDSWOOD_E2E_URL || 'http://127.0.0.1:8000/';

test('M1.10 验收 ③:浏览器 console 无错误 (30s 内)', async ({ page }) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() === 'error') {
            errors.push(msg.text());
        } else if (msg.type() === 'warning') {
            warnings.push(msg.text());
        }
    });

    page.on('pageerror', (err) => {
        errors.push(`pageerror: ${err.message}`);
    });

    // 1) 打开页面
    await page.goto(SERVER_URL, { waitUntil: 'load' });

    // 2) 等待 30s,期间持续观察 console
    await page.waitForTimeout(30_000);

    // 3) 断言 console.error = 0
    if (errors.length > 0) {
        console.error('M1.10 验收 ③ 失败:发现 console.error:');
        for (const e of errors) {
            console.error('  - ' + e);
        }
    }
    expect(errors.length, `M1.10 验收 ③ 失败: ${errors.length} 条 console.error`).toBe(0);

    // 警告不阻塞验收,只记录
    if (warnings.length > 0) {
        console.log(`(M1.10 验收 ③ info: ${warnings.length} 条 console.warn, 不影响验收)`);
    }
});
