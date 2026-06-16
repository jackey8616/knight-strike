# MILESTONES — Knight Strike

本文件把 [`PRD.md`](PRD.md) 切成交付 milestone，給 `/goal` 與 PR 計劃用。**規格不在此重述**，所有玩法/數值/規則查 PRD；本文件只列「做什麼、涵蓋哪些 AC、怎麼判收」。

> PRD 同步基準：**v1.0**（pruned baseline，AI 整段移出，等次輪 PRD 重設計）。當前 v1 acceptance 不涵蓋任何 AI 行為；本文件 M1.8 / M2.2.5–M2.2.8 / M3 等 AI 相關 milestone 統一標 **deferred**，等 AI 規格回到 PRD 後再重啟。v0.12 完整 AI milestone 描述見 git tag `archive/prd-v0.12`。

工具鏈、命名、分層鐵則查 [`CLAUDE.md`](../CLAUDE.md)。

---

## 全域約定

- 每個 task 設計成 **1–3 個 Claude turn** 內完成；超過就拆。
- 每個 milestone 標 **turn 上限**，給 `/goal` 設 `--max-turns`。
- 每個 milestone 結尾有一個 **Manual Smoke**，必須由人類親自跑過才放行。
- **退出條件 = 一個或數個指令能 mechanical 驗證**；指令全綠才視為 milestone 完成。
- Future scope（PRD §8）不在任何 milestone。

---

## M1 — Engine Core + Headless Playtest（已 shipped，v0.12 期間完成）

> **歷史 milestone**：M1 全段於 v0.12 完工並通過 manual smoke。本 milestone 下的 sub-tasks 細節（含 AI 相關 M1.8）保留作 reference，但 AI 部分已隨 PRD v1.0 標 deferred。v1 工作不會再回頭動 M1 sub-tasks，只有 engine bug fix 才重新打開。

**v0.12 退出條件（已達成）**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && \
pnpm playtest src/scenarios/default.json --runs 10 --max-ticks 500
```

當時涵蓋 AC：AC-02 / 03 / 04 / 05 / 08 / 16 / 17 / 18 / 19 / 20 / 21（加 AC-15 / 22 / 27..32 的 AI 部分，已隨 v1.0 下線）。

### M1.0 — 環境準備（toolchain）

- 檔案：`package.json`、`.nvmrc`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`.eslintrc.cjs`、`.prettierrc.json`、`lefthook.yml`
- 對應 PRD：§9.5、§11
- 對應 CLAUDE.md：§2、§4.1、§4.5、§6、§9.2、§9.3
- 依賴：無
- 動作：移除 `three` / `@types/three`；安裝 Pixi.js v8、GSAP（保留版本）、vitest、@vitest/coverage、ESLint + Prettier、lefthook、tsx。鎖 Node 22；設定 strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`；vite/vitest 共用 `@/*` alias；ESLint engine 目錄 `no-restricted-imports` 鐵則上線。
- 完成定義：`pnpm install` 乾淨、`pnpm typecheck` 過（即使源碼幾近空）、`pnpm lint` 過、`pnpm test:run` 過（0 個測試也算過）。

### M1.1 — Types & State

- 檔案：`src/engine/types.ts`、`src/engine/state.ts`、`src/engine/util/rng.ts`、`src/engine/util/rng.test.ts`
- 對應 PRD：§2、§3.1、§3.1.1、§3.5.3、§10.2
- 依賴：M1.0
- 完成定義：`FactionId` / `Tier` / `TileId` / `Province` / `MarchingStack`（含 `id` / `dispatchedAtTick`）/ `GameState` / `StalemateMap` 型別齊全、皆 `readonly`；seedable PRNG（mulberry32 或同等）有 test 驗確定性。`Province.lastClaimedAtTick` 欄位於 PRD v0.12 §3.6.1 移除後一併下線（歷史 M1.6.5 曾要求加入）。

### M1.2 — Upgrade（deriveTier）

- 檔案：`src/engine/upgrade.ts`、`src/engine/upgrade.test.ts`
- 對應 PRD：§3.4
- 對應 AC：AC-04、AC-05
- 依賴：M1.1
- 完成定義：閾值 **5/12/25**（v0.9）四 tier 表驗、降級（12→11、5→4）驗、邊界 0 / 負數防呆。
- 註：PRD §11.1 保留「實作可 revert 為 v0.8 baseline 5/15/30」的歷史脫鉤條款；測試以 §3.4 主文 + AC-04/05 標註的 5/12/25 為準，若實作 revert 需同步調整測試常數並在 PR 註明。

