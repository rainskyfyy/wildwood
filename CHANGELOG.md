# 更新日志

本项目所有重要变更都会记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已计划
- M1.2 CI/CD 雏形
- M1.3 GUT + Playwright 测试框架
- M1.5-M1.11 联机三件套(网络协议 / 传输 / 会话)
- M1.14 CI 校验脚本接入

## [0.3.0] - 2026-08-20  ### M2.6 世界持久化

### Added — 分块存储
- `core/abstract/data/chunks.py`:新增 `TerrainChunk` / `InventoryChunk` 数据类
- `chunks.py`:新增切分重组工具 `split_world_modifications` / `merge_terrain_chunks` / `extract_inventory` / `inject_inventory`
- `chunks.py`:新增 chunk_id 计算工具 `terrain_chunk_id(x, y)`(16x16 tile 网格) / `inventory_chunk_id(player_id)`
- `chunks.py`:新增文件路径工具 `terrain_chunk_file_path` / `inventory_file_path` / `atomic_write_json` / `measure_save_dir_size`
- `JsonFileStore`(reference, M2.6 升级):
  - 默认 `use_chunks=True`,存档目录内分块存储:
    - `terrain/{cid}.json`(每 chunk 一个文件)
    - `profiles/{pid}_inventory.json`(玩家库存独立文件)
  - 新增 6 个分块粒度 API:`save_terrain_chunk` / `load_terrain_chunk` / `list_terrain_chunks` / `save_inventory_chunk` / `load_inventory_chunk` / `save_size_bytes`
- `MockLiteDbStore`(mock, M2.6 升级):
  - 加 `terrain_chunks` / `inventory_chunks` collection(doc_id 加 save_id 前缀以支持多 save 隔离)
  - 同样实现 6 个分块粒度 API
  - `save_size_bytes` 返回整个 db 文件字节数(mock 是单文件)

### Added — 版本迁移
- `core/abstract/data/migrations.py`:新增 `SchemaMigrator` 单例类(注册 / 链式升级 / 缺失迁移报错 / 安全防护)
- `migrations.py`:新增内置迁移函数
  - WorldState v1.0.0 → v1.1.0:加 `world_seed_hash`(从 `world_seed` 派生)
  - WorldState v1.1.0 → v1.2.0:`world_modifications` 按 16x16 切到 `chunks` 索引
  - PlayerProfile v1.0.0 → v1.1.0:加 `last_known_position`(None) + `inventory_capacity`(16)
- `_migrate_world_state` / `_migrate_profile` / `_migrate_save_game` 在 `JsonFileStore` / `MockLiteDbStore` 加载时自动检测 schema_version,跨 major 抛 `VersionIncompatibleError`,同 major 自动链式 upgrade

### Added — 跨模式
- `SaveGame.game_mode` / `clients` 字段已支持单机 / 联机 host 切换
- 跨模式 roundtrip 校验:`TestCrossModeRoundtrip` 4 个测试,覆盖 single↔host 互转不丢数据

### Changed
- `CURRENT_WORLD_STATE_VERSION`: 1.0.0 → 1.2.0(加 `world_seed_hash` + `chunks`)
- `CURRENT_PLAYER_PROFILE_VERSION`: 1.0.0 → 1.1.0(加 `last_known_position` + `inventory_capacity`)
- `CURRENT_SAVE_GAME_VERSION`: 1.0.0(不变)
- `schemas.py` 字段校验器更新:`world_seed_hash` / `chunks` / `last_known_position` / `inventory_capacity` 字段(均 Optional,旧数据不抛错)
- `JsonFileStore` 持久化时把 `world_modifications` / `chunks` 从 `world.json` 中剥到分块文件(避免双存数据漂移)

### Tests
- `tests/unit/test_m26_world_persistence.py`(M2.6 专项测试):59 个测试
  - `TestSchemaMigratorRegistration` 10 个:注册 / 链式 / 缺失迁移 / 倒退 / 循环防护
  - `TestBuiltinMigrations` 4 个:实际执行 world 1.0.0→1.2.0 / profile 1.0.0→1.1.0
  - `TestChunkIds` 3 个 / `TestSplitMergeRoundtrip` 4 个 / `TestInventoryChunkExtractInject` 2 个
  - `TestChunkFilePaths` 2 个
  - `TestJsonFileStoreChunkIO` 8 个:分块粒度 IO
  - `TestJsonFileStoreUseChunksFalse` 1 个:退化模式分块 API 抛错
  - `TestMockLiteDbStoreChunkIO` 6 个:mock 端分块粒度 IO + 多 save 隔离 + delete 清理
  - `TestCrossModeRoundtrip` 4 个:单机 / 联机 host 互转 + 跨 backend 一致
  - `TestFullSaveSizeBudget` 3 个:满存档 < 10MB + save/load 性能
  - `TestExitReenterIdentical` 4 个:roundtrip 一致性
  - `TestVersionMigrationOnLoad` 2 个:加载时自动迁移
  - `DataStoreChunkContractMixin` 6 个(ref + mock × 3 方法):跨 backend 合约
- `tests/unit/test_data_layer.py` 更新:1 个测试从 M1.4 风格的"1 个 profile 文件"改为 M2.6 分块的"1 profile + 1 inventory = 2 文件"
- 全部回归:**125 个测试通过(M1.4 66 + M2.6 59)**
- 满存档实测:JsonFileStore 1.0 MB / MockLiteDbStore 1.4 MB(都远低于 10MB 上限)
- 性能基准:save ~150ms / load ~30ms(都远低于 1s 目标)

### Docs
- `core/abstract/data/SCHEMAS.md` 加 §9"M2.6 增量 — 分块存储 + 版本迁移 + 跨模式"
- `core/abstract/data/README.md` 更新模块结构 + 跑测命令 + 验收对账
- `core/abstract/data/examples/m26_demo.py`:新增演示脚本(满存档 / 跨模式 / 版本迁移 / 跨 backend 一致)

## [0.2.0] - 2026-08-20  ### M1.4 数据层抽象接口

### Added
- A/B 通用层 1:`WorldState` / `PlayerProfile` / `SaveGame` / `ClientConnection` 数据类
- `JsonFileStore`(reference)+ `MockLiteDbStore`(mock,模拟 B 线 LiteDB 多 collection 语义)
- A/B 切换工厂 `make_store(backend, **kwargs)`,支持 env 变量 `WILDSWOOD_DATA_BACKEND`
- 66 个单元测试 + 工厂测试 + `DataStoreContractMixin` 共享合约测试

### Tests
- 66 / 66 通过(0.07s)

## [0.1.0] - 2026-08-20

### 新增
- M1.1 项目初始化:Godot 4.3 工程骨架 + Git 仓库
- 目录结构:`core/` / `scripts/` / `scenes/` / `assets/` / `tests/`
- `project.godot` 主配置(含 4.3 feature tag、WASD 输入映射、像素 snapping、6 层渲染)
- `icon.svg` 占位图标(柴火主题,待 M1.12 AI 画师替换)
- `scenes/main.tscn` + `scripts/main.gd` 主入口占位
- `.gitignore` / `.gitattributes` / `.editorconfig` 工程配置
- `LICENSE` MIT
- 各子目录 `README.md` 文档
- 本 `CHANGELOG.md`

[Unreleased]: https://example.com/wildwood/compare/v0.3.0...HEAD
[0.3.0]: https://example.com/wildwood/compare/v0.2.0...v0.3.0
[0.2.0]: https://example.com/wildwood/compare/v0.1.0...v0.2.0
[0.1.0]: https://example.com/wildwood/releases/tag/v0.1.0
