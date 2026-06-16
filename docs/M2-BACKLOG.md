# M2 Backlog（M1 期間挖出的設計議題）

本文件記錄 M1 平衡 / 收斂期間發現、但**不屬於 engine bug**、由設計層處理的議題。每條附 M1.11 期間實測的數據與當時的修法嘗試結果，避免 M2 重蹈覆轍。

詳細變遷見 [`docs/PRD.md`](./PRD.md) §11.1 與 changelog v0.6–v0.10。

---

## P0 — Game Convergence

### 戰場累積機制缺失

**現象**：rule #2 採「分散擴張」模式（castle 為唯一兵源，每 5 ticks 派 50%），戰場 tile 永遠 cap 在 Soldier–low-Knight 區間。無法形成集結戰力突破 castle 防線。

**M1.11 數據**：

| 版本 | rule #2 非主城 source fire 次數（200 ticks） | 戰場 tile count 中位數 | 戰場最高 power 觀察 |
| ---- | ------------------------------------------- | ---------------------- | ------------------- |
| v0.7 | 6 | 1 | 32 (count 8 Knight) |
| v0.8 | 3 | 1 | 32 (count 8 Knight) |
| v0.9 | 3 | 1 | 32 (count 8 Knight) |

無論 castle tier 保護如何調整，戰場 tile 始終無法累積到 Queen tier power (≥ 144 在 v0.8 閾值，≥ 60 在 v0.9 閾值)。

**可能設計方向（M2 評估）**：

1. **集結點機制**：玩家 / AI 可指定某非主城 tile 為「集結點」，相鄰己方產出 / 過剩兵力自動向其流動。
2. **基地溢出規則**：castle 兵超過 X 後自動往最近的非滿格相鄰己方擴散。
3. **動態 ATTACK_RANGE_HOPS**：rule #3 射程隨己方領地連通範圍動態擴大。
4. **Castle vs castle 特殊路徑**：rule #3 對 castle source 不檢查 hops 限制，但要求 BFS 路徑全為己方 passable（要求高、觸發稀少但收斂）。
5. **AI 新增 rule：集結**：定期把多個小 stack 合併到前線一個大 stack。

### 對角 castle 互攻路徑問題

**現象**：11x11 corner 對角 manhattan = 20、相鄰 corner = 10。原始 `ATTACK_RANGE_HOPS = 4` 不可能滿足，M1.11 嘗試 4 → 8 → 12 逐步放寬，仍受限於上一條的「戰場累積問題」。

**M1.11 數據**（500-tick full run）：

| 版本 | ATTACK_RANGE_HOPS | rule #3 fires | castle take-down |
| ---- | ----------------- | ------------- | ---------------- |
| v0.8 | 8                 | 0             | 0                |
| v0.9 | 8                 | 0             | 0                |
| v0.10 | 12               | 0             | 0                |

即使 castle 升到 Queen tier 滿足戰力差條件，BFS 路徑要求中間 tile 全為己方 passable — 在 4-faction 領地 partition 後不成立。

**設計關聯**：與上一條共解。若集結機制建立 + castle vs castle 路徑特殊化，hops 可回到 v0.8 的 4 或 6。

---

## P1 — Balance（M2 中後段）

### 勢力位置不對稱

**現象**：4 corner 開局 → 對角對手 vs 相鄰對手戰術差異未驗證。M1.11 平局率 100% 也讓對戰格局無法觀察。

**M2 動作**：完成 P0 收斂機制後，重跑 `pnpm playtest --runs 100` balance 報告，依 PRD §10.4 目標收緊四勢力勝率差距至 ±10%。

### Rule #1 防禦從未 fire

**現象**：M1.11 v0.8 / v0.9 / v0.10 各跑 200 ticks，rule #1 fire 次數均為 0。trigger 條件「主城相鄰 2 格內有敵軍」實際難滿足（攻擊行動轉為 marching stack，不在相鄰格停留）。

**可能解**：
- trigger 條件改為「相鄰 3 格內有敵 marching stack 或 garrison」
- 或：rule #1 改為純規則層 hook，由戰鬥邏輯顯式呼叫

**M2 動作**：rule #1 trigger 重設計時一併考慮。

---

## P2 — Polish

### Default scenario 是否限定 11x11 4-corner

PRD §3.1 4-corner 是初稿選擇。M1.11 顯示此 scenario 對 AI 收斂有結構性挑戰。M2 可考慮：

- 7x7 default scenario：對角 manhattan = 12，rule #3 hops 8 已涵蓋。
- 3-faction default：減少 stalemate 維度。

留至 P0 收斂機制設計時一併評估。

---

## 不在本 backlog 範圍

以下屬 engine bug 已修，**不再回頭**：

- v0.6 §3.6.1 相鄰勢力空格佔領（M1.11 第一輪）
- v0.7 §3.6.1 hysteresis 防震盪（M1.11 第二輪）
- rule #2 chained expansion（v0.8 castle tier reserve 同 commit）

PRD §3.6 戰鬥公式、§3.6.1 claim、§3.7 stalemate counter 已穩定，M2 不動。
