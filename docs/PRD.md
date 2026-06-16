# 知識戰爭 / Knight Strike — Product Requirements Document

**Version**: v1.3
**Status**: v1.2 + self-replicate（全域駐紮分裂）+ walk-through claim 復活
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
- v1.0 — **重大 scope 重設**：把 AI 設計整段移出 PRD，等 UI + 基礎機制建好後再回頭重寫。
  - 移出範圍：§4 AI 規則、§3.5.5 castle overflow、§3.5.6 castle vs castle 例外、§10 playtest balance 重心、§11 收斂限制。
  - 砍 AI 相關 AC：AC-15（AI 30-tick 擴張）、AC-22（AI RNG 確定性）、AC-27..AC-35（rule #2 castle 分階保護 / rule #3 距離 + reserve + 派遣量 / castle 溢出 / rule #2.5 集結 / castle vs castle BFS 例外）。
  - Engine 程式碼層 `src/engine/ai.ts` / `ai.test.ts` / `overflow.ts` / `overflow.test.ts` / `src/playtest/runner.ts` 的 AI 分類邏輯與 spectator-4ai scenario 保留在 repo 內，但屬「規格 orphan」狀態：對應 PRD 章節已不存在、不在 v1 acceptance 內、未來 AI 重啟時必跟新規格對齊（程式碼不保證直接可用）。
  - pre-prune 完整 v0.12 快照見 git tag `archive/prd-v0.12`（commit `5714dc5`）。
  - 本 v1.0 是「UI + 基礎機制」次輪設計的起點 baseline，**不是**最終 v1.0 release。
- v1.1 — **戰鬥模型徹底重做**：§3.6 改為「count-only 互相抵銷 + per-pair ramp」。
  - Tier 倍率（Soldier=1 / Knight=4 / Queen=12 / King=30）從戰鬥結算移除，tier 退回純視覺與升級階級。
  - 每對相鄰敵我格維護一個 `engagementTicks` 計數器：相鄰第 0 tick 不傷害、之後每 tick 雙方各扣 `2^(engagementTicks - 1)`。Pair 不再相鄰（任一方清空 / 易主 / 行軍走開）→ counter 丟棄，重新相鄰從 0 重數。
  - §3.7 stalemate / drain 整節移除（新 ramp 內建消耗，drain 失去意義）；`StalemateMap` / `stalemateTicks` / `applyDrainDeductions` 改名為 `EngagementMap` / `engagementTicks`，併入 §3.6 結算階段。
  - §3.5.4 #4 / #5 頭對頭碰撞改為一次性 `engagementTicks = 1` 結算（雙方各 -1，不建立持續 pair）。
  - §3.2 step order 拿掉 `drain` 步驟。AC-08 / AC-17 / AC-19 對應重寫。
  - 設計意圖：(a) tier 抗打 / 輸出乘法的耦合在玩家層體感不明顯，反而讓低 count 大量壓制變得無解；移除後戰鬥是純粹的「人數抵銷 + 拖久爆炸」。(b) ramp 暴力收斂，永遠不會出現對峙打不死的爛尾。
  - 收斂風險：原 §3.7 / §3.5.5 / §3.5.6 的補丁價值消失，但 ramp 本身就保證 pair 在 `log₂(count)` 個 tick 內結束。AI 重啟時要重審「ramp 是否會在 index 3+ 之後莫名互滅造成不可控翻盤」。
- v1.2 — **戰鬥模型再次重做**：鄰邊戰鬥整段移除，改為同 tile multi-occupant 戰鬥。
  - 資料模型：`Province.owner` 欄位徹底刪除（由 `occupants` derive 出 ownership 語意）；Tile 改持有 `occupants: { faction, amount, arrivalTick, isDefender }[]`。
  - 觸發條件：tile 上出現 2+ 不同 faction 的 occupant 即進入戰鬥；單方佔據不觸發。
  - 駐紮方：tile 上「最先抵達」的 faction；若同 tick 多方抵達空 tile，用 `state.rng` 隨機抽選 defender（維持 deterministic）。
  - 傷害公式改為 step function：`damage(t) = 2^floor(log2(max(t, 1)))`，即 t=0–1 → 1、t=2–3 → 2、t=4–7 → 4...（舊 v1.1 的 `2^(n-1)` 線性遞增改為以 2^k tick 為界的階梯）。
  - 駐紮方 tick-0 優勢：combat 首 tick 只有 defender 攻擊，所有入侵者不還手。
  - 多方混戰：每個 occupant 對「每一個」敵對 occupant 獨立發動一次攻擊，各自套用 `min(理論傷害, 自身 amount)` 上限。
  - 增援機制：同陣營單位從相鄰 tile 抵達同格 = 併入既有 occupant amount。同 tick 內加法（增援）先於減法（攻擊）結算，可救回理論該歿之單位。
  - 行軍經過戰鬥 tile：無論友軍敵軍，marching stack 抵達 contested tile 強制變 occupant 加入戰鬥（同陣營當增援、不同陣營當新入侵者），path 丟棄。
  - 鄰邊戰鬥模型整套廢除：§3.6 v1.1 的 `engagementMap` / `pairKey` / `resolveAdjacentCombat` 全部移除；§3.5.4 一次性碰撞解析（#4、#5、#6）同樣廢除。§3.7 維持已刪除狀態（v1.1 即刪）。
  - §3.2 step order 改為：`movement (含 §3.5.4 同 tile 加法併入) → produce → combat (§3.6 same-tile damage 減法) → defeats → victory`。Production 上移到 combat 前，讓 castle 產的兵可在當 tick 立即併入戰鬥的「加法階段」。
  - AC 大規模重編：舊 AC-08 / 17 / 18 / 19 / 20 / 21 / 36 全 strikethrough；新規從 `AC-V2-01` 起，覆蓋兩個範例案例（駐紮 50 vs 入侵 36 直到 tick 9 殲滅、增援 +10 救援讓殲滅延後一 tick）、多方混戰、force-join、defender 抽籤確定性。
  - 設計意圖：(a)「攻擊 = 移動到敵格」與 RTS 通用直覺一致，鄰邊互磨的視覺與規則的脫節（看不到單位實際接觸）消失。(b) Multi-occupant 讓「我的單位疊在敵方城上同框互砍」的視覺成立，渲染層才有真實戰鬥的張力。(c) Defender 優勢給城堡防守一個結構性 advantage（主城是天生 defender），保留「攻方需要兵力優勢才敢進」的策略張力。
  - 收斂風險：step function 仍保證 `O(log₂(amount))` tick 收斂（t=8 階段已 8 傷害，9 tick 內必爆雙方 ≤ 50 兵的 pair），但 multi-party 混戰每方受 `(N-1)·damage(t)`，3 方混戰崩盤速度近乎 2 倍 — 實測若爛尾就回頭調傷害上限或加 tick-0 後的緩衝。