### M1.3 — Production（主城產兵）

- 檔案：`src/engine/production.ts`、`src/engine/production.test.ts`
- 對應 PRD：§3.2、§3.3
- 對應 AC：AC-03
- 依賴：M1.1
- 完成定義：每 2 ticks +1、敵方佔領中時不產兵；tick 0 不產、tick 2 首發。

### M1.4 — Combat formula + adjacency 結算

- 檔案：`src/engine/combat.ts`、`src/engine/combat.test.ts`
- 對應 PRD：§3.6
- 對應 AC：AC-08
- 依賴：M1.2
- 完成定義：`computeLoss(own, opp)` 純函數、相鄰 pair 同步雙寫、多敵相鄰累加 loss、AC-08 數字精確（10S vs 5K → 6 / 4 且 tier 降回）。

### M1.5 — Stalemate counter（drain mode）

- 檔案：`src/engine/combat.ts`（合入 `updateStalemates`）、`src/engine/combat.test.ts` 增 case
- 對應 PRD：§3.7
- 對應 AC：AC-19
- 依賴：M1.4
- 完成定義：3v3 對峙 advance(4) 仍 3、advance(5)=2、(6)=1、(7)=0 精確命中；pair 解散時 counter 丟棄；loss>0 時 counter 歸零、drain 不疊加 loss。

### M1.6 — Movement：BFS + marching stack + 碰撞

- 檔案：`src/engine/movement.ts`、`src/engine/movement.test.ts`
- 對應 PRD：§3.5.1（dispatch 留 1 規則）、§3.5.2、§3.5.3、§3.5.4
- 對應 AC：AC-16、AC-17、AC-18、AC-20、AC-21
- 依賴：M1.1、M1.4
- 完成定義：BFS passable 規則正確、目標可為敵方、無路徑回 null；marching stack `dispatchedAtTick` / `id` 填齊；同勢力合併（最少剩餘步 + tiebreak）AC-20、頭對頭 AC-17/21、路徑被切 AC-18、主城留 1 AC-16 全綠。
- 因公式 + 6 種 collision 子場景一檔太重，實作時可拆成「BFS + dispatch」與「collision 解析」兩個 sub-task（仍同檔）。

### ~~M1.6.5 — Adjacent claim + Hysteresis~~（PRD v0.12 廢除）

> **歷史註記**：本 sub-milestone 於 M1 期間 ship 並通過 AC-23/24/25/26。PRD v0.12 移除 §3.6.1 後，相關 engine 模組（`src/engine/claim.ts` + `claim.test.ts`）、`Province.lastClaimedAtTick` 欄位、tick orchestrator 的 claim phase 3b 一併下線；下游 milestone（M1.9 tick orchestrator）的 step order 同步更新為 v0.12 版本。設計理由見 PRD changelog v0.12。

### M1.7 — Victory 判定

- 檔案：`src/engine/victory.ts`、`src/engine/victory.test.ts`
- 對應 PRD：§6
- 對應 AC：（engine 端 AC-10/11/12 結構，畫面驗證留 M2/M3）
- 依賴：M1.1
- 完成定義：玩家主城失守 → loss；唯一存活勢力 → win；敗北勢力的 stack 轉 NEUTRAL owner 行為符 §6.3。

### ~~M1.8 — AI 狀態機 + RNG shuffle + 評估錯開~~（PRD v1.0 deferred）

> **deferred 註記**：本 sub-milestone 對應 PRD v0.12 §4，於 v1.0 隨 §4 整段移出 PRD。engine `src/engine/ai.ts` 仍在 repo 內但屬規格 orphan；下方原文保留作為「歷史曾如何實作」的參考，AI 規格回到 PRD 後可能整段重寫。

---

