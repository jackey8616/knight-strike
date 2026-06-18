# 遊戲時間規格（Game Time Spec）

> 來源：PTT Old-Games 板《球球寶貝（mona-mona）攻略文-基礎篇》by BugofBook
> 對應原文段落：二

---

## 1. 時間單位

遊戲中存在三層時間單位：

| 單位 | 用途 | 說明 |
|---|---|---|
| 天（day） | 玩家可見 | UI 上顯示的時間單位 |
| 回合（tick） | 系統內部 | **1 天 ≈ 2 回合**，戰鬥傷害、建造進度、田地擴張等都以回合為單位計算 |
| 子回合 | 系統最底層 | 攻略推測存在但「幾乎無法測量」，**實作上可忽略** |

> ⚠️ 命名建議：把「天」叫 `day`，把「回合」叫 `tick`，避免和棋類遊戲的「回合制」混淆。

---

## 2. 遊戲速度

三段速度設定：

| 速度 | 現實時間 | 遊戲天數 | 對應 tick 速率 |
|---|---|---|---|
| 慢速（slow） | 1 秒 | 1 天 | 2 ticks/sec |
| 中速（medium） | 1 秒 | 2 天 | 4 ticks/sec |
| 高速（fast） | 1 秒 | 4 天 | 8 ticks/sec |

> 攻略用「大約」描述，實作上可作為固定常數，不需精確還原。

---

## 3. 實作建議

### 3.1 時間驅動架構

建議用 **fixed timestep + accumulator** 模式：

```typescript
const TICK_RATES = {
  slow: 2,
  medium: 4,
  fast: 8,
};

const TICK_MS = (speed: Speed) => 1000 / TICK_RATES[speed];

class GameClock {
  private accumulator = 0;
  private currentTick = 0;
  private speed: Speed = 'slow';

  update(realDeltaMs: number) {
    this.accumulator += realDeltaMs;
    const tickMs = TICK_MS(this.speed);
    while (this.accumulator >= tickMs) {
      this.tick();
      this.accumulator -= tickMs;
    }
  }

  private tick() {
    this.currentTick += 1;
    // 廣播 tick 事件給所有系統（戰鬥、建造、人口、田地擴張…）
  }

  get currentDay() {
    return Math.floor(this.currentTick / 2);
  }
}
```

### 3.2 為什麼用 fixed timestep

- 確定性：相同的 tick 序列 → 相同的遊戲狀態（對 AI Spectator Mode 的回放至關重要）
- 速度切換不影響邏輯：只改 `TICK_MS`，遊戲規則本身完全不變
- 暫停容易實作：accumulator 不前進即可

### 3.3 事件 tick 訂閱

各子系統應透過事件訂閱 tick，而不是自己跑 timer：

```typescript
clock.onTick((tick) => combatSystem.process(tick));
clock.onTick((tick) => populationSystem.process(tick));
clock.onTick((tick) => fieldExpansionSystem.process(tick));
```

---

## 4. 跟其他規格的關聯

| 規格 | 用到的時間單位 |
|---|---|
| 戰鬥傷害 | 每 tick 計算一次（§5-4） |
| 建造橋樑 | 2 ticks（§6-3） |
| 建造柵欄 | 5 ticks（§6-3） |
| 破壞建築 | 每 tick 固定損失 10 人 |
| 房屋人口增長 | 每天計算 |
| 田地擴張 | 「每隔一段時間」（攻略未精確說明，建議每 1~2 天） |
| 怪物巢穴生產 | 每 4 天增加 10 隻 |
| 部隊維持費 | 每 tick 結算（> 2000 人時） |

---

## 5. 單元測試清單

- [ ] 慢速 1 秒 = 1 天 = 2 ticks
- [ ] 中速 1 秒 = 2 天 = 4 ticks
- [ ] 高速 1 秒 = 4 天 = 8 ticks
- [ ] tick 數 → day 換算正確（tick 0~1 = day 0，tick 2~3 = day 1）
- [ ] 速度切換時，currentTick 不會跳號
- [ ] 暫停期間 accumulator 不前進
- [ ] 相同 tick 序列 + 相同初始 state → 完全相同的最終 state（determinism test）

---

## 6. 參考資料

- PTT 攻略原文：https://www.ptt.cc/bbs/Old-Games/M.1406646179.A.650.html