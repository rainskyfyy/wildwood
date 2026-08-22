# PoC-4: boss 击杀权属仲裁

**目标**:验证 boss 死亡瞬间,按「对 boss 总伤害贡献」排序,前 1 名拿到掉落物;不会出现「最后一下抢人头」。

**对应 RFC 章节**:§3.1 权威划分(boss 击杀权属)+ §6 PoC-4

## 跑法

```bash
cd docs/rfc-v0.2/pocs/poc-4-boss-kill
node index.mjs                # 跑 1000 场
node index.mjs --battles=10   # 跑 10 场
```

不依赖外部包,纯 Node.js 18+。

## 通过判据

- 1000 场中,前 1 名伤害占比始终 > 0
- 前 1 名 ≠ 最后一下施法者(模拟 30% 概率「最后一下是 DPS 最低者」)
- 总伤害累加 = 10000(无丢失)

## 回滚方案

改成「全队共享掉落池,按贡献度加权分配」(需要重新设计 inventory)。

## 关键设计

- **10000 HP boss**,4 bot 各有不同 DPS profile(随机但分布偏斜)
- 每场生成 `(DPS_A, DPS_B, DPS_C, DPS_D)`,按比例砍 boss HP
- 倒下时按 `damage_contrib` 排序,前 1 名拿 loot
- **关键反作弊测试**:30% 概率「最后一击」是 DPS 最低者,验证 loot 仍归前 1 名

## 与 RFC v0.2 接口对应

- `MonsterService.serialize`(`damageLedgerVisible=true` 仅 PoC 用)
- `MonsterService.applyDamage`(`B.G_ACTION.v1` `ATTACK`)
- `EventService.applyEvent`(`A.EVENT.v1` `BOSS_KILL`)
- `damageLedger: Record<playerId, number>` 字段(默认不下发客户端)
