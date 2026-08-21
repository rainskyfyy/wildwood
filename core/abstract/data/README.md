# core/abstract/data — Wildwood 数据层(M1.4 关键路径)

A/B 通用层 1:世界状态 / 玩家档案 / 存档 schema 全部走 JSON + 版本号,不绑引擎 API。

## 模块结构

```
core/abstract/data/
├── __init__.py         公开 API(WorldState / PlayerProfile / SaveGame / DataStore / make_store)
├── SCHEMAS.md          schema 字段文档(验收 ①;含 M2.6 增量章节)
├── schemas.py          数据类 + 校验器 + 版本号工具(验收 ②)
├── chunks.py           M2.6 分块管理(TerrainChunk / InventoryChunk + 切分重组工具)
├── migrations.py       M2.6 SchemaMigrator(版本迁移 + 内置迁移函数)
├── store.py            DataStore 抽象接口 + JsonFileStore(reference, M2.6 分块)
├── store_mock.py       MockLiteDbStore(mock,M2.6 加 terrain/inventory collection)
├── adapter.py          A/B 切换工厂 make_store(backend, **kwargs)
└── examples/
    ├── seed_data.py    演示:reference / mock / A→B 切换
    └── m26_demo.py     M2.6 演示:满存档 < 10MB / 跨模式 / 版本迁移 / 跨 backend 一致
```

## 跑测试

```bash
cd wildwood
# M1.4 单元测试
python3 -m unittest tests.unit.test_data_layer -v
# Ran 66 tests in 0.07s — OK

# M2.6 单元测试
python3 -m unittest tests.unit.test_m26_world_persistence -v
# Ran 59 tests in 1.3s — OK

# 全部测试
python3 -m unittest tests.unit.test_data_layer tests.unit.test_m26_world_persistence
# Ran 125 tests in 0.8s — OK
```

## 跑示例

```bash
python3 -m core.abstract.data.examples.seed_data
python3 -m core.abstract.data.examples.m26_demo  # M2.6:满存档 / 跨模式 / 迁移 / 跨 backend
```

## 选 backend

```python
from core.abstract.data import make_store

# 显式
store = make_store("reference", reference_root="./data/saves")
store = make_store("mock", mock_db_path="./data/wildwood.db.json")

# 环境变量
os.environ["WILDSWOOD_DATA_BACKEND"] = "mock"
store = make_store(mock_db_path="./data/wildwood.db.json")
```

## 验收对账

### M1.4

| 验收标准                                | 状态    |
|----------------------------------------|---------|
| ① schema 文档                           | `SCHEMAS.md` ✓ |
| ② schema 校验器(版本号兼容判断)          | `SchemaValidator` + `is_compatible` ✓ |
| ③ reference + mock 实现各 1 份          | `JsonFileStore` + `MockLiteDbStore` ✓ |
| ④ A/B 切换 mock 适配器测试通过            | `tests/unit/test_data_layer.py::TestAdapter` 11 个测试 + `DataStoreContractMixin` 11 个共享测试 ✓ |

### M2.6(增量)

| 验收标准 | 实现 | 测试 |
|----------|------|------|
| ① 退出后重进世界完全一致 | `save_load` roundtrip 校验 | `test_basic_roundtrip` + `test_full_save_load_roundtrip_under_1s` + `m26_demo.py [2]` |
| ② 版本号不匹配时迁移成功 | `_migrate_*` 加载时自动迁移 | `TestBuiltinMigrations` + `test_load_v1_0_*_auto_migrates` + `m26_demo.py [4]` |
| ③ 存档 < 10MB(4 季 30 日循环满存档) | 分块存储 | `test_full_save_under_10mb_*` + `m26_demo.py [1]`(实测 1.0-1.4MB) |
| ④ 单机/联机存档格式一致 | `SaveGame.game_mode` + `clients` 字段 | `TestCrossModeRoundtrip` + `m26_demo.py [3]` |

详细文档见 `SCHEMAS.md`(M2.6 增量章节 §9)。
