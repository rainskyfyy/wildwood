# core/utils/ — 通用工具函数

放置**不依赖 Node / SceneTree / 资源**的纯函数。便于 GUT 单测覆盖
(M1.3 验收 ① 的 target)。

## 当前内容

| 文件 | 用途 |
|---|---|
| `math_utils.gd` | 浮点容差比较、整数钳制、线性插值、二维距离平方、网格吸附、区间判断、AABB 相交 |

## 命名约定

- `class_name <Name>` 暴露为全局类(GUT 用 `MathUtils.approx_eq(...)` 直接调)
- 全部 `static func`,不持状态
- 错误用 `push_error` + 返回兜底值,不抛异常