- v1.3 — **補回兩條 v1.1 行為**：v1.2 多 occupant 重寫時掉的 §3.3 self-replicate（駐紮分裂）與 §3.5.2 / §3.5.4 walk-through claim。
  - Self-replicate：非戰鬥（`!isContested`）的 tile 上，任何 `amount ≥ 1` 且 `< 100` 的非 NEUTRAL / 非 defeated occupant 每 tick `+1`。包含 amount = 1 殘血部隊（與 v1.1 行為一致）。
  - `isCastle` 不再特別處理 — castle 與一般領地走同一條 self-replicate。
  - Walk-through claim：`Province` 新增 `lastClaimedFaction: FactionId | null` 欄位（與 `occupants` 並列）；marching stack 走過任何「無 hostile 兵」的中間 tile（非終點、無敵方 amount > 0）時把 `lastClaimedFaction` 標為自家。
  - `derivedOwner` 規則：`occupants.length === 1` → 該 occupant 的 faction；`occupants.length === 0` → `lastClaimedFaction`；`occupants.length ≥ 2` → null（contested 仍無 derived owner）。
  - BFS passable 放寬：中間 tile 只要無敵對 occupant 含 `amount > 0` 即可通過（空敵格 / 純自家 claim / 中立空格 / 自家 occupant 全 passable）。
  - 新增 AC-V2-29（self-replicate）、AC-V2-30（walk-through claim）。
  - 設計意圖：(a) self-replicate 讓 castle 不是唯一兵源，戰場上派駐的點位也會自然成長，玩家不必每 4 ticks 從 castle 派一條。(b) walk-through claim 讓 marching stack「染色」過程視覺化，玩家直覺地看到自己的領土在擴張。

## 1. 願景與背景

重製日本免費小品《国家大作戦》(lm_exp, 2005 年前後)，以 Web 技術交付。45° 斜俯視棋盤、像素風角色、即時 tick 戰棋。**最終願景**：單場 12–20 分鐘內結束的中節奏對 AI 戰；**v1.0 中繼目標**：先把 UI + 基礎機制（操作流暢、視覺回饋、規則一致）做穩，AI 行為等次輪 PRD 重新設計後再導入。

**Tech Stack**：Vite + TypeScript + **Pixi.js v8** + GSAP。

> **技術棧決策**：原 scaffolding 使用 Three.js + OrthographicCamera 把 2D sprite 放進 3D 空間，是把 2D 遊戲用 3D 引擎硬幹。本作所有玩法都在 2D 格網上發生（45° iso 只是視覺投影），改用 **Pixi.js v8** 更貼合需求：原生 2D sprite、內建 pixel-perfect 渲染、輸入事件 API 直接 hit-test 格子、bundle 更小、無 3D camera 帶來的 orbit/drag 衝突。GSAP 留作 tween 引擎驅動 Pixi 物件動畫。既有 scaffolding（state / faction / province 純資料層）保留，rendering / input 層重寫。

## 2. 名詞表

- **Tick**：遊戲時鐘最小單位，2 秒 / tick。所有產兵、移動、戰鬥都在 tick 邊界結算。
- **Tile / Province**：棋盤上的一格，是地形屬性（`isCastle`、初始 owner faction）與單位容器的最小單位。Tile 本身**不再持有 owner / count 欄位**（v1.2 起），所有權與兵力由 `occupants[]` 表達。
- **Occupant**：駐紮在某 tile 上的單一 faction 單位群，由 `{ faction, amount, arrivalTick, isDefender }` 表示。一個 tile 可同時容納 0..N 個不同 faction 的 occupant；多 faction 共存即戰鬥狀態（§3.6）。
- **Marching Stack（行軍 stack）**：派遣後沿路徑移動的暫態單位群，獨立於 tile 上的 occupant；抵達 tile 後依 §3.5.4 規則決定併入既有 occupant、新增 occupant、或合併並繼續行軍。
- **Tier**：單位階級 —— Soldier / Knight / Queen / King。由 `deriveTier(amount)` 即時推導，只用於 sprite 顯示與升級階級語意（v1.1 起不再參與戰鬥公式）。
- **主城 (Main Castle)**：每個勢力的核心 tile（`isCastle: true`），失守即敗。主城本身**天生為該 faction 的 defender**（開局即在 tile 上），無 arrivalTick 概念。
- **Defender**：tile 上「最先抵達」（最小 `arrivalTick`）的 occupant，於 §3.6 戰鬥首 tick 享有單方攻擊優勢。Castle 上的原 faction 永遠是 defender（直到被殲滅）。
- **CombatStartTick**：tile-level 狀態，當 tile 第一次出現 2+ 敵對 occupant 時鎖定為當下 tick；只要 tile 仍有 2+ 敵對 occupant 就維持不變，戰鬥結束（≤ 1 faction 存活）後清除。重新進入戰鬥時重設。
- **LastClaimedFaction**（v1.3）：tile-level 狀態，記錄「最後一個進駐或走過該 tile 的 faction」。Marching stack 抵達或路過空 tile 時設定；driver derive 空 tile ownership 用。`amount = 0` 的 tile 渲染依此染色，但**不可作為 dispatch 來源**。Contested 或多 occupant 時不影響 derivedOwner（以 occupants 為準）。

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
- 每個 tick 結算順序固定（v1.2）：
  1. **Movement + 抵達加法**：marching stack `idx++`、§3.5.4 抵達結算（含同陣營合併、新增 occupant、force-join），所有加法（amount += merged）寫回。
  2. **Production（產兵）**：每座 castle 為「castleOwner faction 在該 castle tile 上的 occupant」amount +1（§3.3 細則）；亦屬加法。
  3. **Combat（同 tile 戰鬥減法）**：§3.6 對每個 contested tile 結算傷害，所有減法（amount -= damage）寫回；同步殲滅 amount ≤ 0 的 occupant；更新 `combatStartTick`。
  4. **Defeats**：castle tile 上若找不到 castleOwner faction 的 occupant → 該 faction `defeated = true`，依 §6.3 處理其留存 occupant / marching stack。
  5. **Tier 推導**：每個 occupant 的 tier 由 `deriveTier(amount)` 即時更新（無狀態，純 derived）。
  6. **勝負判定（§6.1 / §6.2）**。

> 完整 step order（v1.2）：`movement (含 §3.5.4 抵達加法) → produce → combat (§3.6 same-tile 減法) → defeats → victory`。**Production 移到 combat 之前**（v1.1 是 combat 後），原因：castle 產的兵可在當 tick 立即併入戰鬥的加法階段、被當作「增援」直接救活理論上會在本 tick 陣亡的單位。`upgrade` 不再是獨立 phase（純 derived，每次讀 occupant.amount 都即時推導）。Castle overflow（v0.11 §3.5.5）隨 AI 一併移出 v1.0 PRD — engine `applyCastleOverflow` 程式碼仍可能在 repo 內但因 v1.0 / v1.2 都沒有自動把 castle 推到 > 30 的邏輯，實際上不會 fire；v1.2 不依賴此 phase，未來 AI 重啟時要重新規格化。

### 3.3 駐紮分裂與兵源（v1.3）

- **Self-replicate（駐紮分裂）**：每 tick，對每個 tile 上的每個 occupant 套用以下條件：
  - 該 tile **不處於戰鬥狀態**（`!isContested`，即 occupants 含 ≤ 1 個不同 faction）
  - occupant `faction` 非 `NEUTRAL`、該 faction 不在 `state.defeated`
  - `occupant.amount ≥ 1` 且 `< 100`
  - → 該 occupant `amount += 1`