- 檔案：`src/engine/ai.ts`、`src/engine/ai.test.ts`
- 對應 PRD：§4.1、§4.2、§4.3、§3.5.1（AI 派遣下限）、§10.2、§11.1（v0.8 baseline 註記）
- 對應 AC：AC-15、AC-22、AC-27、AC-28、AC-29、AC-30、AC-31、AC-32
- 依賴：M1.1、M1.6
- 完成定義：
  - 四條短路規則順序正確（威脅 → 擴張 → 進攻 → 囤兵），第一條觸發即退出本次評估。
  - 候選 shuffle 用 §10.2 `rngSeed + factionId + tick` 推導；評估錯開（Tokugawa tick 1 / Takeda 2 / Oda 3 / Uesugi 4，後續每 5 ticks）。
  - **Rule #2 castle 分階累積保護**（§4.1 v0.8 baseline）：
    - `count < KNIGHT_RESERVE` (= 5) → 禁止派兵
    - `5 ≤ count < QUEEN_RESERVE` (= 15) → 派 25%、source 至少留 5
    - `15 ≤ count < KING_THRESHOLD` (= 30) → 派 33%、source 至少留 15
    - `count ≥ 30` → 派 50%（無 tier 保護）
    - 非主城格：`count ≥ EXPAND_MIN_STACK` (= 5) 才派、固定 50%
    - AC-27 / AC-28 精確驗。
  - **Rule #3 進攻**：`ATTACK_RANGE_HOPS = 8`（v0.8 baseline；PRD §3.4/§4.1 主文 v0.10 寫 12 但 §11.1 已 revert）、`ATTACK_POWER_RATIO = 1.5`（v0.8 baseline）、派遣量 = `source.count - reserve`（非主城 reserve=1、主城 reserve=5）；派遣量 ≤ 0 不 fire。
    - AC-29（非主城 source 距離放寬內 fire）、AC-30（hops 超過不 fire）、AC-31（castle source 保留 5）、AC-32（派遣量 ≤ 0 不 fire）精確驗。
  - **AC 邊界對齊 v0.8 baseline**：AC-29/30 描述用 v0.10 `hops = 12`，本 milestone 實作 `hops = 8`；test 常數以 `ATTACK_RANGE_HOPS` 引用、AC 註解標 PRD §11.1 revert，避免硬編 12 與實作打架。若日後 revert 改回 v0.10 主文值，常數一處改即可。
  - AC-15（30 ticks 內每家 AI 至少佔 1 鄰格）、AC-22（同 seed 結果 hash 一致；異 seed 分歧）過。

### M1.9 — Tick orchestrator（step）

- 檔案：`src/engine/tick.ts`、`src/engine/tick.test.ts`
- 對應 PRD：§3.2（六步結算順序 + 注腳完整 step order）
- 對應 AC：AC-02
- 依賴：M1.3、M1.4、M1.5、M1.6、M1.7、M1.8（原 M1.6.5 已隨 PRD v0.12 §3.6.1 移除而廢除）
- 完成定義：`step(state)` 嚴格依 PRD §3.2 注腳順序（v0.12）：`movement (含 §3.5.4 行軍抵達 claim) → combat → drain (§3.7) → defeats → produce → castle overflow (§3.5.5) → upgrade → victory`；純函數、不 mutate 輸入；tick 編號從 1 起算與 PRD §3.2 對齊（tick 0 僅渲染、無結算；產兵於 tick 2 首次觸發；AI 評估偏移 1/2/3/4 + 每 5 ticks）。

### M1.10 — Headless playtest CLI + scenario loader

- 檔案：`src/playtest/cli.ts`、`src/playtest/runner.ts`、`src/playtest/integration.test.ts`、`src/scenarios/default.ts`、`src/scenarios/default.json`
- 對應 PRD：§10
- 依賴：M1.9
- 完成定義：`pnpm playtest <file>` 跑單場、`--runs N` 統計勝率與場長 (avg/median/p95)、`--log events` 印 per-tick JSON、`--max-ticks` 超時平局；`runScenario(scenario, ticks)` API 同時供 integration test。

### M1.11 — Manual Smoke（人類執行）

- 動作：人類執行 `pnpm playtest src/scenarios/default.json --runs 10 --log events --max-ticks 500`
- 完成定義（依 PRD §11.2 調整）：
  - 10 場無 crash、無無限迴圈
  - event log 無 NaN / 負 count / 主城自殺 / tier 與 count 不一致
  - `max-ticks` 平局視為合法結局，正常計入 stalemate 統計
  - **「平均場長 100–400 ticks」不再是 M1 acceptance**；轉為 M2 的回歸目標（戰場累積機制 / AI 設計改善後再達標，見 [`M2-BACKLOG.md`](./M2-BACKLOG.md)）
- 通過後人類在 PR 標 `M1 manual smoke ✅`。

---

## M2 — 渲染、輸入、UI（v1.0 進行中）

**v1.0 目標**：`pnpm dev` 開瀏覽器，玩家能用滑鼠手動派遣、看到完整視覺回饋、有 HUD/end screen，能在沒有 AI 的環境裡跟 scripted/靜默對手完成一場對局。

