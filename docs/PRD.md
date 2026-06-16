# 知識戰爭 / Knight Strike — Product Requirements Document

**Version**: v1.1
**Status**: Pruned baseline — AI work deferred; UI + 基礎機制 next round
**Changelog**:
- v0.1 — 初稿（9x9、即時 tick、Three.js）
- v0.2 — 棋盤改 11x11、技術棧改 Pixi.js、操作方案重設、戰鬥公式重做、新增 §10 Headless Playtest
- v0.3 — 行軍碰撞細則補完（同勢力合併規則、敵方碰撞三子場景）、stalemate counter 實作規格、marching stack 移除 tier 欄位、AI 短路 + RNG shuffle、主城起始 count = 3
- v0.4 — 修正 scenario 範例主城 count 為 3；AC-19 時序對齊 §3.7；補同勢力跳過戰鬥、敗北勢力 stack 行為、Tick 編號約定
- v0.5 — 修正 §3.6 範例與 AC-08：原「10 Soldier」與 §3.4 閾值矛盾（count 10 應為 Knight），改用 6 Knight vs 5 Knight 場景
- v0.6 — 新增 §3.6.1 相鄰勢力空格佔領規則；明確 §3.2 步驟 3 的兩階段 claim；補 AC-23/24/25。修復 M1.11 smoke 100% 卡 500 tick stalemate 的問題
- v0.7 — §3.6.1 補 hysteresis 規則（claim 後 3 ticks 保護期）；Province 新增 lastClaimedAtTick 欄位；新增 AC-26
- v0.8 — §4.1 Rule #2 分階累積保護避免主城被抽乾；Rule #3 ATTACK_RANGE_HOPS 4→8；§3.5.1 補 AI 派遣下限規則；新增 AC-27/28/29/30
- v0.9 — §3.4 Tier 閾值降為 5/12/25；§4.1 ATTACK_POWER_RATIO 1.5→1.0；§4.1 Rule #3 castle source 保留 5 兵；§4.1 Rule #2 castle 分階閾值同步更新；新增 AC-31/32。M1 收斂導向，戰場累積機制議題保留至 M2 再議
- v0.10 — §4.1 ATTACK_RANGE_HOPS 8→12（M1.11 最終嘗試）；最終 ship 版本 revert engine 回 v0.8 baseline；新增 §11.1/§11.2 標記 M1 收斂限制與 M1.11 acceptance band 調整；引擎不再對 11x11 corner-castle scenario 保證終結率（見 [`M2-BACKLOG.md`](./M2-BACKLOG.md)）
- v0.11 — §3.5.5 新增 Castle 自動溢出規則（`CASTLE_OVERFLOW_THRESHOLD = 30`）；§3.5.6 新增 Castle vs castle BFS hops 例外；§4.1 新增 Rule #2.5 集結（順序：威脅 → 擴張 → 集結 → 進攻 → 囤兵）；§3.2 step order 加 `castle overflow` phase（produce 之後、upgrade 之前）；新增 AC-33/34/35；§11.1 補 v0.11 解法；§11.2 把「平均場長 100–400 ticks + 結束率 ≥ 50% + 任一勢力勝率 ≤ 50%」重啟為 M2 退出條件。M2 P0 收斂導向（[`docs/M2-BACKLOG.md`](./M2-BACKLOG.md) P0、[`docs/MILESTONES.md`](./MILESTONES.md) M2.2.6–M2.2.8）
- v0.12 — 移除 §3.6.1 相鄰勢力空格佔領（含 hysteresis）。理由：v0.6 引入的「相鄰自動翻 owner」與玩家對「走過 / 打贏的格才屬於我」的直覺相違，視覺上像是領土莫名其妙就染色到鄰格、且削弱主動派遣的戰略意義。撤掉後駐紮空格 owner 翻轉**只剩** §3.5.4 的行軍 stack 抵達 claim；§3.2 step order 移除 3b claim phase；AC-23/24/25/26 刪除。`Province.lastClaimedAtTick` 欄位於 PRD 失去語意，engine schema 可同步清掉（細節不在本文件範圍）。**收斂風險**：§3.6.1 v0.6/v0.7 的補強作用消失，M2.2.8 acceptance 若失守需回頭調 v0.11 P0 機制（§3.5.5 / §4.1 rule #2.5 / §3.5.6 參數）而非復活 §3.6.1。
- v1.0 — **重大 scope 重設**：把 AI 設計（PRD §4 規則、§3.5.5 castle overflow、§3.5.6 castle vs castle 例外、§10 playtest balance 重心、§11 收斂限制）整段移出本 PRD，等 UI + 基礎機制建好後再回頭重寫。本次也順手砍 AI 相關 AC：AC-15（AI 30-tick 擴張）、AC-22（AI RNG 確定性）、AC-27..AC-35（rule #2 castle 分階保護 / rule #3 距離+reserve+派遣量 / castle 溢出 / rule #2.5 集結 / castle vs castle BFS 例外）。**Engine 程式碼層 `src/engine/ai.ts` / `ai.test.ts` / `overflow.ts` / `overflow.test.ts` / `src/playtest/runner.ts` 的 AI 分類邏輯與 spectator-4ai scenario 保留在 repo 內**，但屬「規格 orphan」狀態：對應的 PRD 章節已不存在、不在 v1 acceptance 內、未來 AI 重啟時必跟新規格對齊（程式碼不保證直接可用）。pre-prune 完整 v0.12 快照見 git tag `archive/prd-v0.12` (commit `5714dc5`)。本 v1.0 是「UI + 基礎機制」次輪設計的起點 baseline，**不是**最終 v1.0 release。
- v1.1 — **戰鬥模型徹底重做**：§3.6 整段改寫為「count-only 互相抵銷 + per-pair ramp」。Tier 倍率（Soldier=1 / Knight=4 / Queen=12 / King=30）從戰鬥結算移除，tier 退回純視覺與升級階級。每對相鄰敵我格維護一個 `engagementTicks` 計數器：相鄰的第 0 個 tick 不傷害、之後每 tick 雙方各扣 `2^(engagementTicks - 1)`；pair 不再相鄰（任一方清空 / 易主 / 行軍走開）→ counter 丟棄，重新相鄰從 0 重數。§3.7 stalemate / drain 整節移除（新公式 ramp 已內建消耗，drain 失去意義）；`StalemateMap` / `stalemateTicks` / `applyDrainDeductions` 對應 engine 物件改名為 `EngagementMap` / `engagementTicks` 並併入 §3.6 結算階段。§3.5.4 #4 / #5 頭對頭碰撞改為一次性 `engagementTicks = 1` 結算（雙方各 -1，不建立持續 pair）。§3.2 step order 拿掉 `drain` 步驟。AC-08 / AC-17 / AC-19 對應重寫。設計意圖：(a) tier 抗打 / 輸出乘法的耦合在玩家層體感不明顯，反而讓低 count 大量壓制變得無解；移除後戰鬥是純粹的「人數抵銷 + 拖久爆炸」；(b) ramp 暴力收斂，永遠不會出現對峙打不死的爛尾。**收斂風險**：原 §3.7 / §3.5.5 / §3.5.6 的補丁價值消失，但 ramp 本身就保證 pair 在 log₂(count) 個 tick 內結束，比 stalemate drain 更強的收斂，AI 重啟時要重審「ramp 是否會在 index 3+ 之後莫名互滅造成不可控翻盤」。

