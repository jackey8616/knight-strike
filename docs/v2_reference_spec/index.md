# 國家大作戰 Game Spec - 總索引

> 基於 PTT Old-Games 板攻略文整理的遊戲規則 spec
> 原文：https://www.ptt.cc/bbs/Old-Games/M.1406646179.A.650.html

---

## Spec 檔案結構

| 檔案 | 對應原文段落 | 主要內容 |
|---|---|---|
| `victory-conditions-spec.md` | 一、三 | 國家失敗條件、關卡結算公式 |
| `game-time-spec.md` | 二 | 時間單位（day/tick）、遊戲速度、tick driver |
| `house-system-spec.md` | 四 | 建房條件、田地擴張、人口增長、稅收連通性 |
| `combat-system-spec.md` | 五 | 部隊等級 S/M/L、戰鬥規則、傷害公式、維持費 |
| `construction-spec.md` | 六 | 橋樑、柵欄、破壞建築 |
| `monster-system-spec.md` | 七 + 一 | 怪物巢穴、怪物戰鬥力、怪物殺國王特殊行為 |

---

## 模組依賴關係

```
game-time-spec
    │
    ▼
   tick (全系統的時間基礎)
    │
    ├──► combat-system-spec (每 tick 戰鬥傷害、維持費)
    ├──► house-system-spec (人口增長、田地擴張)
    ├──► construction-spec (建造進度、破壞進度)
    └──► monster-system-spec (巢穴累積)

victory-conditions-spec ◄─── 監聽各系統的結束條件
```

---

## M1 / M2 對照表

### M1 引擎已實作（推測，需對照實際 repo）

- [ ] tick driver（game-time）
- [ ] 房屋建造 + 周圍八格驗證（house）
- [ ] 房屋人口增長基本邏輯（house）
- [ ] 部隊移動 + 戰鬥觸發（combat）

### M2 規劃中

- [ ] 稅收連通性計算（house §3.2）→ 含 AI Spectator 觀察點
- [ ] 完整的等級制傷害公式（combat §4）→ 需 playtest tune
- [ ] 維持費系統（combat §5）
- [ ] 橋樑、柵欄建造（construction §2、§3）
- [ ] 怪物與巢穴系統（monster）
- [ ] 關卡結算（victory §3）
- [ ] **AI Spectator Mode 觀察點 hooks**（跨系統）

---

## 各 spec 共通的 M2 待決議題彙整

把每個 spec 末尾的「M2 待決定議題」整理在這裡，方便一次拍板：

### 數值待 tune

- 戰鬥傷害精確公式（combat §4）
- 部隊維持費公式（combat §5）
- 維持費不足時的裁員速度公式（combat §5）
- 怪物戰鬥力倍率（monster §3）
- L 級部隊破壞力公式（construction §4）
- 各建築耐久度（construction §4）
- 稅率 0%~30% 間的人口增長曲線（house §3）

### 行為待釐清

- 「敵方建設橋梁 500 金」的真實語意（construction §2）
- 柵欄是否阻擋我方自己（construction §3）
- 建造中部隊被攻擊是否中止建造（construction §5）
- 多支部隊同時接觸時的配對演算法（combat §3.3）
- 怪物部隊的 AI 行為（monster §8）
- 怪物殺國王時金錢處理（monster §4）

---

## 建議的實作順序

按依賴關係與複雜度排序：

1. **game-time**（基礎，所有系統都依賴 tick）
2. **house** 的建造 + 人口（M1 應該已完成）
3. **combat** 的等級判定 + 簡化戰鬥（先用 §3 的核心規則，§4 傷害公式之後 tune）
4. **house** 的稅收連通性（用 BFS 起步，效能優化之後做）
5. **construction** 的橋樑與柵欄
6. **combat** 的維持費
7. **monster** 完整系統
8. **victory** 完整結算

---

## AI Spectator Mode 觀察點建議

跨系統的觀察 hook 清單（M2 規劃用）：

### 房屋系統
- `house.built` / `house.destroyed`
- `house.expanded_field`
- `house.spawned_unit`
- `connectivity.recomputed`（含 before/after diff）

### 戰鬥系統
- `combat.engaged`（兩部隊接觸開始戰鬥）
- `combat.damage_dealt`（每 tick 傷害結算）
- `combat.unit_destroyed`
- `unit.starvation`（維持費不足裁員）
- `unit.elite_changed`（星星標籤轉移）

### 建設系統
- `construction.started` / `construction.completed` / `construction.aborted`
- `building.destroyed`

### 怪物系統
- `nest.accumulated`（每次 +10）
- `monster.spawned`
- `nation.consumed_by_monster`（國王被怪物殺的災難事件）

### 全局
- `tick.elapsed`
- `day.elapsed`
- `nation.defeated`
- `level.completed`

這些事件應該以 **append-only event log** 形式記錄，方便 spectator 重播。

---

## 參考資料

- 原始攻略：https://www.ptt.cc/bbs/Old-Games/M.1406646179.A.650.html
- foolwind 補充攻略：https://www.ptt.cc/bbs/Old-Games/M.1249570519.A.31D.html
- 日文 Lord Monarch 資料庫：http://www.plumfield.jp/~youichi/LordMonarch/