- **amount = 1 也分裂**：殘血部隊（含派遣後 castle 剩 1 兵）會慢慢成長回來，與 v1.1 行為一致。設計直覺：只要還有人站在那裡就會吸引壯丁。
- **戰鬥中暫停**：contested tile 不增殖（哪一方都不長），讓 §3.6 ramp 公式單純基於戰前 amount 收斂。
- **主城不再特殊**：v0.x 期 castle 是唯一兵源、一般領地不產兵的舊規則於 v1.3 廢除。castle 改走同一條 self-replicate（castleOwner 的 occupant amount ≥ 1 即會 +1），與一般領地同等待遇。**Castle 仍是敗北判定的核心** — castleOwner 的 occupant 失守即敗北（§6）。
- **產兵時機**：屬 §3.2 step order step 2，**在 movement 加法之後、combat 減法之前**。於戰鬥中產的兵理論上會在減法階段一併扣血，但 contested 條件已擋下，故實際不會 fire。
- **Cap = 100**：避免戰場累積無上限。Cap 應用在每個 occupant 各自的 amount，不是 tile 加總。
- **子城（future scope）**：MVP 不含；保留 `tile.isCastle` 介面供日後擴充。
- **空但「曾被某勢力路過」的格子**：v1.3 後 tile 有 `lastClaimedFaction: FactionId | null` 欄位（見 §3.5.4）。0 occupant 的 tile derived ownership 從 `lastClaimedFaction` 推導，渲染上會顯示該勢力顏色，但 amount 仍是 0，**不可作為 dispatch 來源**（`dispatch` 仍要求 source 有 own faction 的 occupant 且 amount > 0）。
- **空 castle tile**：當 castleOwner 的 occupant 被殲滅後，castle tile 進入「孤兒」狀態，等同任何空 tile，可被任何 faction marching stack claim 或進駐。§6 敗北已觸發，此 castle 不再產兵。

### 3.4 單位、Occupant 與升級

- 每個 tile 的單位狀態以 `occupants: Occupant[]` 表達；每個 occupant 是 `{ faction, amount, arrivalTick, isDefender }`。0 occupant = 空格；1 occupant = 該 faction 獨佔；2+ occupant 且 faction 不全同 = 戰鬥狀態（§3.6 觸發）。
- 同 faction 同時間在同 tile **只能有一個 occupant**；新抵達的同 faction 單位（行軍抵達或增援）併入既有 occupant 的 `amount`，不新增 entry。
- 每個 occupant 的 tier 由 `deriveTier(amount)` 即時推導（純函數）：
  - `amount < 5` → Soldier
  - `5 ≤ amount < 12` → Knight
  - `12 ≤ amount < 25` → Queen
  - `amount ≥ 25` → King
- Tier 升級 / 降級為**隱含結果**：amount 變動後即時更新 tier。畫面上顯示對應 sprite + 數字（同 tile 多 occupant 時依 §5.1 多 sprite 並陳規則渲染）。
- **不同 faction 進入同 tile = 共存進入戰鬥**，不再合併、不再一次性決勝。詳見 §3.6。

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

- 路徑用 BFS 搜尋。**Passable（中間經過格）的定義（v1.3 寬鬆版）**：
  - tile 上**沒有任何敵對 faction 的 occupant 且 amount > 0** 即 passable。等價於以下任一：
    - `occupants.length === 0`（空格，含 lastClaimedFaction 標記的「染色空格」）
    - 所有 occupant 都是自己的 faction（純己方獨佔，任何 amount）
    - 敵方 occupant 全為 `amount === 0`（實務上不會出現 — `amount === 0` 的 occupant 在 combat / dispatch 後即被移除；走 claim 留下的是 `lastClaimedFaction` 旗標，不是 amount=0 的 occupant）
  - 任何含 hostile occupant 含 amount > 0 的 tile（含 contested 戰鬥中的 tile）**不**可作為中間經過格。
- **目標格不需要 passable**：可以是敵方獨佔、contested 戰鬥中、或空格。BFS 終點不檢查 passable，只檢查中間經過格。
- 目標格為己方獨佔 → 抵達後併入該 occupant amount（補充 / 增援）。
- 目標格為空 → 抵達後新增為己方 occupant。
- 目標格為敵方獨佔 → 抵達後加為新 occupant，§3.6 戰鬥於下 tick 觸發（也可能於同 tick 觸發，看抵達後是否同 tile 有 2+ faction）。
- 目標格為 contested（已 2+ faction 在打）→ 抵達後依 §3.5.4 #3 force-join 規則加入。
- 無路徑：來源與目標被敵方完全切斷且非相鄰時，顯示紅線拒絕派遣。
- **行軍途中 passable 失效**：dispatch 時 BFS 通過的路徑，若行軍途中某中間格因敵方抵達而變 contested → marching stack 抵達該格時觸發 §3.5.4 #3 force-join（**不**繞路、**不**停下，直接捲入戰鬥）。設計理由：規則明確、AI / 玩家不需要學「我的兵會不會繞路」的隱晦行為。繞路屬 future scope（§8）。

#### 3.5.3 行軍 stack 行為

- 派遣瞬間從**來源 tile 的己方 occupant** 扣除對應 amount，建立獨立 marching stack：

  ```ts
  type MarchingStack = {
    id: string;                 // 唯一 ID（用於 collision tiebreak）
    faction: FactionId;
    count: number;              // tier 不存欄位，由 deriveTier(count) 即時推導
    path: TileId[];             // BFS 計算的整條路徑（含起點與終點）
    idx: number;                // 當前位置 = path[idx]，下 tick 移到 path[idx+1]
    dispatchedAtTick: number;   // 派遣時 tick 數，§3.5.4 規則 #2 tiebreak 用
  };
  ```

- **tier 不存欄位**：渲染（選擇 sprite）由 `deriveTier(count)` 即時推導。原因：避免 stack 合併 / 受傷時忘記同步 tier 造成 bug；單一資料源 = count。v1.1 起戰鬥不再用 power 派生值，tier 退回純視覺意義（v1.2 維持）。
- 每 tick 沿 `path` 前進 1 格（`idx++`）。
- Marching stack **不**是 tile occupant — 它是 transient 移動實體，獨立於 tile 的 `occupants[]`；渲染為小型移動 sprite 沿路徑跑動。
- 抵達 path 終點（`idx === path.length - 1`）時觸發 §3.5.4 抵達結算 → 變成 occupant（新增或併入既有）。
- **中途也可能被「召喚成 occupant」**：抵達非終點但 tile 為 contested → §3.5.4 #3 force-join，path 中止。
- 剩餘步數 = `path.length - 1 - idx`。`0` = 此 tick 已抵達終點。

#### 3.5.4 行軍抵達規則（v1.2 — multi-occupant 加法階段）

v1.2 後**所有戰鬥都發生在同 tile**（§3.6），§3.5.4 不再處理任何傷害結算 — 它只處理 tick 的**加法階段**：marching stack 抵達 tile 後如何變 occupant、如何併入既有同陣營 occupant、以及多 stack 同 tick 抵達時的合併路徑選擇。