## 1. 願景與背景

重製日本免費小品《国家大作戦》(lm_exp, 2005 年前後)，以 Web 技術交付。45° 斜俯視棋盤、像素風角色、即時 tick 戰棋。**最終願景**：單場 12–20 分鐘內結束的中節奏對 AI 戰；**v1.0 中繼目標**：先把 UI + 基礎機制（操作流暢、視覺回饋、規則一致）做穩，AI 行為等次輪 PRD 重新設計後再導入。

**Tech Stack**：Vite + TypeScript + **Pixi.js v8** + GSAP。

> **技術棧決策**：原 scaffolding 使用 Three.js + OrthographicCamera 把 2D sprite 放進 3D 空間，是把 2D 遊戲用 3D 引擎硬幹。本作所有玩法都在 2D 格網上發生（45° iso 只是視覺投影），改用 **Pixi.js v8** 更貼合需求：原生 2D sprite、內建 pixel-perfect 渲染、輸入事件 API 直接 hit-test 格子、bundle 更小、無 3D camera 帶來的 orbit/drag 衝突。GSAP 留作 tween 引擎驅動 Pixi 物件動畫。既有 scaffolding（state / faction / province 純資料層）保留，rendering / input 層重寫。

## 2. 名詞表

- **Tick**：遊戲時鐘最小單位，2 秒 / tick。所有產兵、移動、戰鬥都在 tick 邊界結算。
- **Tile / Province**：棋盤上的一格，是所有權與單位的最小單位。
- **Stack**：駐紮在同一格的單位群，由 `(tier, count)` 表示。
- **Marching Stack（行軍 stack）**：派遣後沿路徑移動的暫態單位群，獨立於格上駐紮 stack。
- **Tier**：單位階級 —— Soldier / Knight / Queen / King。
- **主城 (Main Castle)**：每個勢力的核心，失守即敗。
- **Engagement counter (`engagementTicks`)**：每對相鄰敵我格獨立維護的 ramp 計數器（§3.6）；驅動戰鬥傷害指數成長。

## 3. 玩法核心

### 3.1 棋盤與勢力

- **11x11** 方格。主城置於四角（座標 `(0,0) / (10,0) / (0,10) / (10,10)`）。
- 4 個玩家勢力（Tokugawa / Takeda / Oda / Uesugi），各佔據一個角落主城。
- Neutral 勢力佔據地圖中央 1–3 格山賊據點，不產兵但可被任何勢力佔領（佔領後變為己方一般領地）。Neutral 山賊起始 count = 3（與主城同 Soldier tier，無威脅但需 1–2 次派遣才能掃除）。
- 玩家固定操作 Tokugawa。其餘三勢力的控制方式（自動 AI / 完全靜默 / scripted 演示）在 v1.0 未定，等次輪 PRD 重新指定。

### 3.1.1 開局起始 count

| 位置                  | 起始 count | tier    | 派生 power |
| --------------------- | ---------- | ------- | ---------- |
| 各勢力主城            | **3**      | Soldier | 3          |
| 一般空格              | 0          | —       | 0          |
| 中央 1–3 個 neutral 點 | 3          | Soldier | 3          |

**決策理由**：
- 起始 3 < Knight 閾值 5 → 開局是 Soldier 對 Soldier，戰力對稱。
- 主城每 4 ticks +1，從 3 升到 Knight (5) 需 **8 ticks = 16s**；玩家有明確「第一個升級里程碑」可感受節奏。
- 主城下限 1 兵的保護下，起始 3 允許首派最多 2 兵出去探路或夾擊 neutral，不至於整局只能囤兵。
- 起始太低（0 或 1）→ 開局 30s 之內什麼都做不了，無聊。
- 起始太高（≥5 已是 Knight）→ 早期戰力跨閾值，可能造成一波殺光的非預期翻車（v0.12 期 AI rule #3 觀察結果，原則保留）。

### 3.2 即時 Tick 引擎

- 全域時鐘以 **2 秒 / tick** 推進。HUD 顯示當前 tick 數與下一 tick 倒數。
- **Tick 編號約定**：Tick 0 為初始狀態（僅渲染、無結算）。Tick 1 起執行下述六步結算順序。產兵於 tick 2 首次觸發（「每 2 ticks +1」= tick 2, 4, 6, ...）。v0.12 期間還規範了四家 AI 的評估偏移（Tokugawa tick 1、Takeda tick 2 等，每 5 ticks 一次），隨 §4.3 一併移出 v1.0；`engine/ai.ts` 的 `shouldEvaluate` 程式碼仍存在但屬規格 orphan。
- 暫停 / 繼續 / 變速 (1x / 2x) 支援；變速影響 tick 實際間隔。
- 每個 tick 結算順序固定：
  1. 移動推進（每 tick 沿路徑前進 1 格，包含 marching stack 入格、stack-collision 判定、與行軍抵達 claim — 由 §3.5.4 規則處理）
  2. 戰鬥傷害結算（同步，含駐紮 vs 駐紮、駐紮 vs 行軍、行軍 vs 行軍）+ §3.6 engagement counter 推進
  3. 主城被佔判定：遭佔領主城觸發該勢力敗北（§6.3）
  4. 產兵（主城）
  5. 升級判定（count 跨過閾值即時推導 tier）
  6. 勝負判定

