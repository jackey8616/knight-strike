# 勝負條件規格（Victory & Defeat Conditions Spec）

> 來源：PTT Old-Games 板《球球寶貝（mona-mona）攻略文-基礎篇》by BugofBook
> 對應原文段落：一、三

---

## 1. 國家失敗條件

一個國家在以下三種情況下會「失敗」（被消滅）：

### 1.1 領土全失

**條件**：一個國家沒有房子也沒有部隊
**後果**：
- 該國消滅
- 該國的金錢消失（不歸攻擊方）
- 該國的田地保留（不會消失，但變為無主土地）

### 1.2 國王被打倒

**條件**：一國的國王被打倒
**後果**：
- 該國消滅
- 該國的金錢、房子、田地、部隊**全部變成攻擊方的**（完整繼承）

### 1.3 時間用盡（我方專屬）

**條件**：遊戲時間超過剩餘天數
**後果**：我方失敗

### 1.4 特殊：被怪物消滅國王

**條件**：怪物打倒國王
**後果**：
- 部隊變成怪物
- 房子和田地**還原成土地**（不被怪物繼承）
- 金錢的處理攻略未明說，建議實作為消失

> ⚠️ 這條和 1.2 行為不同，實作時要分支處理「殺手是玩家還是怪物」。

---

## 2. 三種失敗條件的優先順序

當同回合內多種條件同時觸發時，建議的判定順序：

1. 時間用盡（最先檢查，因為是 global 條件）
2. 國王被打倒（特殊事件，立即觸發繼承邏輯）
3. 領土全失（每回合末檢查）

---

## 3. 關卡結束時成績結算法

### 3.1 基本獎勵

每關開始時：
```
remaining_days += 3000
```

關卡結束時：
```
remaining_days -= elapsed_days  // 遊戲中經過的天數
```

### 3.2 天數減少（佔領率懲罰）

```
occupation_rate = (我方房子數 + 我方田地總數) / 所有能建造房子的土地數 * 100%
days_decrease = current_remaining_days * (100% - occupation_rate)
remaining_days -= days_decrease
```

**含義**：佔領率越低，扣得越多。100% 佔領則完全不扣。

### 3.3 天數增加（戰鬥效率獎勵）

```
battle_efficiency = (其他國家和怪物的部隊損失總數 / 我國部隊損失人數) * 100
battle_efficiency = min(battle_efficiency, 600)  // 上限 600
days_increase = battle_efficiency - 100
remaining_days += days_increase
```

**含義**：
- 戰損比 1:1 時 efficiency = 100，增加 0 天
- 戰損比 6:1 時 efficiency = 600，增加 500 天（上限）
- 戰損比 < 1:1（我方損失較多）時，efficiency < 100，反而扣天數

### 3.4 結算順序

```
1. remaining_days += 3000              // 開局獎勵
2. remaining_days -= elapsed_days      // 扣經過天數
3. remaining_days -= 佔領率懲罰        // §3.2
4. remaining_days += 戰鬥效率獎勵      // §3.3
5. 將最終 remaining_days 帶入下一關
```

---

## 4. 資料模型建議

```typescript
interface VictoryState {
  remainingDays: number;         // 剩餘天數（跨關保留）
  elapsedDaysThisLevel: number;  // 本關經過天數
}

interface NationDefeatEvent {
  nationId: PlayerId;
  cause: 'TERRITORY_LOST' | 'KING_KILLED' | 'TIME_OUT';
  killer?: PlayerId | 'MONSTER';  // 國王被誰打倒
}

interface LevelEndResult {
  occupationRate: number;        // 0~1
  battleEfficiency: number;      // 0~600
  daysDecrease: number;
  daysIncrease: number;
  finalRemainingDays: number;
}
```

---

## 5. 單元測試清單

- [ ] 國家失去所有部隊與房屋 → 觸發 TERRITORY_LOST
- [ ] 國家仍有 1 個房屋無部隊 → 不觸發
- [ ] 國家仍有 1 個部隊無房屋 → 不觸發
- [ ] 國王被玩家殺死 → 完整繼承資源
- [ ] 國王被怪物殺死 → 部隊變怪物、房子田地變土地
- [ ] elapsed > remaining → 玩家失敗
- [ ] 結算：佔領率 100% → days_decrease = 0
- [ ] 結算：佔領率 50%、剩 1000 天 → days_decrease = 500
- [ ] 結算：戰損比 1:1 → days_increase = 0
- [ ] 結算：戰損比 10:1 → days_increase = 500（受 600 上限影響）
- [ ] 結算：我方戰損多於敵方 → days_increase 為負

---

## 6. 參考資料

- PTT 攻略原文：https://www.ptt.cc/bbs/Old-Games/M.1406646179.A.650.html