"""
Wildwood 数据层 — A/B 适配器

A 线起步用 reference(JsonFileStore),B 线 mock 用 LiteDB 风格的单文件数据库。
切换方式:
  1. 显式参数:make_store("reference", reference_root=...) 或 make_store("mock", mock_db_path=...)
  2. 环境变量:WILDSWOOD_DATA_BACKEND=reference|mock
  3. 默认:reference

切换工作量(对应方案 §3.3 切换评估 4-6 周):
  - 数据层接口不变 — 调用方零修改。
  - A→B 替换:JsonFileStore -> B 线 LiteRepository 实现,不动任何业务代码。
  - 测试覆盖同一份合约(DataStoreContractMixin),reference 与 mock 共用。

CI 建议:
  - 单元测试同时跑 reference 与 mock,确保实现等价。
  - 集成测试用 reference(SQLite 风格的真实存档体验)。
  - M1.13 CI 脚本会加一个 env=mock 的快测试,用于开发期反馈。
"""

from __future__ import annotations

import os
from typing import Optional

from .store import DataStore


_BACKEND_ALIASES = {
    "reference": "reference",
    "ref": "reference",
    "json_files": "reference",
    "json": "reference",
    "a": "reference",
    "mock": "mock",
    "litedb": "mock",
    "b": "mock",
}


def make_store(
    backend: Optional[str] = None,
    *,
    reference_root: Optional[str] = None,
    mock_db_path: Optional[str] = None,
) -> DataStore:
    """
    工厂函数:根据 backend 选择 DataStore 实现。

    Args:
        backend: 显式指定 "reference" 或 "mock"(大小写不敏感,允许别名);
                 若 None 则读 env WILDSWOOD_DATA_BACKEND,再否则 default "reference"。
        reference_root: JsonFileStore 的存档根目录(必填,若选 reference)。
        mock_db_path: MockLiteDbStore 的单文件数据库路径(必填,若选 mock)。

    Returns:
        DataStore 实例。

    Raises:
        ValueError: backend 未知 / 必填参数缺失。
    """
    raw = (backend or os.environ.get("WILDSWOOD_DATA_BACKEND") or "reference").lower()
    canonical = _BACKEND_ALIASES.get(raw)
    if canonical is None:
        raise ValueError(
            f"未知 backend: {backend!r},期望 'reference' 或 'mock'(别名: ref/a/json/json_files, litedb/b)"
        )
    if canonical == "reference":
        from .store import JsonFileStore
        if reference_root is None:
            raise ValueError("JsonFileStore 需要 reference_root 参数")
        return JsonFileStore(reference_root)
    if canonical == "mock":
        from .store_mock import MockLiteDbStore
        if mock_db_path is None:
            raise ValueError("MockLiteDbStore 需要 mock_db_path 参数")
        return MockLiteDbStore(mock_db_path)
    raise ValueError(f"未实现的 backend: {canonical}")


__all__ = ["make_store"]