> 完整 step order（v1.1）：`movement (含 §3.5.4 行軍抵達 claim) → combat (含 §3.6 ramp counter 推進) → defeats → produce → victory`。v1.0 的 `drain (§3.7)` 階段隨 §3.7 一併於 v1.1 移除（counter 推進已併入 combat 階段、本身就用 ramp 取代 drain 的收斂角色）。駐紮空格不再有「相鄰自動 claim」phase（§3.6.1 於 v0.12 移除），owner 翻轉**只**在行軍 stack 真正進駐該格時發生。Castle overflow（v0.11 §3.5.5）隨 AI 一併移出 v1.0 PRD —— engine `applyCastleOverflow` 仍會在 produce 之後被呼叫（程式碼層面實作存在）但因 v1.0 沒有自動把 castle 推到 > 30 的 AI / 玩家邏輯，實際上不會 fire。

### 3.3 城堡與產兵

- **主城**：每個勢力 1 座，固定在棋盤角落。每 2 ticks (= 4s) 在城堡格 `count + 1`；若敵軍佔領則停止產兵，所有權變更為佔領方，但**佔領主城 = 該勢力立即敗北**。
- **子城（future scope）**：MVP 不含；保留 `Province.isCastle` 介面供日後擴充。
- 一般領地：不產兵，佔領僅用於擴張勢力範圍與切斷敵方路徑。
- **空但仍屬己方的格子**：count = 0 但仍歸某勢力所有 → 維持所有權直到有敵方單位進入。

### 3.4 單位、Stack 與升級

- 每格的單位狀態為 `(tier, count)`，整格作為一個單位顯示。
- Tier 由 count 推導（純函數，無狀態）：
  - `count < 5` → Soldier
  - `5 ≤ count < 12` → Knight
  - `12 ≤ count < 25` → Queen
  - `count ≥ 25` → King
- Tier 升級 / 降級為**隱含結果**：count 變動後即時更新 tier。畫面上顯示對應 sprite + 數字。
- 同一格只能由單一勢力擁有；不同勢力進入同一格 = 戰鬥而非合併。

> 閾值 5 / 12 / 25 沿用 v0.9 的數字。原始決定理由（v0.8 playtest 戰場累積天花板觀察）依賴 AI 規則行為，已隨 AI 整段移出 v1.0；v1 acceptance 不再用 AI 收斂去倒推這幾個閾值。等 UI + 基礎機制次輪 PRD 重新看玩家體感後再決定要不要調整。

### 3.5 移動、派駐、路徑、行軍碰撞

#### 3.5.1 派遣手勢（左鍵 hold-drag）

- 玩家在**己方任意格**按下左鍵，拖到**目標格**放開：派遣該格的單位前往目標。
- 拖曳過程：畫一條從來源到目標的高亮路徑（BFS 最短路徑）；若無路徑則顯示紅色不可派遣提示。
- 派遣比例滑桿（25% / 50% / 75% / 100%，記憶上次選擇，預設 100%）。最少派遣 1 兵。
- **主城派遣下限**：主城作為來源時，無論滑桿選何比例，**至少留下 1 兵**。例如主城 count = 10 且選 100%，派遣 9、留 1。若 count = 1 則無法派遣。
  - 設計意圖：避免玩家不小心把主城清空、立刻被相鄰格反吃。
  - v0.12 期間還細分了 AI rule #2 / #3 各自的 reserve 規則（Knight 5 / Queen 15 / 主城進攻 reserve 5 等），隨 §4 一併移出 v1.0；engine `dispatch()` API 仍保留 `forceCount` escape hatch 給未來 AI 規格重啟使用。

#### 3.5.2 路徑規則

- 路徑用 BFS 搜尋，passable = 己方格 + 空無主格（neutral 且 count = 0）。
- **目標格允許為敵方**（攻擊行動）：目標格本身不需要 passable，但中間經過的所有格必須 passable。
- 目標格為己方 → 合併補充。
- 目標格為空 → 佔領。
- 目標格為敵方 → 抵達瞬間轉為攻擊（見 3.5.4）。
- 無路徑：來源與目標被敵方完全切斷且非相鄰時，顯示紅線拒絕派遣。

#### 3.5.3 行軍 stack 行為

- 派遣瞬間從來源格扣除對應 count，建立獨立 marching stack：

  ```ts
  type MarchingStack = {
    id: string;                 // 唯一 ID（用於 collision tiebreak）
    faction: FactionId;
    count: number;              // tier 不存欄位，由 deriveTier(count) 即時推導
    path: Tile[];               // BFS 計算的整條路徑（含起點與終點）
    idx: number;                // 當前位置 = path[idx]，下 tick 移到 path[idx+1]
    dispatchedAtTick: number;   // 派遣時 tick 數，§3.5.4 規則 #2 tiebreak 用
  };
  ```

- **tier 不存欄位**：渲染（選擇 sprite）由 `deriveTier(count)` 即時推導。原因：避免 stack 合併 / 受傷時忘記同步 tier 造成 bug；單一資料源 = count。v1.1 起戰鬥不再用 power 派生值（§3.6 完全以 count 結算），tier 退回純視覺意義。
- 每 tick 沿 `path` 前進 1 格（`idx++`）。
- Marching stack 不佔據格子所有權，渲染為小型移動 sprite 沿路徑跑動。
- 抵達 path 終點（`idx === path.length - 1`）時觸發 §3.5.4 的抵達結算。
- 剩餘步數 = `path.length - 1 - idx`。`0` = 此 tick 已抵達終點。

#### 3.5.4 行軍碰撞與抵達規則

當多個 stack 在同一 tick 進入同一格 / 相鄰格時，依下列順序處理（**原子性，所有發生於同 tick 的事件同步結算後寫回**）：

1. **同勢力 marching stack 進入己方駐紮格**：合併 count，若該格非派遣終點，marching stack 繼續沿原路徑。
2. **同勢力多個 marching stack 同 tick 進同一格**：合併為單一 stack（count 加總），合併後的 path 依下列順序決定：
   - **若任一參與合併的 stack 以此格為終點**（即 `idx === path.length - 1`）→ 合併後 stack 停留在此格，作為駐紮 stack 入駐（或合入既有駐紮 stack）。
   - **否則**取「**剩餘步數最少**」（`path.length - 1 - idx` 最小）的 stack 的剩餘路徑作為合併後 path。
   - **Tiebreak**：剩餘步數相同 → 取 `dispatchedAtTick` **較早者**（先派遣優先）。再相同 → 取 `id` 字典序較小者（完全確定性）。