當 marching stack 在某 tick 推進到一個 tile（無論是否終點），依下列規則處理（**原子性，所有同 tick 抵達事件先 dry-run 再同步寫回**）：

##### 1. 同陣營多 marching stack 同 tick 抵達同 tile → **合併為單一抵達事件**

- 合併 amount：`mergedAmount = sum(stack.count for stack in arrivals)`
- 合併 path 選擇：
  - **若任一參與合併的 stack 以此 tile 為終點**（`idx === path.length - 1`）→ 合併後 stack 視為「終點抵達」，後續走 #2 (a) 規則。
  - **否則**取「剩餘步數最少」（`path.length - 1 - idx` 最小）的 stack 的剩餘 path。
  - Tiebreak：剩餘步數相同 → `dispatchedAtTick` 較早者；再相同 → `id` 字典序較小者。

##### 2. 抵達 tile 上既有 occupants 與 marching stack 的互動

按抵達 tile 上 occupants 的狀態分類（用合併後的 stack `(faction, amount, isTerminus)` 對 tile 操作）：

| 抵達情境                                                                       | 行為                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) Tile 空（0 occupant）+ stack 終點**                                       | 新增 occupant `{ faction, amount, arrivalTick: currentTick, isDefender: true }`；marching stack 消滅。                                                                                |
| **(b) Tile 空 + stack 非終點**                                                  | Marching stack 不變成 occupant，繼續沿 path 前進（純過路）。tile 維持 `occupants: []`，但 `lastClaimedFaction = stack.faction`（**walk-through claim，v1.3 復活**）。視覺上該 tile 染色為 stack 勢力，功能上仍是空格、不能 dispatch。                                                          |
| **(c) Tile 上只有同陣營 occupant + stack 終點**                                 | 併入既有 occupant 的 `amount`（`existing.amount += merged.amount`），既有 occupant 的 `arrivalTick` / `isDefender` 不變。Marching stack 消滅。                                          |
| **(d) Tile 上只有同陣營 occupant + stack 非終點**                               | Marching stack 不變 occupant，繼續沿 path 前進（純過路，**不**併入既有 amount）。原因：保留派遣意圖 — 派出去的兵就是要去更遠的目標，不該被路過格吸收。`lastClaimedFaction` 已是自家（從上次 claim / 入駐時設好），無需重設。                              |
| **(e) Tile 上有敵對 occupant（含 contested 多 faction），無論 stack 是否終點** | **Force-join**：marching stack 強制變 occupant 加入 tile。<br>• 若 tile 已有同陣營 occupant → 併入既有（同 #1 #2(c) 合併規則）。<br>• 若 tile 無同陣營 occupant → 新增 occupant `{ faction, amount, arrivalTick: currentTick, isDefender: false }`（永遠不是 defender — defender 是已在 tile 上的 occupant）。<br>Marching stack `path` 一律丟棄，不再繼續行軍。 |

##### 3. 同 tick 內多陣營 marching stack 同時抵達**空 tile** 的 defender 抽籤

- 若一個 tile 空，同 tick 有 2+ 不同 faction marching stack 抵達（皆視為「新進駐」），用 `state.rng` 從這幾家中**隨機抽一個**作為 defender；其餘 faction 一律 `isDefender: false`。
- 每家 faction 在該 tile 上的 occupant 入駐後 amount = 各自合併後的 mergedAmount；同 faction 同步用 §3.5.4 #1 規則合併成一個 occupant。
- 抽中 defender 的 occupant `arrivalTick` 與其他入侵者**同為 currentTick**（孖生），但 `isDefender: true` 唯一存在於抽中那家。
- 抽籤用 `state.rng.shuffle(participatingFactions)[0]` 維持 deterministic（同 seed 必同結果）。

##### 4. 行軍路徑「中途」被切入（路徑上某 tile 突然 contested）

- Marching stack 抵達該 tile 時走 §3.5.4 #2 (e) — force-join、加入戰鬥、path 丟棄。
- v1.0 期 §3.5.4 #6「停在前一格從相鄰戰鬥」**徹底廢除**，因為鄰邊戰鬥模型已不存在。

> **設計原則**：所有抵達事件 dry-run 後同步寫回；同 tick 內順序無關（多個 stack、多個 tile 互不影響、可並行解析）。

> **頭對頭碰撞規則（v1.0 §3.5.4 #4/#5）廢除**：v1.2 後敵方 marching stack 同 tick 抵達同 tile = 兩家都變 occupant，下 tick 走 §3.6 同 tile 戰鬥。**不再一次性互砍**。倖存 / 同歸於盡判定全部交給 §3.6 處理。

> **§3.5.5 / §3.5.6（已移除，v1.0）**：原 v0.11 加入的 castle 自動溢出與 castle vs castle BFS hops 例外，皆為 AI 收斂機制的補強。AI 部分整段移出 v1.0 後一併下線；engine `src/engine/overflow.ts` 程式碼仍在 repo 內但 PRD 已不規範其行為，未來 AI 重啟時要重審規格。完整 v0.12 描述見 git tag `archive/prd-v0.12`。

### 3.6 戰鬥公式（v1.2 — 同 tile multi-occupant + step-function ramp）

**結算對象**：每個 tile，若 `occupants` 中存在 2+ 不同 faction → 該 tile 進入戰鬥狀態。單方獨佔（含 0 / 1 occupant）不觸發。

**Tile-level 戰鬥狀態欄位**：

```ts
type Tile = {
  readonly id: TileId;
  readonly isCastle: boolean;
  readonly castleOwner: FactionId | null;  // 設計時就決定的 castle 所屬 faction，永不變動；非 castle = null
  readonly occupants: readonly Occupant[];
  readonly combatStartTick: number | null;  // tile 上首次出現 2+ 敵對 faction 時鎖定的 tick；戰鬥結束清為 null
};

type Occupant = {
  readonly faction: FactionId;
  readonly amount: number;
  readonly arrivalTick: number;
  readonly isDefender: boolean;
};
```

**`combatStartTick` 的設定 / 清除規則**：
- 設定：tile 從「≤ 1 faction」變成「2+ faction」的那一 tick，`combatStartTick = currentTick`。
- 清除：tile 從「2+ faction」回到「≤ 1 faction」（殲滅 / 同歸於盡）的那一 tick，`combatStartTick = null`。
- 戰鬥期間（持續 2+ faction）→ **不重設**，即使有增援抵達或新入侵者加入也維持原值。

**Combat tick `t` 定義**：`t = currentTick - tile.combatStartTick`（從 0 起算）。

**傷害公式（step function）**：

```
damage(t) = 2 ** Math.floor(Math.log2(Math.max(t, 1)))
```

對應表：

| t（combat tick） | damage |
| ---------------- | ------ |
| 0                | 1      |
| 1                | 1      |
| 2–3              | 2      |
| 4–7              | 4      |
| 8–15             | 8      |
| 16–31            | 16     |
| ...              | 2^k    |

**駐紮方 tick-0 優勢**：當 `t === 0`，**只有 defender occupant 攻擊**，所有非 defender occupant 該 tick 不還手。`t ≥ 1` 起所有 occupant 互打。

**每 tick 結算順序**（dry-run，所有計算先讀「加法階段後的 amount」、最後同步寫回）：