**涵蓋 PRD**：§5、§9.2、§9.3、§9.4
**涵蓋 AC**：AC-01、AC-06、AC-07、AC-09、AC-11、AC-12、AC-13、AC-14（+ AC-16 UI 端整合驗證）
**退出條件（v1.0 新版，AI gate 移除後）**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm build
```

加上 `pnpm dev` 後人類在瀏覽器內完成 M2.9 manual smoke 五步驟全綠。

> v0.12 期間 M2 還有一條 spectator 100-run convergence gate（結束率 ≥ 50% / 勝率 ≤ 50% / 場長 ≤ 400 ticks），隨 AI 移出 v1.0 一併下線。Sub-tasks M2.2.5 / M2.2.6 / M2.2.7 / M2.2.8 統一標 **deferred-with-AI**，等次輪 AI PRD 設計回到 PRD 時再決定要不要 revive。

**v1.0 Turn 上限**：剩餘 M2.3–M2.8 約 40–50 turn（含 M2.9 manual smoke）。

### M2.0 — Pixi `Application` + 入口

- 檔案：`src/render/app.ts`、`src/main.ts`、`index.html`
- 對應 PRD：§5.1、§9.2、§9.4
- 依賴：M1
- 完成定義：Pixi v8 初始化、resize、`SCALE_MODES.NEAREST` + `roundPixels`、`main.ts` 接 engine state 與 renderer 並驅動 tick interval（2000ms 預設）。

### M2.1 — Board 渲染（iso 投影 + 高亮）

- 檔案：`src/render/board.ts`、`src/assets/`（既有 `public/knight.png` + placeholder 純色 sprite）
- 對應 PRD：§3.1、§5.1
- 對應 AC：AC-01
- 依賴：M2.0
- 完成定義：11x11 iso 棋盤、4 主城角落可見、玩家為 Tokugawa；hover overlay + selection outline。

### M2.2 — Units 渲染 + tier sprite 切換 + 升級動畫

- 檔案：`src/render/units.ts`、`src/render/combat.ts`
- 對應 PRD：§3.4、§5.1
- 依賴：M2.1
- 完成定義：每格 stack 對應 tier sprite + count 數字；tier 切換 GSAP 金光 scale 動畫；戰鬥 bump + tint flash。
- 註：M2 可用一張 sprite + tint / scale 區分 tier；完整 5 種 sprite 留 M4。

### ~~M2.2.5 — AI Spectator Mode~~（v1.0 deferred-with-AI；已 shipped 程式碼仍在 repo）

- **檔案**：
  - `src/main.ts`（加 spectator entry 邏輯）
  - `src/scenarios/spectator-4ai.json`（新 scenario）
  - `src/ui/minimal-hud.ts`（新建，極簡 HUD，M2.7 完整 HUD 出現後可刪）
- **對應 PRD**：無新規格，純 debug / observation 工具
- **依賴**：M2.0、M2.1、M2.2
- **完成定義**：
  - `pnpm dev` 預設載入 `spectator-4ai.json`
  - 4 勢力全 AI（含 TOKUGAWA），玩家本回合無互動
  - 渲染顯示：棋盤、主城、單位 tier sprite、count 數字、tier 升級動畫、戰鬥 bump
  - tick 自動推進（預設 1x = 2s/tick，可用 keyboard `Space` 暫停、`1`/`2` 變速 — 若 M2.6 keyboard 還未做則僅 Space）
  - 右上角極簡 HUD：`Tick: N | TOK:X TAK:Y ODA:Z UES:W`（4 個數字是各勢力控制格數）
  - 不需要 marching stack 動畫（M2.3 才做）—— AI 派遣的單位可暫時用 sprite 瞬移呈現
  - 不需要 dispatch 手勢、不需要完整 faction panel、不需要 tile info hover、不需要 end screen
- **Turn 上限**：5
- **重要設計約束**：
  - spectator-4ai.json **使用 default scenario 同樣的開局**（4 角主城 count=3），不要為了「跑得通」改參數
  - 此 task 完成後人類會用此 mode 觀察 AI 行為、判斷 BACKLOG P0 議題的解法
  - 觀察過程中發現新議題，依 CLAUDE.md「文件互動規則」寫入 BACKLOG，**不要在這個 task 修 AI**

#### Spectator 觀察清單（給人類用，task 結束後跑）

人類執行 `pnpm dev` 後觀察：

1. Castle 是否如 M1.11 diagnose 所示穩定在 3-6（v0.8 baseline）？
2. AI rule #2 派兵的「來源 → 目標」視覺上是不是一直主城 → 相鄰空格？
3. 戰場 tile 是不是大量 1-2 count 的小 stack 散佈？
4. 兩相鄰敵格戰鬥時，是否如 stalemate counter 預期觸發 drain？
5. ~~claim phase 觸發時，視覺上有沒有「格子瞬間易主但無單位移動」的奇怪感？~~（PRD v0.12 §3.6.1 移除後不再會發生此情境）

觀察結果不在這個 task 處理，但會影響後續 M2 task 順序與 BACKLOG 優先級。

### ~~M2.2.6 — Castle 溢出 + AI Rule #2.5 集結~~（v1.0 deferred-with-AI；已 shipped 程式碼仍在 repo）

- **檔案**：
  - `src/engine/overflow.ts`（新）+ `src/engine/overflow.test.ts`
  - `src/engine/ai.ts`（加 rule #2.5 集結，順序：威脅 → 擴張 → 集結 → 進攻 → 囤兵）+ `src/engine/ai.test.ts` 新增 case
  - `src/engine/tick.ts`（加 castle overflow phase；step order 對齊 PRD §3.2 v0.11）+ `src/engine/tick.test.ts` 更新
- **對應 PRD**：§3.2 step order v0.11、§3.5.5、§4.1 rule #2.5、§4.3 evalOffset 註
- **對應 AC**：AC-33、AC-34
- **依賴**：M1.6、M1.8、M1.9、M2.2.5
- **完成定義**：
  - 純函數 `castleOverflow(state) → { newMarchingStacks, castleCountChanges }`，無 mutation
  - `CASTLE_OVERFLOW_THRESHOLD = 30` 常數匯出
  - Rule #2.5 走同套 §4.3 evalOffset、anchor 選擇 + RNG tiebreak 確定性
  - AC-33 / AC-34 vitest 綠（`it("[AC-33] ...")`、`it("[AC-34] ...")`）
  - Spectator 觀察（人工跑 `pnpm dev`）：戰場 tile median count 上升至 ≥ 3、最高 power 至少觸及 Queen tier（≥ 60）

### ~~M2.2.7 — Castle vs castle BFS hops 例外~~（v1.0 deferred-with-AI；尚未實作）

- **檔案**：
  - `src/engine/movement.ts`（BFS attack range 條件加例外分支）+ `src/engine/movement.test.ts` 新增 case
  - `src/engine/ai.ts`（rule #3 條件描述更新，呼叫 movement 的新 hop 例外路徑）+ test 補
- **對應 PRD**：§3.5.6、§4.1 rule #3 v0.11 例外註
- **對應 AC**：AC-35
- **依賴**：M2.2.6
- **完成定義**：
  - BFS API 加 `{ allowUnlimitedHops: boolean }` 選項（or 等價設計）；source castle && target castle 時開啟
  - 其他條件全保留（passable / power ratio / castle reserve）
  - AC-35 vitest 綠
  - Spectator 觀察 100 ticks AI rule #3 fire 次數 > 0（M1.11 為 0）

### ~~M2.2.8 — Spectator 100-run 收斂回歸~~（v1.0 deferred-with-AI；尚未跑）

- **檔案**：無新檔；PR comment 報告 + `src/scenarios/spectator-4ai.json` 若有調參記錄
- **對應 PRD**：§11.2 v0.11 update（M2 退出條件）
- **依賴**：M2.2.6、M2.2.7
- **完成定義**：
  - `pnpm playtest src/scenarios/spectator-4ai.json --runs 100 --max-ticks 500 --seed 42` 跑完無 crash
  - **結束率 ≥ 50%**（≥ 50 場非 stalemate）
  - **任一勢力勝率 ≤ 50%**
  - **平均場長 ≤ 400 ticks**
  - 三條皆過 → M2 退出條件達標、可進 M2.3 marching 動畫
  - 未過 → 回頭 M2.2.6 / M2.2.7 調參（**只動實作層常數**：`CASTLE_OVERFLOW_THRESHOLD` 起始 30、overflow `max(2, ...)` 起始 2、anchor 選擇 tiebreak；**不動 PRD §3.5.5 / §3.5.6 / §4.1 rule #2.5 規格文字**，屬實作層調參，PRD 規格穩定）
- 補跑 seed 7 / 99 各一次確認非單一 seed 巧合

### M2.3 — Marching stack 動畫 + 拖曳路徑虛線

- 檔案：`src/render/marching.ts`、`src/render/paths.ts`
- 對應 PRD：§3.5.1、§3.5.3、§5.1
- 依賴：M2.2
- 完成定義：marching stack 0.7x sprite + count 標籤沿 path 插值；拖曳預覽路徑虛線 + 終點箭頭、無路徑時紅色提示。

### M2.4 — Pointer input（hit-test + click vs drag + 左右鍵分流）

- 檔案：`src/input/pointer.ts`、`src/input/pointer.test.ts`（純判斷邏輯可選測）
- 對應 PRD：§5.3
- 依賴：M2.1
- 完成定義：>5px 視為 drag、左鍵→派遣手勢、右鍵→pan；hit-test 對應到 tile id。

### M2.5 — Dispatch 手勢狀態機 + 比例滑桿

- 檔案：`src/input/dispatch.ts`
- 對應 PRD：§3.5.1、§5.2、§5.3
- 對應 AC：AC-06、AC-07、AC-16（UI 端）
- 依賴：M2.4、M1.6
- 完成定義：左鍵 hold-drag 從己方格起 → 算 BFS → 放開 → 呼叫 engine dispatch；滑桿 25/50/75/100 記憶上次值預設 100；UI 端禁止從非己方格起拖；主城派遣 100 時實際送 `count - 1`。

### M2.6 — Keyboard input

- 檔案：`src/input/keyboard.ts`
- 對應 PRD：§5.3
- 對應 AC：AC-13、AC-14
- 依賴：M2.0
- 完成定義：Space 暫停 / 繼續、`1`/`2` 變速、`R` 復位攝影機、`Esc` 取消拖曳、WASD/方向鍵 pan。

### M2.7 — HUD + Faction Panel + Tile Info Panel

- 檔案：`src/ui/hud.ts`、`src/ui/factionPanel.ts`、`src/ui/tileInfo.ts`
- 對應 PRD：§5.2
- 對應 AC：AC-02（HUD tick 顯示）、AC-09（faction 計數）
- 依賴：M2.0、M1
- 完成定義：HUD tick 數 + 倒數條 + 暫停/1x/2x 按鈕；faction panel 4 勢力統計、玩家高亮、defeated 灰掉；hover 任一格顯示 owner / tier / count / castle 旗標。

### M2.8 — End screen

- 檔案：`src/ui/endScreen.ts`
- 對應 PRD：§5.2、§6.1、§6.2
- 對應 AC：AC-11、AC-12
- 依賴：M2.7、M1.7
- 完成定義：勝/敗滿版覆蓋、最終 tick / 控制格統計、「重新開始」按鈕回 scenario 初始 state。

### M2.9 — Manual Smoke（人類執行）

- 動作：人類執行 `pnpm dev`、在瀏覽器：
  1. 確認 AC-01 棋盤、主城、玩家色
  2. 派遣一輪驗 AC-06 / 07 / 09
  3. Space + `2` 驗 AC-13 / 14
  4. 主城 100% 派遣驗 AC-16 UI 端
  5. 慢慢拓圖、派遠程派遣（路徑長 ≥ 12 hops）驗 AC-39 玩家無 hop 上限
  6. 對 idle 對手主城派一條決勝，看勝負畫面驗 AC-12（或故意送敵入主城驗 AC-11）
- 完成定義：以上六步全通；通過後人類在 PR 標 `v1.0 M2 manual smoke ✅`。

---

## v1.0 新增 milestone（次輪 PRD 規劃，UI + 基礎機制）

> 以下是 PRD v1.0 把 AI deferred 後新加的「次輪」工作。M1 / M2.0–M2.8 已 shipped 或屬 v1.0 active 範圍；下方 M2.9.5 / M2.9.7 是 v1.0 特有的補充。Turn 上限統一估 20 turn。

### M2.9.5 — §3.8 基礎幾何形式化（regression）

- **檔案**：`src/engine/combat.test.ts`（新增 4-conn 鄰格驗證 case）、`src/engine/movement.test.ts`（新增 BFS 非對角路徑驗證 case）
- **對應 PRD**：§3.8、AC-36
- **依賴**：無（純測試補強，engine 行為 v0.12 就是 4-conn）
- **完成定義**：
  - `it("[AC-36] 4-conn adjacency: combat pairs exclude diagonals")` 綠
  - `it("[AC-36] BFS finds non-diagonal path to (5,5)→(6,6)")` 綠
  - PR description 註明：v1.0 形式化 §3.8 後補的 regression test，engine 行為未改動

### M2.9.7 — Scenario aiConfig 模式驗收

- **檔案**：`src/scenarios/idle-target.json`（新；TOKUGAWA 玩家 + 三家 idle 主城作為 dispatch 目標）、`src/playtest/integration.test.ts`（新增 idle / scripted 兩條 case）
- **對應 PRD**：§4、AC-37、AC-38
- **依賴**：M1.10（playtest CLI）
- **完成定義**：
  - `it("[AC-37] aiConfig all idle: non-player marchingStacks stays 0 over 100 ticks")` 綠
  - `it("[AC-38] aiConfig scripted: TAKEDA dispatches exactly once at scripted tick")` 綠
  - `src/scenarios/idle-target.json` 是 v1.0 manual smoke 的預設場景（取代 v0.12 期間的 `default.json`，後者保留作 AI 重啟參考；MAIN 入口 default 改載 `idle-target.json`）

### v1.0 退出條件（合併 M2 + M2.9.5/.7）

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm build
```