3. **同勢力 marching stack 抵達空格 / neutral 空格（非戰鬥）**：放下停留，所有權轉為該勢力，count 入駐。
4. **敵方 marching stack 同 tick 進同一格**：**頭對頭碰撞**，視同 §3.6 `engagementTicks = 1` 的一次性結算 —— **每對 (i, j) 對 i 各扣 1**（多方 3+ 碰撞時 i 扣 (參與者數 - 1)）。**不**建立持續 pair、**不**寫入 EngagementMap（碰撞是 transient 事件，下 tick 就解散）。倖存方行為依**雙方是否以此格為終點**分三子場景：

   | 子場景                              | 倖存方（count > 0）行為                                                      |
   | ----------------------------------- | ---------------------------------------------------------------------------- |
   | **(a) 雙方皆終點**                  | 倖存方停留在此格、入駐並轉所有權；另一方歸零 → 該格歸倖存方                  |
   | **(b) 雙方皆非終點**                | 倖存方繼續沿原路徑（`idx++` 已在 tick 推進階段完成）；該格仍是原所有權       |
   | **(c) 混合：一方終點 / 一方路過**   | 倖存方若為「終點方」→ 停留入駐；若為「路過方」→ 繼續其原路徑、不入駐此格    |

   雙方歸零（同歸於盡）：該格保持原所有權、無單位入駐、無人繼續行軍。

5. **敵方 marching stack 與敵方駐紮 stack 同 tick 抵達同格**：駐紮方視為「終點方」參與 §3.6 `engagementTicks = 1` 結算（**雙方各扣 1，一次性，不寫入 EngagementMap**）。倖存方依 #4 (c) 子場景判斷：駐紮方倖存 → 留下；marching 方倖存且為終點 → 取代所有權留下；marching 方倖存且非終點 → 繼續原路徑、該格成為空格（無 count）。
6. **路徑經過格被敵方臨時切入（敵方剛佔下中間格）**：marching stack 停在前一格（`idx` 不再前進），下 tick 從相鄰格觸發 §3.6 戰鬥；不自動繞路（MVP 簡化，列入 future scope）。

> 規則設計原則：所有同 tick 事件先計算「將發生什麼」（dry-run），再同步寫回，避免順序依賴造成 bug。

> **§3.5.5 / §3.5.6（已移除，v1.0）**：原 v0.11 加入的 castle 自動溢出與 castle vs castle BFS hops 例外，皆為 AI 收斂機制的補強。AI 部分整段移出 v1.0 後一併下線；engine `src/engine/overflow.ts` 程式碼仍在 repo 內但 PRD 已不規範其行為，未來 AI 重啟時要重審規格。完整 v0.12 描述見 git tag `archive/prd-v0.12`。

### 3.6 戰鬥公式（v1.1 — count-only + per-pair ramp）

**結算對象**：每對**相鄰的敵我格**（owner 不同、雙方 count > 0；駐紮 vs 駐紮、駐紮 vs 行軍駐紮的同格組合）。同勢力相鄰格（含 NEUTRAL 之間）自動跳過。頭對頭行軍碰撞另見 §3.5.4 #4 / #5（用 ramp tick 1 一次性結算，不寫入 counter）。

**每對 pair 維護一個 `engagementTicks: number`**（key = `pairKey(tileA_id, tileB_id)`，小座標在前；無向）。初次出現於本 tick `combatPairs` 時 counter 為 0。

**每 tick 結算順序（同步、dry-run，所有 pair 同時讀寫）**：

```
prev   = engagementMap.get(key) ?? 0
damage = prev === 0 ? 0 : 2 ** (prev - 1)
new_count(a) = max(0, count(a) - sum_over_pairs(a)(damage))
new_count(b) = max(0, count(b) - sum_over_pairs(b)(damage))
next   = prev + 1
engagementMap.set(key, next)
```

- **Tier 不參與戰鬥**：v1.1 起完全用 `count` 結算，`POWER_PER_TIER` / `power = count × tier_multiplier` 派生值整套移除。Tier 仍由 `deriveTier(count)` 即時推導，但只用於 sprite 顯示與升級階級語意。
- **Ramp 節奏**：相鄰的第 0 個 tick (`prev === 0`) 不造成傷害（給玩家視覺上的「對峙開始」反饋）；第 1 tick 各扣 1；第 2 tick 各扣 2；第 n tick 各扣 `2^(n-1)`。Counter 永遠 +1，不會因任何條件重置。
- **多敵相鄰累加**：若一格同時與 k 個敵方相鄰格成對，本 tick 受到 k 個 pair 各自 `damage` 累加扣除（再 clamp 至 0）。每對 pair 的 counter 獨立推進。
- **Pair 解散 = counter 丟棄**：若某 pair 不在本 tick `combatPairs` 中（任一方 count 歸零 / 易主 / 行軍走開 / 非相鄰），其 key 不寫入 next map → counter 被丟棄。日後該 pair 再度出現 → 從 0 重數。
- **Count 降到 0** = 該格清空（仍保留所有權直到敵方進入）。Count 變動後立即重新推導 tier。

**佔領**：若某格被清空後，下一 tick 有相鄰己方單位（含派遣抵達者），則該格所有權轉為該勢力，count 累加駐入。**注意**：被清空的格子 owner 不變，因此**不會**與原 owner 的鄰格組成 §3.6 pair；但**會**與其他敵方鄰格繼續配對嗎？不會，因為配對要求**雙方 count > 0**。

**範例計算（AC-08 driver）**：

- 場景：6 Knight (count 6) 與 5 Knight (count 5) 相鄰，初始 engagementMap 不含此 pair。
- tick 1：`prev = 0`，`damage = 0`，雙方 count 不變 (6, 5)；counter 寫入為 1。
- tick 2：`prev = 1`，`damage = 1`，雙方各扣 1 → (5, 4)；counter = 2。
- tick 3：`prev = 2`，`damage = 2`，各扣 2 → (3, 2)；counter = 3。
- tick 4：`prev = 3`，`damage = 4`，各扣 4 → (max(0, 3-4), max(0, 2-4)) = (0, 0)；counter = 4。
- tick 5：雙方 count = 0，pair 從 combatPairs 移除 → counter 丟棄。

**設計意圖**：
- 戰鬥是純粹「人數抵銷」，玩家直覺更清楚（5 vs 7 = 7 留 2，不需要心算 tier 倍率）。
- Ramp 在 `O(log₂(count))` 個 tick 內強制終局，不可能爛尾。同時前 1–2 個 tick 傷害低，留出玩家派援軍 / 撤退的反應窗口。
- 移除 tier 倍率後，King vs Soldier 不再質變壓殺，戰場累積天花板由 §3.4 升級閾值（5/12/25）與產兵速度（§3.3）控制，不再由戰鬥公式本身擔保。

**實作層規格（engine）**：

