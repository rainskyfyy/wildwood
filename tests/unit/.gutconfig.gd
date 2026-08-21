# GUT 9.x 命令行配置(M1.3)
#
# GUT 9.2.0+ 用此文件配置命令行模式的行为。
# 文档:https://github.com/bitwes/Gut/blob/main/docs/command_line.md
#
# 本项目只跑 GUT(不跑集成测试),集成测试走 godot --script;
# Playwright E2E 走 tests/scripts/run_e2e.sh 单独跑。

# 测试目录
dirs = ["res://tests/unit"]
# 单文件后缀
file_prefix = "test_"
# 测试方法后缀
test_prefix = "test_"
# 摘要输出
unit_test_name = "wildwood"
# 打印详细日志
verbose = false
# 失败不暂停(在 CI 中我们想要非 0 退出码)
should_exit = true
# 摘要格式
log_level = 1
# 颜色输出
color = true
