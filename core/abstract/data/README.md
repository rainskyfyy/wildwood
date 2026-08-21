# core/abstract/data — Wildwood 数据层(M1.4 关键路径)

A/B 通用层 1:世界状态 / 玩家档案 / 存档 schema 全部走 JSON + 版本号,不绑引擎 API。

## 模块结构

```
core/abstract/data/
├── __init__.py         公开 API(WorldState / PlayerProfile / SaveGame / DataStore / make_store)
├── SCHEMAS.md          schema 字段文档(验收 ①)
├── schemas.py          数据类 + 校验器 + 版本号工具(验收 ②)
├── store.py            DataStore 抽象接口 + JsonFileStore(reference)
├── store_mock.py       MockLiteDbStore(mock,模拟 B 线 LiteDB 语义)
├── adapter.py          A/B 切换工厂 make_store(backend, **kwargs)
└── examples/
    └── seed_data.py    演示:reference / mock / A→B 切换
```

## 跑测试

```bash
cd wildwood
python3 -m unittest tests.unit.test_data_layer -v
# Ran 66 tests in 0.07s — OK
```

## 跑示例

```bash
python3 -m core.abstract.data.examples.seed_data
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

## 验收对账(M1.4)

| 验收标准                                | 状态    |
|----------------------------------------|---------|
| ① schema 文档                           | `SCHEMAS.md` ✓ |
| ② schema 校验器(版本号兼容判断)          | `SchemaValidator` + `is_compatible` ✓ |
| ③ reference + mock 实现各 1 份          | `JsonFileStore` + `MockLiteDbStore` ✓ |
| ④ A/B 切换 mock 适配器测试通过            | `tests/unit/test_data_layer.py::TestAdapter` 11 个测试 + `DataStoreContractMixin` 11 个共享测试 ✓ |

详细文档见 `SCHEMAS.md`。