加上 `pnpm dev` 後人類在瀏覽器跑 M2.9 manual smoke 全綠。

> v1.0 release 後 `archive/prd-v1.0` git tag、PRD 進入 v1.1 規劃週期。下一輪重點交給次輪 PRD 工作流：可能是 AI 規格回到 PRD、或 sprite 資產與 build 部署（M4）。

---

## ~~M3 — AI 平衡與完整體驗~~（v1.0 deferred-with-AI）

> **deferred 註記**：整段 M3 對應 v0.12 §4 / §10.4 acceptance（AI rule 微調、勝率 ±15% 達標、AC-10/15 強化），隨 AI 移出 v1.0 一併下線。下方原文保留作為「AI 重啟後可能怎麼走」的方向參考。AI 回到 PRD 後 M3 應該整段重寫，不要直接照搬。

---



**目標**：對 AI 對局有節奏、勝率不偏、視覺反饋順。

**涵蓋 PRD**：§4、§5.1（動畫拋光）、§7（AC-10、AC-15 強化）、§10.4
**涵蓋 AC**：AC-10、AC-15（強化）
**退出條件**：

```bash
pnpm playtest src/scenarios/default.json --runs 100
```

四家勢力勝率分佈 ≤ ±15%（位置不對稱可接受 ±15，PRD §10.4 上限 ±10 為長期目標、M3 先收 ±15 達標即可）、平均場長 100–400 ticks；加上人類跑「速勝 / 敗北 / AI 互打」三場手動驗證皆過。

