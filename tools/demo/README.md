# palette gitignore check · demo

演示 `tools/check-palette-gitignore.py` 在不同场景下的行为。

| Demo | 场景 | 预期结果 |
|---|---|---|
| 01-no-gitignore.sh | v0.7 时期：完全无 .gitignore | exit=2, 报告 "MISSING" |
| 02-partial-coverage.sh | v0.7.1a 时期：只覆盖一半 | exit=1, 列出 8 项缺失 |
| 03-character-class.sh | 字符类覆盖：只写 `*.py[cod]` 不写 `*.pyc` | exit=0, 正确识别覆盖 |
| 04-strict-mode.sh | 严格模式：基础 11 项通过但缺严格模式 20 项 | exit=1, 列出 18 项缺失 |
| 05-tracked-pollutants.sh | 真实 git 仓库：已有 .gitignore 但历史已污染 | exit=1, 扫描到 N 个已跟踪污染 |

## 运行

```bash
bash tools/demo/run_all.sh
```

## 退出码对照

| Code | 含义 |
|---|---|
| 0 | 通过 |
| 1 | 缺失必需条目 / 找到已跟踪污染 |
| 2 | 找不到 .gitignore |
| 3 | 调用错误 (参数错误等) |