```ts
type PairKey = string;       // pairKey(a, b)：小 TileId 在前
type EngagementMap = ReadonlyMap<PairKey, number>;

type CombatPair = {
  readonly a: TileId;        // pair key 排序後的 a
  readonly b: TileId;
  readonly damage: number;   // 本 tick 雙方各受的傷害（dry-run 對稱）
  readonly engagementTicks: number;  // 本 tick 使用的 prev counter（用於 event log / 觀測）
};

type CombatResult = {
  readonly state: GameState;             // 已套用傷害與寫入新 engagementMap
  readonly pairs: readonly CombatPair[]; // 本 tick 結算的 pair 列表
};
```

- `resolveAdjacentCombat(state)` 同時推進 counter 並套用傷害；v1.0 期 `updateStalemates` / `applyDrainDeductions` 兩個分離函數一併移除，併入 §3.6 單階段結算。
- 寫入 next counter 規則：**只有本 tick 雙方 count 仍 > 0 的 pair** 才寫入下一個 counter（pair 仍存在）；任一方歸零 → 不寫入（pair 解散）。
- Pair 不在本 tick `combatPairs` 中（已解散）→ 自動從 `nextMap` 移除（同 v1.0 行為，語意不變）。

> **§3.6.1（已移除，v0.12）**：原「相鄰勢力空格佔領（adjacent claim）」規則於 v0.12 撤回。駐紮空格的 owner 翻轉**只**由 §3.5.4 的行軍 stack 抵達觸發。設計理由與收斂風險見 changelog v0.12 與 §11.1。

### 3.7 弱勢平衡（已移除，v1.1）

> v1.0 期 §3.7 的 `stalemateTicks` counter + drain mode（5 tick 後雙方每 tick 各扣 1）已隨 §3.6 戰鬥公式整套重做於 v1.1 撤除。新公式本身就是 ramp 收斂機制（`damage = 2^(n-1)`），任何持續對峙的 pair 都在 `O(log₂(count))` 個 tick 內結束，原 drain 補丁失去意義。
>
> 對應 engine schema 變更：`state.stalemates: StalemateMap` → `state.engagements: EngagementMap`；`STALEMATE_DRAIN_THRESHOLD` / `updateStalemates` / `applyDrainDeductions` 全部移除，counter 推進併入 `resolveAdjacentCombat`。
>
> 完整 v1.0 §3.7 描述見 git tag `archive/prd-v1.0`（若有打 tag）或本檔案 v1.0 commit。原 AC-19 對應的 3v3 drain 驗證已在 v1.1 改寫為 ramp 收斂驗證（見 AC-19）。

### 3.8 幾何 / 距離 / 邊界（v1.0 形式化）

v0.12 以前 §3.5 / §3.6 / §3.7 多處用「相鄰」、「鄰格」、「距離」等詞，沒在單一節點集中定義；v1.0 把這些基礎約定明文化，避免將來新規則（AI 重啟、地形效果、子城等）出現定義分歧。

- **鄰格（Adjacency）= 4-connected**：tile `(x, y)` 的鄰格是 `(x±1, y)` 與 `(x, y±1)` 共 4 格。**不含對角**（`(x±1, y±1)` 不算鄰格）。這條 §3.5.2 路徑 BFS、§3.6 戰鬥配對（含 engagement counter pair）全部沿用，視覺上的 45° iso 投影**只影響渲染、不改變邏輯距離**。
- **距離（Distance）= Manhattan**：`d((ax, ay), (bx, by)) = |ax−bx| + |ay−by|`。配合 4-conn 鄰格，BFS 跳數 = Manhattan 距離（在無障礙時），實際 BFS 跳數 ≥ Manhattan（有 passable 限制時）。
- **棋盤邊界**：`0 ≤ x < boardSize`、`0 ≤ y < boardSize`。鄰格落在邊界外 = 不存在（既不參與 BFS 也不參與戰鬥配對）。
- **派遣路徑（Player）**：玩家拖曳派遣**沒有 hop 上限**，只要 BFS 找得到一條 §3.5.2 passable 路徑就可派遣，無論距離多遠。v0.12 期間 AI rule #3 `ATTACK_RANGE_HOPS = 8` 是 AI 戰術上的自限，與玩家無關，v1.0 隨 AI 一併下線；engine `findPath` API 本身就不檢查 hops。
- **同格定義**：同一 tile id 的兩 stack（駐紮 + 行軍抵達 / 兩條行軍同時抵達）視為「在同格」，走 §3.5.4 規則。**不存在「同格但不同 sub-cell」**：每 tile 一個 owner、一個 count、一個 tier，整格為單位。

> 設計理由：先把這些寫成 PRD 條目，未來改棋盤大小、改派遣 UI、改路徑視覺化、引入地形效果，都有單一 source of truth 可指。

## 4. 非玩家勢力控制（v1.0 暫定，AI 規格 deferred）

v0.12 期間 §4 規定四家勢力都有 AI 自動派兵、生產；v1.0 把 AI 設計 deferred 後，**非玩家勢力的控制模式**由 scenario JSON 的 `aiConfig` 欄位指定，採以下兩種模式之一：

| 模式         | 行為                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| `"idle"`     | 該勢力**完全靜默**：不評估、不派兵、不主動移動。主城仍依 §3.3 自動產兵（count 自動 +1），但派遣需 scripted 或人類操作（v1.0 沒有 UI 給非玩家勢力，所以實際上 idle 勢力的 count 會在主城無限累積，直到被別人攻入）。 |
| `"scripted"` | 該勢力**只聽 scenario JSON 的 `scriptedCommands`**：在指定 tick 觸發指定派遣，其餘時間 idle。產兵照常。 |

- v0.12 期間第三種模式 `"default"` (跑 §4.1 AI 規則狀態機) 在 v1.0 **technically 仍可用**（engine `stepAi` 程式碼還在），但**不在 v1 acceptance 範圍**；任何用 `"default"` 跑出來的行為觀察都不能當作 v1 對 PRD 的符合性證明。
- 玩家固定操作 **TOKUGAWA**；其餘三家在 v1.0 預設場景 (`src/scenarios/default.json`) 一律 `"idle"`，等次輪 PRD 重新設計 AI 後再切回 `"default"`。
- Scripted 模式給未來想做「教學關卡」、「指定挑戰」用；v1.0 的 manual smoke 場景可以用 scripted 餵假對手測試 dispatch UI。

完整 v0.12 AI 規格見 git tag `archive/prd-v0.12`。重啟 AI 設計時建議從 [`docs/M2-BACKLOG.md`](./M2-BACKLOG.md) P0 議題回看。