**Turn 上限**：30

### M3.1 — AI 規則微調（僅在 100 場勝率失衡時動）

- 檔案：`src/engine/ai.ts`、`src/engine/ai.test.ts`
- 對應 PRD：§4.1、§10.4
- 依賴：M2 完工
- 完成定義：跑 baseline 100 場記下勝率；只在某勢力 > ±15% 時調規則 #3 的戰力差倍率（1.5→1.3/1.7）或評估間隔；改一次重跑一次。不新增規則。

### M3.2 — AC-10 整合：佔領敵方主城 → defeated + 領地 Neutral 化

- 檔案：`src/engine/victory.ts`（若 M1.7 已過則只補回歸測試）、`src/render/units.ts`、`src/ui/factionPanel.ts`
- 對應 PRD：§6.3
- 對應 AC：AC-10
- 依賴：M1.7、M2.7
- 完成定義：AI 主城被佔領後 faction panel 立即灰掉、其餘領地轉 Neutral 灰色、留存 stack 視覺保留但不再行動；headless 整合測試一條 + 瀏覽器手動驗一次。

### M3.3 — Tooltip + 派遣比例滑桿 UI 拋光

- 檔案：`src/ui/tileInfo.ts`、`src/input/dispatch.ts`
- 對應 PRD：§5.2「派遣中 Tooltip」、§5.3
- 依賴：M2.5
- 完成定義：拖曳中跟隨游標顯示「派遣 X 兵 → 目標格（距離 Y tick）」與滑桿；放開後正確呼叫 engine。

