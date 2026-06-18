# 怪物系統規格（Monster System Spec）

> 來源：PTT Old-Games 板《球球寶貝（mona-mona）攻略文-基礎篇》by BugofBook
> 對應原文段落：七、一（特殊失敗條件）

---

## 1. 怪物來源

```
1. 關卡開始時，地圖上有預設數量的怪物
2. 新怪物從「怪物巢穴」（Monster Nest）生成
```

關卡載入時的怪物數量由關卡設計檔決定。

---

## 2. 怪物巢穴（Monster Nest）

### 2.1 與房屋的對比

| 屬性 | 房屋 | 怪物巢穴 |
|---|---|---|
| 生成單位 | 部隊 | 怪物部隊 |
| 累積值 | 房子人數 | 怪物累積數量 |
| 生成門檻 | 累積到 100 人 → 生成 100 人部隊 | 累積到 100 隻 → 生成 100 隻怪物部隊 |
| 累積速度 | 每天 `2 + 周圍田地數` 人 | **每 4 天 +10 隻**（固定） |

**含義**：
- 巢穴是穩定但較慢的生成器
- 巢穴不受稅率、田地影響
- 巢穴可被視為「無稅率、不擴張、固定產出」的特殊房屋

### 2.2 累積速度的精確值

```
每 4 天累積 10 隻
換算每天平均：2.5 隻/天
換算每 tick：1.25 隻/tick（1 天 = 2 tick）
```

**實作建議**：用整數累積，每 4 天直接 +10，不要做小數計算（簡潔且符合原作）。

```typescript
function processNestTick(nest: MonsterNest, currentTick: number) {
  // 每 8 ticks（= 4 天）累積一次
  if ((currentTick - nest.createdTick) % 8 === 0) {
    nest.accumulated += 10;
    if (nest.accumulated >= 100) {
      spawnMonsterUnit(nest, 100);
      nest.accumulated -= 100;
    }
  }
}
```

---

## 3. 怪物部隊

### 3.1 戰鬥力

```
怪物的戰鬥力比人類高。
需要用「比怪物數量多出許多」的部隊才能打倒。
```

> 攻略沒給精確倍率，但暗示 1:1 人數時人類必敗。建議實作為：

```typescript
// 怪物的有效戰鬥人數 = 實際人數 * 怪物倍率
const MONSTER_COMBAT_MULTIPLIER = 2.0; // M2 tune
function effectivePopulation(unit: Unit): number {
  return unit.isMonster
    ? unit.population * MONSTER_COMBAT_MULTIPLIER
    : unit.population;
}
```

戰鬥傷害計算改用 `effectivePopulation`，傷害結算仍扣實際人數。

### 3.2 等級判定

怪物部隊應該也適用 S/M/L 三級分類（攻略未明說，但合理推測）：

| 等級 | 怪物數量 |
|---|---|
| S | 1 ~ 999 |
| M | 1,000 ~ 9,999 |
| L | 10,000 ~ 99,999 |

---

## 4. 怪物與國王的特殊互動

當怪物打倒人類國王時，行為與「人類打倒人類國王」不同：

| 資源 | 人類打倒國王 | 怪物打倒國王 |
|---|---|---|
| 該國部隊 | 變成攻擊方所有 | **變成怪物** |
| 該國房屋 | 變成攻擊方所有 | **還原成土地** |
| 該國田地 | 變成攻擊方所有 | **還原成土地** |
| 該國金錢 | 變成攻擊方所有 | 攻略未明說，建議消失 |

> 設計後果：怪物攻破玩家國時，會把玩家領土「重置」，但同時誕生大量怪物部隊。這是場大災難。

---

## 5. 資料模型建議

```typescript
interface Monster extends Unit {
  isMonster: true;       // discriminator
  // 其他欄位繼承 Unit
}

interface MonsterNest {
  id: string;
  position: { x: number; y: number };
  accumulated: number;   // 0 ~ 99
  createdTick: number;
  durability: number;    // 建議 100（呼應累積到 100 隻的設計）
}

// 國王被殺事件的處理
function onKingKilled(event: KingKilledEvent) {
  if (event.killer.isMonster) {
    // 部隊變怪物
    for (const unit of getAllUnitsOf(event.victim)) {
      unit.isMonster = true;
      unit.owner = MONSTER_FACTION;
    }
    // 房子田地變土地
    for (const tile of getAllTerritoryOf(event.victim)) {
      tile.owner = null;
      if (tile.building === 'HOUSE' || tile.building === 'FIELD') {
        tile.building = null;
      }
    }
    // 金錢消失
    event.victim.gold = 0;
  } else {
    // 完整繼承
    transferAllResources(event.victim, event.killer);
  }
}
```

---

## 6. 戰術建議（給 AI 設計參考）

針對 AI Spectator Mode 觀察點，怪物相關的戰術觀察重點：

1. **巢穴優先級**：是否優先摧毀巢穴？以時間換戰鬥效率
2. **怪物 vs 弱國**：怪物打倒弱小敵國對玩家是好還是壞？（部隊變怪物，敵人從「會被你吞」變「會來打你」）
3. **誘導怪物**：能否用柵欄/橋樑誘導怪物去攻擊敵國？

---

## 7. 單元測試清單

### 巢穴累積
- [ ] 巢穴建立後 4 天 → accumulated = 10
- [ ] 8 天 → accumulated = 20
- [ ] 40 天 → 累積 100 → 生成 100 隻怪物部隊、accumulated 歸 0
- [ ] 怪物部隊生成位置：巢穴相鄰格

### 怪物戰鬥
- [ ] 怪物 1000 隻 vs 人類 1000 人 → 怪物勝（戰鬥力倍率）
- [ ] 怪物 1000 隻 vs 人類 2500 人（建議倍率 2.0 時的勉強勝） → 人類勝

### 怪物殺國王
- [ ] 國王被怪物殺 → 該國部隊變怪物（檢查 `isMonster` 都變 true）
- [ ] 國王被怪物殺 → 房屋田地變土地（檢查 owner 變 null、building 變 null）
- [ ] 國王被怪物殺 → 金錢歸 0
- [ ] 國王被怪物殺 → 巢穴不受影響

---

## 8. M2 待決定議題

1. **怪物戰鬥力倍率**：原文只說「比較高」，建議從 2.0 開始 tune
2. **怪物部隊的 AI 行為**：是否會主動找敵人攻擊？優先打玩家還是隨機？
3. **巢穴本身的攻擊力**：巢穴會主動攻擊嗎？還是只是孵蛋器？
4. **金錢處理**：怪物殺國王時金錢是消失還是其他處理？

---

## 9. 參考資料

- PTT 攻略原文：https://www.ptt.cc/bbs/Old-Games/M.1406646179.A.650.html