## 5. 視覺與 UI

### 5.1 視覺風格

- **45° 斜俯視角**（Pixi.js 2D 容器，靠 sprite 偏移與深度排序實現 iso 視覺）。
- **像素風**：Pixi `Texture` 使用 `SCALE_MODES.NEAREST` + `roundPixels: true`；建議單位 sprite 32x32 或 48x48 px。
- 整數縮放（1x / 2x / 3x）避免次像素糊化。
- 4 勢力色：紅 / 藍 / 綠 / 黃；Neutral 灰。
- 格子 hover 高亮（半透明白色 overlay）、selection（金黃 outline）。
- 派遣拖曳路徑：半透明同勢力色虛線 + 終點箭頭。
- 戰鬥動畫：兩格之間互相 GSAP `bump` (±0.2 格距離 0.2s) + 受擊 sprite tint 白色 0.1s。
- 升級瞬間：sprite 替換 + 短暫金光 + GSAP `scale 1.0 → 1.3 → 1.0`。
- 行軍 stack：縮小版 sprite（0.7x）沿路徑移動，附帶 count 數字標籤。

### 5.2 HUD 與 UI 面板

- **頂部 Bar**：當前 tick 數、下一 tick 倒數條、暫停 / 1x / 2x 按鈕。
- **左下 Faction Panel**：4 勢力小頭像，顯示各自控制格數、總兵力、主城狀態（活 / 失）。玩家自己高亮。
- **右下 Tile Info Panel**：滑鼠 hover 任一格時顯示 `所有權 / tier / count / 是否主城`。
- **派遣中 Tooltip**：拖曳時跟隨游標顯示「派遣 X 兵 → 目標格（距離 Y tick）」；同步顯示派遣比例滑桿。
- **遊戲結束畫面**：覆蓋全螢幕半透明黑，顯示「勝利 / 敗北」+ 統計（持續 tick 數、最終控制格數）+「重新開始」按鈕。

### 5.3 操作方案（重設，無 OrbitControls）

由於改用 Pixi.js 2D 渲染，**不再需要 3D camera 旋轉**，原 Three.js OrbitControls 移除。左鍵專供派遣手勢，避免衝突。

| 操作                  | 動作                                |
| --------------------- | ----------------------------------- |
| **左鍵 click**        | 選取格（顯示 Tile Info）            |
| **左鍵 hold + drag**  | 從己方格派遣到目標格                |
| **右鍵 hold + drag**  | 平移視窗（pan camera）              |
| **中鍵 / 滾輪**       | 縮放（zoom，限制 1x / 2x / 3x 整數）|
| **方向鍵 / WASD**     | 平移視窗（鍵盤替代）                |
| **`Space`**           | 暫停 / 繼續                         |
| **`1` / `2`**         | 1x / 2x 倍速                        |
| **`R`**               | 重置攝影機到棋盤中央                |
| **`Esc`**             | 取消當前拖曳派遣                    |

- 拖曳判定：滑鼠移動 > 5px 才視為 drag（與既有 `InputManager` click vs drag 區分邏輯一致）。
- 左鍵在己方格按下後若移動 ≤ 5px 即放開 → 視為 click 選取；否則進入派遣拖曳模式。

## 6. 勝負條件

### 6.1 勝利

- 玩家佔領**所有其他勢力的主城** → 勝利畫面。
- 或：在所有其他勢力皆已敗北（被其他勢力滅了）的狀態下玩家主城仍在 → 勝利。

### 6.2 敗北

- 玩家主城被任一敵方勢力佔領 → 敗北畫面。

### 6.3 非玩家勢力敗北

- 非玩家勢力主城被佔領 → 該勢力 `defeated = true`（沿用 `GameState`），其餘城外格立即變為 Neutral 所有，stack 保留作為野怪（不再行動）。
- 敗北勢力的留存 stack 在後續結算中視同 `NEUTRAL` owner：正常參與 §3.6 戰鬥與 engagement counter；不主動派遣、不產兵。

## 7. Acceptance Criteria（可驗證）

每條都可由人類手動或自動化測試驗證。AC-04 / AC-05 / AC-08 等純邏輯項可在 vitest 中跑自動測試；UI 相關項（AC-01 / 06 / 07 / 09 / 11 / 12 / 13 / 14）走 manual smoke。v0.12 期間 AI 相關 AC（AC-15、AC-22、AC-27..AC-35）隨 §4 一併移出 v1.0；v1 acceptance 不依賴任何 AI 行為。