### M3.4 — 動畫節奏拋光

- 檔案：`src/render/combat.ts`、`src/render/units.ts`、`src/render/marching.ts`
- 對應 PRD：§5.1
- 依賴：M2.2、M2.3
- 完成定義：戰鬥 bump 0.2s、tint 0.1s、升級金光 scale 1.0→1.3→1.0 與 PRD 一致；2x 速度下動畫不卡頓（tween duration scale 隨倍速）。

### M3.5 — Balance：跑 100 場確認

- 檔案：（無新檔，產出 PR comment 報告）
- 對應 PRD：§10.4
- 依賴：M3.1
- 完成定義：`pnpm playtest src/scenarios/default.json --runs 100 --seed 42` 報告四家勝率差 ≤ ±15%；再用 seed 7 / 99 各跑一次確認非單一 seed 巧合。

### M3.6 — Manual Smoke（人類執行）

- 動作：人類跑三場 `pnpm dev`：
  1. **速勝局**：主動進攻 30 ticks 內滅一家
  2. **敗北局**：故意放任、被任一 AI 攻入主城
  3. **AI 互打局**：玩家全程不動，觀察 200 ticks 內 AI 互鬥（驗 AC-15 強化）
- 完成定義：三場無 crash、視覺與動畫順、AC-10/11/12/15 體感通過；人類在 PR 標 `M3 manual smoke ✅`。