```
for each tile with len(occupants) >= 2 and >= 2 distinct factions:
    t = currentTick - tile.combatStartTick
    base = damage(t)

    for each occupant i:
        i.outgoing = 0
        if t == 0 and not i.isDefender:
            continue  # 入侵者首 tick 不還手
        for each occupant j ≠ i with j.faction ≠ i.faction:
            actual = min(base, i.amount)  # 自身 amount 不足時封頂；對每個 j 獨立計算
            j.incoming += actual

    # 同步減血（dry-run 寫回）
    for each occupant i:
        i.amount = max(0, i.amount - i.incoming)

    # 殲滅退出
    occupants = [o for o in occupants if o.amount > 0]

    # 戰鬥結束判定
    remaining_factions = distinct faction in occupants
    if len(remaining_factions) <= 1:
        tile.combatStartTick = null
```

**重點規則**：

- **多方混戰獨立計算**：occupant i 對「每個」敵對 occupant j 各發動一次攻擊，**每次都以 i 自己當下的 amount 套上限**（不會因為打了一個 j 就減損對下一個 j 的輸出）；i 自己受的總傷害 = `sum_over_j(min(base, j.amount))`。同陣營 occupant 不互打（但 v1.2 規則保證同 tile 同 faction 只有 1 個 occupant，理論上不會同 faction 多 entry）。
- **傷害上限**：`actual = min(base, attacker.amount)`。`attacker.amount` 取**加法階段結束後**的值（即增援已併入後的 amount）。
- **同 tick 內加法優先於減法**：增援併入 occupant amount（§3.5.4 #2(c)、#2(e)）發生在 §3.6 傷害結算**之前**。castle 產兵（§3.3）也是「加法」，同 tick 順序定義於 §3.2 step order。
- **殲滅判定**：amount 在減法結算後 ≤ 0 → 該 occupant 從 `occupants[]` 移除。
- **同歸於盡**：所有 occupant 同 tick 全歸零 → tile 變空（`occupants = []`），`combatStartTick = null`，無勝方。
- **戰鬥結束 = ≤ 1 faction 存活**：若剛好 1 faction 存活且為多 occupant（不可能，同 faction 同 tile 只 1 entry，此 case 不存在），或 1 faction 1 occupant，戰鬥終止；該 faction 取得 tile 控制（若該 tile 是 castle 且新 owner ≠ castleOwner → §6 觸發敗北）。
- **Defender 屬性的延續**：戰鬥中 `isDefender: true` 的 occupant 被殲滅 → 其 isDefender 屬性消失（occupant 被移除）。剩下的 occupant 若再進入新戰鬥（之後又有敵方入侵），則新戰鬥開始時，當下 tile 上**最小 `arrivalTick`** 的 occupant 重新被授予 `isDefender: true`（若有多家同最小 arrivalTick → 用 §3.5.4 #3 抽籤規則）。
- **增援不改變 defender 身分**：同 faction 增援併入既有 occupant 不改其 `isDefender`；新 faction 入侵（變新 occupant）一律 `isDefender: false`。

**佔領語意**：

- Tile 「歸屬」由 `occupants` derive：`occupants.length === 1 ? occupants[0].faction : (occupants.length === 0 ? castleOwner ?? null : 'CONTESTED')`。**`Province.owner` 欄位徹底刪除**（v1.2）。
- BFS passable 判定（§3.5.2）改以 derived ownership 為據。
- Castle 失守判定（§6）：`tile.isCastle && (tile.occupants.length === 0 || (tile.occupants.length === 1 && occupants[0].faction !== tile.castleOwner) || (tile.occupants.length >= 2 && no occupant has faction === tile.castleOwner))` — 即 castle 上找不到原 owner faction 的 occupant → 該 faction 敗北。

**範例計算 1（AC-V2-01 driver）— 駐紮 50 vs 入侵 36，無增援**：

| tick | combat tick t | damage | A→B 實際 | B→A 實際 | A 殘 | B 殘 | 備註 |
| ---- | ------------- | ------ | -------- | -------- | ---- | ---- | ---- |
| 0    | 0             | 1      | -1       | 0        | 50   | 35   | tick-0 駐紮優勢：A defender 攻 B，B 不還手 |
| 1    | 1             | 1      | -1       | -1       | 49   | 34   |  |
| 2    | 2             | 2      | -2       | -2       | 47   | 32   |  |
| 3    | 3             | 2      | -2       | -2       | 45   | 30   |  |
| 4    | 4             | 4      | -4       | -4       | 41   | 26   |  |
| 5    | 5             | 4      | -4       | -4       | 37   | 22   |  |
| 6    | 6             | 4      | -4       | -4       | 33   | 18   |  |
| 7    | 7             | 4      | -4       | -4       | 29   | 14   |  |
| 8    | 8             | 8      | -8       | -8       | 21   | 6    |  |
| 9    | 9             | 8      | -8       | -6       | 15   | 0    | B 實際 = min(8, 6) = 6（B 剩 6，封頂）；A 實際 = min(8, 21) = 8；B 歿 |

> Combat tick `t = currentTick - combatStartTick`。表中假設 combat 開始於 tick 0（即 tile 在 tick 0 就有 2 個敵對 occupant）。實際遊戲中 currentTick 從 1 起算，但 combat tick 仍從 0 起算。

**範例計算 2（AC-V2-02 driver）— 同上但 tick 9 有 B 友軍 +10 增援**：

| tick | 加法（增援）        | combat tick t | damage | A→B 實際 | B→A 實際 | A 殘 | B 殘 |
| ---- | ------------------- | ------------- | ------ | -------- | -------- | ---- | ---- |
| 8    | —                   | 8             | 8      | -8       | -8       | 21   | 6    |
| 9    | B +10（合併為 16）  | 9             | 8      | -8       | -8       | 13   | 8    |
| 10   | —                   | 10            | 8      | -8       | -8       | 5    | 0    |

tick 9 結算詳細：
1. 加法階段（§3.2 step order step 1 → step 2 produce）：B 友軍從相鄰 tile 抵達，併入既有 B occupant：`B.amount = 6 + 10 = 16`。
2. 減法階段（§3.2 step order step 3 combat）：`t = 9`，`damage = 8`。
   - A→B：`min(8, A.amount=21) = 8`。
   - B→A：`min(8, B.amount=16) = 8`（加法後的 16 足以打滿 8）。
3. 套用：A = 21-8 = 13；B = 16-8 = 8。雙方 > 0，戰鬥繼續。

無增援版本 B 早在 tick 9 陣亡（殘值 0、A 殘 15）；有增援版本 B 延後一 tick 才陣亡（tick 10 殘 0、A 殘 5）。

**設計意圖**：

- 同 tile multi-occupant 讓「攻擊 = 進入敵格」與 RTS 通用直覺一致，視覺上多 sprite 在同格互砍對應遊戲規則。
- Step function 比 v1.1 線性 ramp 更平緩前段（t=0–1 都只 1 傷害），給玩家 1–2 ticks 觀察情勢、派援軍的視窗；後段在 t ≥ 4 起仍快速升爆，保證收斂。
- Tick-0 駐紮優勢給 castle / 守土結構性激勵：玩家攻方知道要打主城至少先賠一 tick 傷害，不能一兵試水。
- 增援機制 + 同 tick 加法優先讓「援軍救援」變成戰術核心；玩家或 AI 看到自己 occupant 即將陣亡時可派相鄰友軍救一 tick。