| #     | 條件                                                                                                                            | 驗證方式                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| AC-01 | 啟動後可見 **11x11** 棋盤、4 主城在四角、玩家為 Tokugawa                                                                        | 開啟瀏覽器肉眼確認                                                                                                |
| AC-02 | Tick 計數每 2 秒 +1，HUD 顯示                                                                                                   | 觀察 10 秒應為 5 ticks                                                                                            |
| AC-03 | 主城所在格每 4 秒 count +1                                                                                                      | 暫停所有派遣，觀察 20 秒應 +5                                                                                     |
| AC-04 | 當格 count 達 5 → sprite 變為 Knight；達 12 → Queen；達 25 → King (v0.9 閾值)                                                  | Headless 測試：強制 setCount，斷言 deriveTier 回傳正確 tier                                                       |
| AC-05 | count 從 12 掉到 11 → sprite 退回 Knight；從 5 掉到 4 → 退回 Soldier (v0.9 閾值)                                                | Headless 測試：模擬戰鬥減 count，斷言 tier 更新                                                                   |
| AC-06 | 從己方格 hold-drag 到 5 格外目標 → 顯示 BFS 路徑高亮，**目標格為敵方時仍可派遣**                                                | 操作確認；嘗試 drag 到敵方相鄰格與 5 格外敵方格                                                                   |
| AC-07 | 派遣後來源 count 減少對應數，目標格在抵達 tick 後 count 增加（或進入戰鬥）                                                      | 觀察兩格 count 變化吻合；測試比例 50% / 100%                                                                      |
| AC-08 | 6 Knight vs 5 Knight 相鄰 ramp 收斂（v1.1）：advance(1) → (6,5) no-dmg；advance(2) → (5,4)；advance(3) → (3,2)；advance(4) → (0,0) | Headless 測試：setUp 後逐 tick advance，斷言 count 序列吻合 §3.6 ramp 範例                                       |
| AC-09 | 空格被相鄰己方派遣/推進佔領，所有權變更，HUD 計數更新                                                                           | 操作確認                                                                                                          |
| AC-10 | 佔領敵方主城 → 該 AI 勢力 `defeated`，其餘領地變 Neutral                                                                        | 操作確認 + 控制台檢查；或 Headless 跑「玩家秒殺」場景                                                             |
| AC-11 | 玩家主城被佔領 → 顯示「敗北」畫面 + 重新開始按鈕                                                                                | 操作確認；重新開始可回初始狀態                                                                                    |
| AC-12 | 玩家佔領所有 3 個 AI 主城 → 顯示「勝利」畫面                                                                                    | 操作確認                                                                                                          |
| AC-13 | 暫停按鈕停止 tick，恢復後從停止處繼續                                                                                           | 暫停 5 秒後恢復，tick 數連續                                                                                      |
| AC-14 | 2x 速度按下後 tick 間隔 = 1 秒                                                                                                  | 計時 10 秒應為 10 ticks                                                                                           |
| ~~AC-15~~ | _AI 行為類，§4 於 v1.0 移出，AC 一併下線_ | — |
| AC-16 | 主城派遣 100% 時來源至少保留 1 兵                                                                                               | 操作 / Headless：主城 count = 10，派遣 100%，斷言來源剩 1、marching stack count = 9                               |
| AC-17 | 敵方 marching stack 同 tick 進同格 → 頭對頭碰撞用 §3.6 `engagementTicks = 1` 一次性結算（雙方各扣 1，不寫入 engagementMap） | Headless：兩 marching stack 同時抵達中間格，斷言雙方 count 各 -1 且 `state.engagements` 不含此 pair key |
| AC-18 | 路徑被切：marching stack 在前一格停下，下 tick 從相鄰戰鬥                                                                       | Headless：派遣中讓敵方切入路徑，斷言 marching stack idx 停滯且觸發 3.6                                            |
| AC-19 | §3.6 ramp 收斂（v1.1）：兩相鄰 3 Soldier 對峙，advance(1) 後 (3,3) no-dmg；advance(2) → (2,2)；advance(3) → (0,0)；advance(4) pair 已解散 | Headless：擺 3 vs 3 對峙逐 tick advance，斷言 count 序列 + engagementMap 狀態（tick 3 後 key 消失） |
| AC-20 | 同勢力雙 marching stack 同 tick 入同格 → 合併、path 取剩餘步數最少者，tiebreak 取早派遣者                                       | Headless：派遣 stack A（剩 3 步）與 stack B（剩 1 步）同時抵達；斷言合併後 count 加總且 path 用 B 的剩餘 path     |
| AC-21 | 敵方 marching stack 頭對頭（雙方非終點）→ 倖存方繼續原路徑、不入駐碰撞格                                                       | Headless：擺好兩條路徑交叉的 stack，斷言碰撞 tick 後倖存方 idx 仍前進、碰撞格無新主                               |
| ~~AC-22~~ | _AI RNG 確定性類，§4.2 於 v1.0 移出，AC 一併下線_ | — |
| ~~AC-23~~ | _§3.6.1 於 v0.12 移除，原 adjacent claim 單一勢力翻 owner 場景作廢_ | — |
| ~~AC-24~~ | _§3.6.1 於 v0.12 移除，原多勢力戰力決勝場景作廢_ | — |
| ~~AC-25~~ | _§3.6.1 於 v0.12 移除，原 claim 不變更 count 場景作廢_ | — |
| ~~AC-26~~ | _§3.6.1 hysteresis 隨 §3.6.1 於 v0.12 一併移除_ | — |
| ~~AC-27~~ | _AI rule #2 castle 分階保護，§4.1 於 v1.0 移出，AC 一併下線_ | — |
| ~~AC-28~~ | _AI rule #2 Soldier 禁止派兵，§4.1 於 v1.0 移出，AC 一併下線_ | — |
| ~~AC-29~~ | _AI rule #3 距離放寬，§4.1 於 v1.0 移出，AC 一併下線_ | — |
| ~~AC-30~~ | _AI rule #3 距離受限，§4.1 於 v1.0 移出，AC 一併下線_ | — |
| ~~AC-31~~ | _AI rule #3 castle reserve，§4.1 於 v1.0 移出，AC 一併下線_ | — |
| ~~AC-32~~ | _AI rule #3 派遣量 ≤ 0，§4.1 於 v1.0 移出，AC 一併下線_ | — |
| ~~AC-33~~ | _Castle 自動溢出 (§3.5.5)，於 v1.0 移出 PRD，AC 一併下線_ | — |
| ~~AC-34~~ | _AI rule #2.5 集結，§4.1 於 v1.0 移出，AC 一併下線_ | — |
| ~~AC-35~~ | _Castle vs castle BFS 例外 (§3.5.6)，於 v1.0 移出 PRD，AC 一併下線_ | — |
| AC-36 | §3.8 4-conn 鄰格：tile `(5,5)` 對 `(6,5)` / `(4,5)` / `(5,6)` / `(5,4)` 皆是鄰格；對 `(6,6)` / `(4,4)` / `(6,4)` / `(4,6)` 皆**不是**鄰格（戰鬥不配對、BFS 不視為一跳） | Headless：擺 6 個敵我格驗 §3.6 `resolveAdjacentCombat` 只配 4 對；BFS `findPath((5,5)→(6,6))` 必須繞行非對角路徑 |
| AC-37 | §4 idle 模式：scenario `aiConfig` 全填 `"idle"` 跑 100 ticks，非玩家勢力 marching stacks count 始終 = 0；TOKUGAWA 主城 count 仍每 2 ticks +1（§3.3 產兵照常） | Headless：建 idle scenario 跑 100 ticks，斷言 `state.marchingStacks` 全程 ≤ 玩家 scripted 派遣數；非玩家 castle count 持平爬升 |
| AC-38 | §4 scripted 模式：scenario `scriptedCommands` 指定 `{atTick: 5, from: [10,0], to: [9,0], ratio: 1.0}`，TAKEDA 的 aiConfig = `"scripted"` → tick 5 真的派一條 marching stack；其餘 tick 不動 | Headless：advance(10) 後斷言只有 tick 5 出現 TAKEDA marching stack 一筆，其餘 tick 為 0 |
| AC-39 | §3.8 玩家派遣無 hop 上限：玩家 hold-drag 從主城 (0,0) 到 BFS 路徑長 = 18 hops 的目標格（全程己方 passable），dispatch 應該成功；同樣路徑長但中間切一格非 passable → dispatch 顯示紅色拒絕 | UI 操作 + Headless `findPath` 雙端驗：路徑全 passable → 回傳路徑陣列；中斷 passable → 回傳 null |