---

## M4 — 收尾（資產、build、部署）

**目標**：拿得出手的 build 可放上 GitHub Pages。

**涵蓋 PRD**：§5.1（完整 sprite）、§9.4
**涵蓋 AC**：無新 AC，全部已在前三 milestone 收掉
**退出條件**：

```bash
pnpm build
```

通過、`dist/` 部署到 GitHub Pages 後在實際網址可玩通一場、所有前 milestone 的 AC 仍綠。

**Turn 上限**：20

### M4.1 — 完整 sprite 資產

- 檔案：`public/`、`src/assets/`、`src/render/units.ts`
- 對應 PRD：§5.1
- 依賴：M3
- 完成定義：5 種 sprite（soldier / knight / queen / king / castle）+ 4 勢力色 tint；M2 期間用的 placeholder 全替換。

### M4.2 — Build 設定 + GitHub Pages base path

- 檔案：`vite.config.ts`、`package.json`、`.github/workflows/deploy.yml`（如需自動部署）
- 對應 PRD：§9.4
- 依賴：M4.1
- 完成定義：`pnpm build` 過、`dist/` 體積合理（< 2 MB gzipped 為目標）、`base` 設對 Pages 路徑、可選 GitHub Action 自動部署。

### M4.3 — README 與 onboarding

- 檔案：`README.md`
- 對應 CLAUDE.md：§6（指令表）
- 依賴：無
- 完成定義：列出 `pnpm dev` / `test` / `playtest` / `build` 與遊戲玩法摘要、scenario JSON 範例連結到 PRD §10.2、不重述 PRD 規格細節。

### M4.4 — Manual Smoke（人類執行）

- 動作：
  1. `pnpm build && pnpm preview` 確認 production build 在本機可玩
  2. 部署到 GitHub Pages 後在實際網址（不是 localhost）打通一場
  3. 確認所有 sprite 載入、無 404、無 console error
- 完成定義：以上三步全通；人類在 PR 標 `M4 manual smoke ✅` → 專案可標 v1.0。

---

## 對照表（milestone × AC）

| AC     | M1  | M2  | M3  | M4  |
| ------ | --- | --- | --- | --- |
| AC-01  |     | ✅  |     |     |
| AC-02  | ✅  | ✅  |     |     |
| AC-03  | ✅  |     |     |     |
| AC-04  | ✅  |     |     |     |
| AC-05  | ✅  |     |     |     |
| AC-06  |     | ✅  |     |     |
| AC-07  |     | ✅  |     |     |
| AC-08  | ✅  |     |     |     |
| AC-09  |     | ✅  |     |     |
| AC-10  |     |     | ✅  |     |
| AC-11  |     | ✅  |     |     |
| AC-12  |     | ✅  |     |     |
| AC-13  |     | ✅  |     |     |
| AC-14  |     | ✅  |     |     |
| AC-15  | ✅  |     | 強化 |     |
| AC-16  | ✅  | ✅  |     |     |
| AC-17  | ✅  |     |     |     |
| AC-18  | ✅  |     |     |     |
| AC-19  | ✅  |     |     |     |
| AC-20  | ✅  |     |     |     |
| AC-21  | ✅  |     |     |     |
| AC-22  | ✅  |     |     |     |
| ~~AC-23~~ | — | — | — | — |
| ~~AC-24~~ | — | — | — | — |
| ~~AC-25~~ | — | — | — | — |
| ~~AC-26~~ | — | — | — | — |
| AC-27  | ✅  |     |     |     |
| AC-28  | ✅  |     |     |     |
| AC-29  | ✅  |     |     |     |
| AC-30  | ✅  |     |     |     |
| AC-31  | ✅  |     |     |     |
| AC-32  | ✅  |     |     |     |
| AC-33  |     | ✅  |     |     |
| AC-34  |     | ✅  |     |     |
| AC-35  |     | ✅  |     |     |