**收斂保證**：對任意 2-faction 對戰，雙方 amount = a, b（a ≤ b）→ 約 `log₂(a) + log₂(a/2) + ... ≈ 2·log₂(a)` 個 tick 內結束（step function 後段每 tick 砍掉 `damage(t)` ≈ `t/2`，累積扣 `damage` 是幾何級數）。多 faction 混戰更快，每方受 `(N-1)·damage(t)` 傷害。

> **§3.6.1（已移除，v0.12）**：原「相鄰勢力空格佔領（adjacent claim）」規則於 v0.12 撤回。v1.2 後 tile ownership 由 `occupants` derive，「鄰邊 claim」概念徹底消失，§3.6.1 不再有 revival 空間。

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
- **同格定義（v1.2 更新）**：同一 tile id 的多 occupant（含原有駐紮 + 行軍抵達後新增、多條行軍同 tick 抵達後合併）視為「在同格」，走 §3.5.4 抵達加法規則與 §3.6 同 tile 戰鬥規則。**v1.2 起一個 tile 可同時有 0..N 個 occupant**（每個不同 faction 各 1 個）；沒有「sub-cell」概念，每個 occupant 在視覺上共享同 tile 顯示空間（多 sprite 並陳，渲染細節見 §5.1）。每 occupant 內部單一 amount / derived tier；同 faction 在同 tile 永遠只 1 個 occupant entry。

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

- 玩家「佔領所有其他勢力的主城」 → 勝利畫面。「佔領 castle X」於 v1.2 定義為：castle X 的 tile 上找不到 `faction === X.castleOwner` 的 occupant（即原 owner faction 被殲滅），且該 tick 結算後 castleOwner faction 被標為 `defeated`。
- 或：在所有其他勢力皆已敗北（被其他勢力滅了）的狀態下玩家主城仍在 → 勝利。

### 6.2 敗北

- 玩家主城 tile 上找不到玩家 faction 的 occupant → 敗北畫面（不論奪城者是誰）。

### 6.3 非玩家勢力敗北

- 非玩家勢力主城淪陷 → 該勢力 `defeated = true`（沿用 `GameState`）。
- 敗北 faction 的留存單位處置（v1.2）：
  - **既有 tile occupant**：留在原 tile 上，amount 不變，但 `faction` 視同 `NEUTRAL`（轉為野怪）。後續 §3.6 戰鬥按 NEUTRAL 規則參與（不主動還手、不產兵，但仍會被打）。
  - **行軍中的 marching stack**：v1.2 簡化處理 — `defeated` 觸發瞬間，該 faction 所有 marching stack **立即消滅**（不再抵達任何 tile）。原因：敗北瞬間發生於 castle 淪陷的 tick，此時繼續推進其 marching stack 違反「敗北 = 立即停止行動」直覺；且 multi-occupant 模型下讓死掉 faction 的 stack 繼續抵達會造成 ownership 標籤混亂。
- 敗北勢力的留存 occupant 在後續結算中視同 `NEUTRAL`：正常被打、不主動攻擊（因為 NEUTRAL 無 defender 角色，§3.6 對 NEUTRAL occupant 的 outgoing damage 視為 0；其他 faction 對 NEUTRAL occupant 的 incoming 正常計算）。**例外**：若 NEUTRAL occupant 同 tile 有多家敵對 faction 在打，NEUTRAL 不算「敵對 faction 之一」 — 戰鬥仍在那些 active faction 之間結算，NEUTRAL 是純被動 punching bag。

## 7. Acceptance Criteria（可驗證）

> **v1.2 大規模重編**：原 AC-01..AC-39 **整段作廢**，新規從 `AC-V2-01` 起。原因：v1.2 戰鬥模型全換（鄰邊 → 同 tile multi-occupant），多條 AC（08 / 17 / 18 / 19 / 20 / 21 / 36）語意全變；其餘看似不受影響的 AC（01 / 02 / 03 / 04 / 05 / 06 / 07 等）也因為 Province schema 改動（移除 `owner`、加入 `occupants[]`）連帶 test fixture 全需重寫。為避免 PR / git log 中 AC 號意義混亂，PRD / MILESTONES / commit / PR description 一律改用 `AC-V2-XX` 前綴。
>
> **PR / Test 編號規則**：
> - 新測試 `it("[AC-V2-XX] ...")` 命名（注意 `V2-` 在中間，整體仍是 ASCII）。
> - 舊 `it("[AC-08] ...")` 等若 test 行為仍適用新模型，可重命名為 `it("[AC-V2-NN] ...")`；行為失效則整條刪除。
>
> 原 AC-01..AC-39 完整描述見 git tag `archive/prd-v1.1`（或本檔 v1.1 commit）。下方 §7.1 列出 v1.2 → v1.1 對照，§7.2 為新 AC-V2 表。

### 7.1 舊 AC 作廢索引（v1.2 → v1.1 對照）

| 舊 AC      | v1.2 處置                                                              |
| ---------- | ---------------------------------------------------------------------- |
| ~~AC-01~~  | 重編為 AC-V2-01（11x11 棋盤、4 主城、玩家 Tokugawa）                  |
| ~~AC-02~~  | 重編為 AC-V2-02（tick 計數每 2 秒）                                   |
| ~~AC-03~~  | 重編為 AC-V2-03（castle 每 2 ticks +1 給 castleOwner occupant）       |
| ~~AC-04~~  | 重編為 AC-V2-04（deriveTier 閾值 5/12/25）                            |
| ~~AC-05~~  | 重編為 AC-V2-05（tier 降級）                                          |
| ~~AC-06~~  | 重編為 AC-V2-06（拖曳派遣 + BFS 路徑高亮）                            |
| ~~AC-07~~  | 重編為 AC-V2-07（派遣後來源 amount 減 / 目標 amount 加）             |
| ~~AC-08~~  | 整段重寫為 AC-V2-08（同 tile 50 vs 36 step-function ramp）            |
| ~~AC-09~~  | 重編為 AC-V2-09（空格被佔領 → derived owner 變更）                   |
| ~~AC-10~~  | 重編為 AC-V2-25（佔領敵方主城 → defeated + 留存 occupant 轉 NEUTRAL）|
| ~~AC-11~~  | 重編為 AC-V2-12（玩家敗北畫面）                                       |
| ~~AC-12~~  | 重編為 AC-V2-27（玩家勝利畫面）                                       |
| ~~AC-13~~  | 重編為 AC-V2-13（暫停 / 繼續）                                        |
| ~~AC-14~~  | 重編為 AC-V2-14（2x 速度）                                            |
| ~~AC-15~~  | 持續 deferred（AI 行為類）                                            |
| ~~AC-16~~  | 重編為 AC-V2-15（主城派遣留 1）                                       |
| ~~AC-17~~  | 整段廢除（頭對頭一次性碰撞模型不存在）→ 新增 AC-V2-16 force-join 取代 |
| ~~AC-18~~  | 整段廢除（路徑被切停前一格不再適用）→ 新增 AC-V2-16 force-join 取代  |
| ~~AC-19~~  | 整段重寫為 AC-V2-17（同 tile 3 vs 3 step-function ramp）              |
| ~~AC-20~~  | 重編為 AC-V2-18（同陣營雙 stack 同 tick 抵達合併 + path 選擇）       |
| ~~AC-21~~  | 整段廢除（頭對頭非終點概念不存在）→ AC-V2-16 涵蓋                    |
| ~~AC-22~~  | 持續 deferred（AI 行為類）                                            |
| ~~AC-23..26~~ | 持續廢除（§3.6.1 已於 v0.12 移除）                                 |
| ~~AC-27..35~~ | 持續 deferred（AI 行為類）                                         |
| ~~AC-36~~  | 一半重編為 AC-V2-19（4-conn BFS 鄰格），戰鬥配對部分廢除（v1.2 無鄰邊戰鬥） |
| ~~AC-37~~  | 重編為 AC-V2-20（idle 模式）                                          |
| ~~AC-38~~  | 重編為 AC-V2-21（scripted 模式）                                      |
| ~~AC-39~~  | 重編為 AC-V2-22（玩家派遣無 hop 上限）                                |

