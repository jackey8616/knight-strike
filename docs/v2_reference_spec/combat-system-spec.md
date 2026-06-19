# 戰鬥系統規格（Combat System Spec）

> 來源：PTT Old-Games 板《球球寶貝（mona-mona）攻略文-基礎篇》by BugofBook
> 對應原文段落：五

---

## 1. 部隊等級

部隊按人數分為三個等級，UI 顯示用：

| 等級 | 人數範圍 | 說明 |
|---|---|---|
| S | 1 ~ 999 | 小隊 |
| M | 1,000 ~ 9,999 | 中隊 |
| L | 10,000 ~ 99,999 | 大軍 |

**特殊標記**：一國中**人數最多的部隊**會額外帶有「星星」標籤，作為精銳/主力標記。

> 實作上：等級可以是 derived field（從人數計算），星星標籤需要每次部隊變動時重算同國最大值。

---

## 2. 戰鬥觸發

```
兩支部隊一旦接觸 → 立即開始戰鬥
戰鬥持續到其中一方消滅為止（不可中斷）
```

**設計後果**：
- 玩家無法在戰鬥中下令撤退
- 進入戰鬥前的判斷至關重要（這是策略核心）

---

## 3. 勝負判定

### 3.1 核心原則：人數至上

```
單支部隊對單支部隊：
人數較多者必勝（即使只多 1 人也必勝）
且人數差距會在戰鬥過程中持續擴大
```

### 3.2 不能合併人數

```
兩支 25,000 人的部隊 vs 一支 40,000 人的部隊
→ 40,000 人那邊獲勝
```

**關鍵**：戰鬥是 **per-unit 1v1** 結算，**不會把同陣營部隊人數加總**。即使兩支我方部隊圍攻一支敵軍，也是各自獨立判定。

> 設計意涵：玩家不能用人海戰術，必須集中兵力。這是這遊戲很核心的機制。

### 3.3 多軍接觸的處理

攻略沒明說當 3 支以上部隊同時接觸時如何配對。建議實作：
- 一支部隊一次只跟一支敵軍交戰
- 配對規則：先到先打 / 最近距離優先（M2 需 tune）
- 旁邊的友軍部隊在沒有自己的敵人時，會自動找最近敵軍開打

---

## 4. 傷害計算

### 4.1 傷害公式

傷害由**雙方等級**和**雙方人數**決定。攻略沒給出精確公式，但給了量級的線索：

```
等級差造成的傷害差遠大於同等級內人數差造成的傷害差。

例如：
10,200 人（L 級）vs 99,800 人（M 級）的傷害差
  >>>
99,800 人（M 級）vs 99,600 人（M 級）的傷害差
```

### 4.2 傷害量級（個人心得，需驗證）

| 等級 | 每次造成的傷害量級 |
|---|---|
| S | 以 **10 人**為單位 |
| M | 以 **100 人**為單位 |
| L | 以 **1000 人**為單位 |

### 4.3 計算頻率

```
每個 tick 計算一次戰鬥傷害
```

### 4.4 公式建議（M2 待 tune）

由於攻略沒給精確數值，先用一個可調的初版：

```typescript
function calcDamage(attacker: Unit, defender: Unit): number {
  const baseUnit = {
    S: 10,
    M: 100,
    L: 1000,
  }[attacker.level];

  // 攻擊方人數越多，傷害越高（同等級內也有差異，但較小）
  const scaleWithinTier = Math.sqrt(attacker.population / TIER_MIN[attacker.level]);

  return Math.floor(baseUnit * scaleWithinTier);
}
```

> ⚠️ 這只是骨架，實際數值要靠 playtest 調整。M2 建議在 AI Spectator Mode 跑大量自動對戰來校準。

---

## 5. 部隊維持費

### 5.1 觸發條件

```
當部隊人數 > 2000 人 時，每 tick 需要支付維持費。
人數越多，維持費越高。
```

> 攻略沒給精確公式。建議實作為 `cost_per_tick = floor((population - 2000) / N)`，N 待 tune。

### 5.2 金錢不足時的後果

```
if 國庫金錢 < 維持費總額:
  部隊開始減少人數
  目標：減少到人數 < 2000（不再需要維持費）
  減少速度與部隊現有人數有關
```

**含義**：經濟崩潰時，大軍會自動「裁員」，不會直接消滅。

### 5.3 多支部隊的維持費結算

攻略沒明說，建議：
- 每 tick 把所有 > 2000 人部隊的維持費加總
- 從國庫一次扣
- 若不夠扣，每支部隊按比例減人（或從人數最多的開始減）

---

## 6. 資料模型建議

```typescript
type UnitTier = 'S' | 'M' | 'L';

interface Unit {
  id: string;
  owner: PlayerId;
  position: { x: number; y: number };
  population: number;
  isElite: boolean;           // 是否為該國最大部隊（帶星星）
}

function getTier(population: number): UnitTier {
  if (population >= 10000) return 'L';
  if (population >= 1000) return 'M';
  return 'S';
}

interface BattlePairing {
  attacker: UnitId;
  defender: UnitId;
  startedAt: TickNumber;
}

interface DamageEvent {
  unit: UnitId;
  damage: number;
  remainingPopulation: number;
  tick: TickNumber;
}
```

---

## 7. 單元測試清單

### 等級判定
- [ ] population = 1 → S
- [ ] population = 999 → S
- [ ] population = 1000 → M
- [ ] population = 9999 → M
- [ ] population = 10000 → L
- [ ] population = 99999 → L

### 星星標籤
- [ ] 國家只有 1 支部隊 → 該部隊有星星
- [ ] 國家有 3 支部隊，最大的有星星
- [ ] 最大部隊被消滅 → 星星轉移到次大部隊
- [ ] 兩支部隊人數相同 → tie-break 規則（建議：ID 較小者）

### 戰鬥勝負
- [ ] 5000 人 vs 4999 人 → 5000 人勝
- [ ] 5000 人 + 5000 人（同陣營）vs 8000 人 → 8000 人勝（不能合併人數）
- [ ] L 級 10001 人 vs M 級 9999 人 → L 級壓倒性優勢

### 維持費
- [ ] 2000 人 → 不需要維持費
- [ ] 2001 人 → 需要維持費
- [ ] 國庫不足 → 部隊減人直到 < 2000
- [ ] 多支部隊同時需要維持費，國庫剛好夠付 → 全部正常運作
- [ ] 多支部隊同時需要維持費，國庫不夠付 → 按比例減人

---

## 8. M2 待決定議題

1. **精確傷害公式**：攻略只給量級，需 playtest tune
2. **多軍配對演算法**：3 支以上部隊接觸時的配對規則
3. **維持費公式**：每 tick 多少錢，建議從原版反推或自行設計
4. **裁員速度公式**：金錢不足時減人速度與「部隊現有人數有關」，具體曲線待定

---

## 9. 參考資料

- PTT 攻略原文：https://www.ptt.cc/bbs/Old-Games/M.1406646179.A.650.html
- foolwind 補充：https://www.ptt.cc/bbs/Old-Games/M.1249570519.A.31D.html
- 日文資料：http://www.plumfield.jp/~youichi/LordMonarch/