## 8. 範圍外（Future Scope）

- 多尺寸地圖（7x7 / 9x9 / 13x13）
- 子城 / 多城制
- AI 難度分級
- 多人連線
- 地形效果（森林、河流、橋樑）
- 音樂與音效
- 存檔 / 讀檔
- 自訂勢力顏色與名稱
- 行軍 stack 主動繞路（碰到切入會自動 re-route）

## 9. 技術對應（要動到 / 新增的檔案）

### 9.1 引擎層（純邏輯，無 Pixi/DOM 依賴 — 可 headless 跑）

| 模組                       | 職責                                                |
| -------------------------- | --------------------------------------------------- |
| `src/engine/state.ts`      | `GameState`、`Province { tier, count, owner }`、行軍佇列 |
| `src/engine/tick.ts`       | Tick 推進器（純函數 step(state) → state'）          |
| `src/engine/upgrade.ts`    | `deriveTier(count)` 純函數                          |
| `src/engine/combat.ts`     | `computeLoss(own, opp)` 純函數 + adjacency 結算     |
| `src/engine/movement.ts`   | BFS 路徑 + marching stack 推進 + 碰撞解析           |
| `src/engine/production.ts` | 主城產兵                                            |
| `src/engine/victory.ts`    | 勝負判定                                            |
| `src/engine/types.ts`      | 共用型別（Faction / Tier / Province / MarchingStack）|

> Engine 中 `src/engine/ai.ts`（含 `stepAi`、rule #1/#2/#2.5/#3 實作）、`src/engine/overflow.ts`（castle overflow phase）目前**仍在 repo 內**，`tick.ts` 也仍會呼叫 `stepAi` + `applyCastleOverflow`，但對應 PRD 規格（v0.12 §4 / §3.5.5）已隨 v1.0 移出。屬「規格 orphan」狀態：行為不在本 PRD 規範範圍，未來 AI 重啟時必須回頭重審。

### 9.2 渲染層（Pixi.js）

| 模組                          | 職責                                       |
| ----------------------------- | ------------------------------------------ |
| `src/render/app.ts`           | Pixi `Application` 初始化、resize          |
| `src/render/board.ts`         | 格子 sprite + iso 投影 + 高亮 overlay      |
| `src/render/units.ts`         | 駐紮 stack sprite 渲染、tier 切換、升級動畫 |
| `src/render/marching.ts`      | 行軍 stack sprite 沿路徑插值動畫           |
| `src/render/combat.ts`        | 戰鬥 bump + tint flash 動畫（GSAP）        |
| `src/render/paths.ts`         | 拖曳預覽路徑虛線                           |

### 9.3 輸入與 UI 層

| 模組                       | 職責                                              |
| -------------------------- | ------------------------------------------------- |
| `src/input/pointer.ts`     | 滑鼠 hit-test、click vs drag、左右鍵分流          |
| `src/input/keyboard.ts`    | Space / 1 / 2 / R / Esc / WASD                    |
| `src/input/dispatch.ts`    | 拖曳派遣手勢狀態機、滑桿選比例                    |
| `src/ui/hud.ts`            | 頂部 tick bar + 速度控制                          |
| `src/ui/factionPanel.ts`   | 左下勢力面板                                      |
| `src/ui/tileInfo.ts`       | 右下格資訊                                        |
| `src/ui/endScreen.ts`      | 勝負結束畫面                                      |

### 9.4 入口與資源

| 模組                       | 職責                                  |
| -------------------------- | ------------------------------------- |
| `src/main.ts`              | 啟動：建 engine、建 renderer、wire UI |
| `src/assets/`              | sprite PNG（沿用 `public/knight.png`，補 soldier/queen/king/castle） |
| `src/scenarios/default.ts` | 11x11 預設開局配置                    |

### 9.5 既有檔案處置

- `src/main.ts`、`src/manager/*`、`src/map/*`、`src/unit/*`、`src/event/*`、`src/game/*`、`src/namedMap/*`、`index.html` → **重構保留概念，重寫實作**。`Faction` / `FactionId` / `Province` 型別概念遷入 `src/engine/types.ts`。
- 移除 `three` 與 `@types/three` 相依；新增 `pixi.js` (^8.x)。GSAP 保留。

## 10. Headless Playtest 腳本規格（**降格為工具，非 acceptance 工具**）

> 原 v0.12 §10 把 playtest CLI 定位為 AI balance 探索工具（100-run 勝率分佈 / 平均場長）。v1.0 把 AI 移出 PRD 後，這層 acceptance 用途**暫停**：勝率、場長都沒意義（沒有自動派兵的對手）。
>
> CLI 本身（`src/playtest/cli.ts`、`runScenario` API、scenario JSON 格式、event log）仍保留在 repo，繼續服務兩個用途：
>
> - **引擎回歸 / scripted smoke**：`aiConfig` 全填 `"idle"`、用 `scriptedCommands` 走完一條預先寫好的劇本（夾擊敵 castle、引發 ramp 收斂、頭對頭碰撞等），驗 §3.5 / §3.6 engine 行為。
> - **單元 / 整合測試後盾**：`src/playtest/integration.test.ts` 仍會被 vitest 跑，作為跨模組行為的回歸網。
>
> AI-driven 統計用途（100-run 勝率）等 AI 回到 PRD 後再考慮重啟。

## 11. 驗證計畫（總覽）

| 階段             | 工具                                       | 範圍                                                  |
| ---------------- | ------------------------------------------ | ----------------------------------------------------- |
| 開發中           | vitest 單元 / 整合測試                     | AC-04 / 05 / 08 / 17 / 18 / 19 / 20 / 21              |
| Manual smoke     | `pnpm dev` + 瀏覽器                        | AC-01 / 02 / 03 / 06 / 07 / 09 / 11 / 12 / 13 / 14 / 16 |
| Scripted smoke   | `pnpm playtest <scripted.json>`            | 引擎行為回歸（無 AI、純 scripted 劇本驗 §3.5 / §3.6） |
| PR 驗證          | `/verify` skill                            | 最後一次端到端跑通                                    |

> v0.10/v0.11 的「100-run 結束率 / 勝率分佈 / 平均場長」acceptance 隨 AI 一併移出 v1.0。v1 acceptance 的具體門檻在「UI + 基礎機制」次輪 PRD 重新訂定。完整 v0.12 收斂限制與 acceptance gate 描述見 git tag `archive/prd-v0.12`。