### 7.2 AC-V2 新表

| #         | 條件                                                                                                                            | 驗證方式                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| AC-V2-01  | 啟動後可見 **11x11** 棋盤、4 主城在四角、玩家為 Tokugawa                                                                        | 開啟瀏覽器肉眼確認                                                                                                |
| AC-V2-02  | Tick 計數每 2 秒 +1，HUD 顯示                                                                                                   | 觀察 10 秒應為 5 ticks                                                                                            |
| AC-V2-03  | castle tile 每 2 ticks 對 castleOwner faction 的 occupant amount +1；無 castleOwner occupant 時暫停產兵                          | Headless：advance 20 ticks，斷言 castle occupant amount +10；移除 castleOwner occupant，斷言下 tick 不 +1         |
| AC-V2-04  | occupant amount 達 5 → derived tier 為 Knight；達 12 → Queen；達 25 → King（閾值同 v0.9）                                       | Headless：setAmount(5/12/25)，斷言 deriveTier 回傳正確 tier                                                       |
| AC-V2-05  | amount 從 12 掉到 11 → tier 退回 Knight；從 5 掉到 4 → 退回 Soldier                                                              | Headless：模擬戰鬥減 amount，斷言 derived tier 更新                                                              |
| AC-V2-06  | 從己方 tile（含 castle 或一般領地）hold-drag 到 5 格外目標 → 顯示 BFS 路徑高亮，**目標格為敵方獨佔 / contested 時仍可派遣**     | 操作確認；嘗試 drag 到敵方相鄰格、敵方 5 格外、contested tile                                                     |
| AC-V2-07  | 派遣後來源 tile 的己方 occupant amount 減少對應數；marching stack 抵達後在目標 tile 新增 occupant 或併入既有同陣營 occupant     | 觀察兩 tile amount 變化吻合；測試比例 50% / 100%                                                                  |
| AC-V2-08  | **§3.6 case 1**：tile 上 A (TOKUGAWA, amount=50, isDefender=true, arrivalTick=0) + B (TAKEDA, amount=36, isDefender=false, arrivalTick=0)、combatStartTick=0；逐 tick advance 後 amount 序列吻合範例計算表（tick 9 結束時 A=15、B=0、B occupant 退出） | Headless：建場景、逐 tick advance、斷言 occupants[].amount 序列與 combatStartTick                                |
| AC-V2-09  | 空格被相鄰己方派遣 / 推進抵達後 → derived owner 變為該勢力（占有 occupant.faction），HUD 計數更新                                | 操作確認 + Headless                                                                                              |
| AC-V2-10  | 同 tile 3 個敵對 occupant（A 50 / B 30 / C 20，A 為 defender）：每 occupant 對另兩 occupant 各獨立發動一次攻擊，傷害上限以自身 amount 算（同 tick 內不會因為打了一個就減損下一個）；tick 0 只有 A 攻 B 和 C，B 與 C 互攻但不攻 A | Headless：逐 tick advance，斷言 incoming damage 矩陣計算正確                                                     |
| AC-V2-11  | 同 tick 多 faction marching stack 抵達空 tile：用 `state.rng.shuffle` 抽 defender，同 seed 必同結果；其餘 isDefender=false       | Headless：固定 seed，運行 5 次斷言抽中的 defender faction 完全相同                                               |
| AC-V2-12  | 玩家主城淪陷（castleOwner 在 castle tile 上 occupant 被殲滅）→ 敗北畫面 + 重新開始                                              | 操作確認 / Headless：刻意送敵入主城打殲滅                                                                         |
| AC-V2-13  | 暫停按鈕停止 tick，恢復後從停止處繼續                                                                                           | 暫停 5 秒後恢復，tick 數連續                                                                                      |
| AC-V2-14  | 2x 速度按下後 tick 間隔 = 1 秒                                                                                                  | 計時 10 秒應為 10 ticks                                                                                           |
| AC-V2-15  | 主城派遣 100% 時來源至少保留 1 兵（即送 `count - 1`）                                                                          | 操作 / Headless：主城 amount=10、派遣 100%，斷言來源 amount=1、marching stack count=9                            |
| AC-V2-16  | **§3.5.4 #2(e) force-join**：marching stack 抵達 contested tile（無論友軍 / 敵軍 / 是否終點）→ 強制變 occupant 加入戰鬥；同陣營 → 併入既有 occupant amount；新 faction → 新增 occupant `isDefender=false`；marching stack 原 path 丟棄 | Headless：擺好 contested A vs B tile + 第 3 faction（C）的 marching stack 抵達 → 斷言 C 變新 occupant、原 stack 從 state.marchingStacks 移除；另測同 faction 增援 case |
| AC-V2-17  | **§3.6 case 1 reinforcement (case 2)**：同 AC-V2-08，但於 tick 9 進入結算前有一條友軍 marching stack（TAKEDA, count=10）抵達同 tile；當 tick 加法（B amount 6→16）先於減法（雙方各扣 8）；結算後 A=13、B=8；tick 10 結束時 A=5、B=0 | Headless：設定 marching stack arrivalTick=9，advance(10)，斷言序列                                                |
| AC-V2-18  | 同陣營雙 marching stack 同 tick 抵達同 tile → 合併為單一加法事件；path 取剩餘步數最少；tiebreak 取早派遣者                       | Headless：派遣 stack A（剩 3 步）+ stack B（剩 1 步）同時抵達；斷言合併後 marching stack（若非終點）path 用 B 的剩餘 path、count 加總 |
| AC-V2-19  | **§3.8 4-conn 鄰格**（BFS only）：tile `(5,5)` 對 `(6,5)/(4,5)/(5,6)/(5,4)` 皆鄰格；對 `(6,6)/(4,4)/(6,4)/(4,6)` 不鄰格；BFS `findPath((5,5)→(6,6))` 必須繞行非對角路徑。**戰鬥不再以鄰格為單位**（v1.2 戰鬥在同 tile，非鄰格） | Headless：擺場景驗 BFS 鄰格 + 路徑；不再驗鄰格戰鬥配對                                                            |
| AC-V2-20  | scenario `aiConfig` 全填 `"idle"` 跑 100 ticks，非玩家勢力 marching stacks count 始終 = 0；TOKUGAWA castle occupant 仍每 2 ticks +1 | Headless：建 idle scenario 跑 100 ticks                                                                          |
| AC-V2-21  | scenario `scriptedCommands` 指定 `{atTick: 5, from: [10,0], to: [9,0], ratio: 1.0}`、TAKEDA aiConfig=`"scripted"` → tick 5 真的派一條 marching stack | Headless：advance(10) 後斷言只有 tick 5 出現 TAKEDA marching stack 一筆                                          |
| AC-V2-22  | 玩家派遣**無 hop 上限**：hold-drag 從主城到 BFS 路徑長 = 18 hops 的目標格（全程 passable）dispatch 成功；中間切一格非 passable → 紅色拒絕 | UI + Headless `findPath` 雙端驗                                                                                  |
| AC-V2-23  | **BFS passable（v1.2 multi-occupant 版）**：contested tile（2+ faction）**不**可作為中間經過格；空 tile 或純己方獨佔 tile 可                                                                                                  | Headless：擺 contested tile 在路徑中間，斷言 BFS 跳過該 tile 或回傳 null（無繞路）；改用空 tile 中間，斷言 BFS 找到 |
| AC-V2-24  | **同歸於盡**：兩家 amount 相同的 occupant 同 tick 互砍至 0 → occupants=[]、combatStartTick=null；下 tick tile 為空（無 owner、可被任何 faction 派遣抵達）                                                                       | Headless：擺 2 vs 2 對戰（兩家同 amount），advance 到雙方歸零，斷言 tile state                                   |
| AC-V2-25  | 佔領敵方主城 → 該 AI 勢力 `defeated`，留存 occupants 轉 NEUTRAL（不主動還手、可被打），該 faction 所有 marching stack 立即消滅                                                                                                | 操作確認 + 控制台 / Headless 跑「玩家秒殺敵 castle」場景                                                          |
| AC-V2-26  | **Castle 產兵與戰鬥同 tick**：A 在自家 castle 上 amount=1，B 入侵 amount=5，combatStartTick=0；advance(1) 應觀察到 castle 產兵 +1 → A 加法後 amount=2，combat 減法 A 對 B 扣 `min(1, 2)=1`、B 不還手（tick 0 駐紮優勢）→ A=2、B=4 | Headless：精確驗 step order step 2 (produce) 先於 step 3 (combat)                                                |
| AC-V2-27  | 玩家佔領所有 3 個敵 castle → 顯示「勝利」畫面                                                                                   | 操作確認                                                                                                          |
| AC-V2-28  | 同 tile 3 vs 3 對峙（兩家 amount=3，A 為 defender）：advance(1) → A=3 / B=2（tick 0 駐紮優勢，A 攻 B 不還手）；advance(2) → A=2 / B=1（tick 1，damage=1，互打）；advance(3) → A=0 / B=0（tick 2，damage=2，互砍至盡同歸於盡）；tile 變空、combatStartTick=null | Headless：擺 3 vs 3，逐 tick advance，斷言序列 + tile state                                                       |
| AC-V2-29  | **Self-replicate（駐紮分裂）**：非戰鬥 tile 上 `amount ≥ 1` 且 `< 100` 的非 NEUTRAL / non-defeated occupant 每 tick +1。contested tile 不分裂；NEUTRAL bandits 不分裂；defeated faction 不分裂。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Headless：擺各種 occupant 狀態跑 produce + advance，斷言成長／不成長序列                                          |
| AC-V2-30  | **Walk-through claim**：marching stack 非終點走過無 hostile 兵的 tile → `tile.lastClaimedFaction = stack.faction`；`derivedOwner` 對空 tile 回傳 lastClaimedFaction。Castle tile 的 castleOwner 不變；若 castle 變空且其他勢力走過，lastClaimedFaction 更新但 castleOwner 不動。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Headless：擺空敵 tile + 派 marching stack 經過（不抵達），斷言 lastClaimedFaction 已標 stack 勢力、derivedOwner = stack 勢力 |

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

| 模組                       | 職責（v1.2）                                                |
| -------------------------- | ----------------------------------------------------------- |
| `src/engine/state.ts`      | `GameState`、`Province { id, isCastle, castleOwner, occupants[], combatStartTick }`、行軍佇列。**`owner` 欄位刪除**；`stalemates`/`engagements` 欄位刪除（v1.2 不再用） |
| `src/engine/tick.ts`       | Tick 推進器（純函數 step(state) → state'）；step order v1.2：`movement → produce → combat → defeats → victory` |
| `src/engine/upgrade.ts`    | `deriveTier(amount)` 純函數                                 |
| `src/engine/combat.ts`     | **整檔重寫**：`resolveSameTileCombat(state)` — 對每個 contested tile 結算 §3.6 step-function ramp、defender tick-0 優勢、multi-party 獨立攻擊、damage 上限封頂；同時更新 `combatStartTick`（首戰設定、戰鬥結束清空）|
| `src/engine/movement.ts`   | BFS 路徑（含 v1.2 passable 規則）+ marching stack 推進 + §3.5.4 抵達加法解析（含同陣營合併、新增 occupant、force-join）|
| `src/engine/production.ts` | 主城產兵 — 為每個 castle 找到 castleOwner faction 的 occupant，amount +1；找不到 occupant 時 skip |
| `src/engine/victory.ts`    | 勝負判定 — castle tile 上 castleOwner faction 無 occupant → defeated；defeated faction 留存 occupant 改 NEUTRAL、marching stack 立即消滅 |
| `src/engine/types.ts`      | 共用型別 — `FactionId`、`Tier`、`TileId`、`Province`、`Occupant`、`MarchingStack`；**移除**：`StalemateMap`、`EngagementMap`、`PairKey`、`CombatPair`（鄰邊戰鬥模型 artifact） |

> **v1.1 → v1.2 schema diff**（已知 breaking change）：
>
> - `Province` 移除：`owner: FactionId`、`count: number`、`tier: Tier`（後者本就 derived，但若以 cache 欄存在則 v1.2 一併移除）。
> - `Province` 新增：`castleOwner: FactionId | null`、`occupants: readonly Occupant[]`、`combatStartTick: number | null`。
> - `GameState.engagements: EngagementMap`（v1.1 引入）：**移除**。
> - `GameState.stalemates: StalemateMap`（v1.0 已移除，但若仍在 schema 內）：確認清除。
> - `Province.lastClaimedAtTick`（v0.12 已移除）：確認 schema 清除。
>
> Engine 中 `src/engine/ai.ts`（含 `stepAi`、rule #1/#2/#2.5/#3 實作）、`src/engine/overflow.ts`（castle overflow phase）目前**仍在 repo 內**，但 v1.2 後其行為**幾乎必然錯**（讀取 `province.owner`、`province.count` 等已刪欄位 → typecheck fail）。M1.x 重啟 AI 規格前必須整檔重寫，**v1.2 動工時建議直接 stub 為 `return state`**（保留 export 簽名供 `tick.ts` 呼叫但無實際行為），避免 typecheck 卡死。

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
