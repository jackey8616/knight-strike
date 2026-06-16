# MILESTONES — Knight Strike

本文件把 [`PRD.md`](PRD.md) v0.10 切成 4 個交付 milestone，給 `/goal` 與 PR 計劃用。**規格不在此重述**，所有玩法/數值/規則查 PRD；本文件只列「做什麼、涵蓋哪些 AC、怎麼判收」。

> PRD 同步基準：v0.10（AC-01 ~ AC-32；§3.6.1 claim + hysteresis；§4.1 castle 分階保護 + rule #3 距離/reserve；§11.1/§11.2 M1.11 收斂限制與門檻調整）。

工具鏈、命名、分層鐵則查 [`CLAUDE.md`](../CLAUDE.md)。

---

## 全域約定

- 每個 task 設計成 **1–3 個 Claude turn** 內完成；超過就拆。
- 每個 milestone 標 **turn 上限**，給 `/goal` 設 `--max-turns`。
- 每個 milestone 結尾有一個 **Manual Smoke**，必須由人類親自跑過才放行。
- **退出條件 = 一個或數個指令能 mechanical 驗證**；指令全綠才視為 milestone 完成。
- Future scope（PRD §8）不在任何 milestone。

---

## M1 — Engine Core + Headless Playtest

**目標**：一行 `pnpm playtest` 能跑完整局，engine 層所有 AC 自動驗。

**涵蓋 PRD**：§2、§3.1–§3.7、§3.6.1、§4、§6、§10、§11.1、§11.2
**涵蓋 AC**：AC-02、AC-03、AC-04、AC-05、AC-08、AC-15、AC-16、AC-17、AC-18、AC-19、AC-20、AC-21、AC-22、AC-23、AC-24、AC-25、AC-26、AC-27、AC-28、AC-29、AC-30、AC-31、AC-32
**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && \
pnpm playtest src/scenarios/default.json --runs 10 --max-ticks 500
```

全綠且無例外、engine line coverage ≥ 90%、所有列出的 AC vitest 案例綠燈。`--max-ticks` 平局視為合法結局（見 PRD §11.2）。

**Turn 上限**：60

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
- 完成定義：`FactionId` / `Tier` / `TileId` / `Province`（含 `lastClaimedAtTick: number | null` 欄位給 §3.6.1 hysteresis 用）/ `MarchingStack`（含 `id` / `dispatchedAtTick`）/ `GameState` / `StalemateMap` 型別齊全、皆 `readonly`；seedable PRNG（mulberry32 或同等）有 test 驗確定性。

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

### M1.6.5 — Adjacent claim + Hysteresis

- 檔案：`src/engine/claim.ts`、`src/engine/claim.test.ts`（claim 結算夠重，獨立檔；若實作上合入 `combat.ts` 也可，但 test 仍獨立檔保留語意）
- 對應 PRD：§3.2 步驟 3b、§3.6.1（含 hysteresis）
- 對應 AC：AC-23、AC-24、AC-25、AC-26
- 依賴：M1.4（戰鬥已結算）、M1.6（marching 抵達已先寫回，避免雙重 claim）
- 完成定義：
  - 對每個 `count = 0` 非己方格依 §3.6.1 規則由相鄰勢力 claim（單一 claimant → 直接翻；多 claimant → 戰力決勝；tie → §4.2 RNG tiebreak）。
  - NEUTRAL 與 defeated faction 不參與 claim（不列入 claimants）。
  - Claim **只改 owner、不改 count**；AC-25 精確驗。
  - `Province.lastClaimedAtTick` 欄位寫入 `state.ts`（與 M1.1 一起 ship 或本 sub-milestone 補 patch）。
  - Hysteresis 3-tick 保護期：claim 發生 tick K → tick K, K+1, K+2 owner 凍結、tick K+3 起可再 claim；AC-26 精確驗 tick 邊界。
  - 整合進 tick orchestrator（M1.9）的 claim phase 3b。

### M1.7 — Victory 判定

- 檔案：`src/engine/victory.ts`、`src/engine/victory.test.ts`
- 對應 PRD：§6
- 對應 AC：（engine 端 AC-10/11/12 結構，畫面驗證留 M2/M3）
- 依賴：M1.1
- 完成定義：玩家主城失守 → loss；唯一存活勢力 → win；敗北勢力的 stack 轉 NEUTRAL owner 行為符 §6.3。

### M1.8 — AI 狀態機 + RNG shuffle + 評估錯開

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
- 依賴：M1.3、M1.4、M1.5、M1.6、M1.6.5、M1.7、M1.8
- 完成定義：`step(state)` 嚴格依 PRD §3.2 注腳順序：`movement → combat → drain (§3.7) → claim 3a (行軍抵達) → claim 3b (§3.6.1 相鄰勢力) → defeats → produce → upgrade → victory`；純函數、不 mutate 輸入；tick 編號從 1 起算與 PRD §3.2 對齊（tick 0 僅渲染、無結算；產兵於 tick 2 首次觸發；AI 評估偏移 1/2/3/4 + 每 5 ticks）。

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

## M2 — 渲染、輸入、UI（可手動對局）

**目標**：`pnpm dev` 開瀏覽器，能用滑鼠手動打完一場速勝。

**涵蓋 PRD**：§5、§9.2、§9.3、§9.4
**涵蓋 AC**：AC-01、AC-06、AC-07、AC-09、AC-11、AC-12、AC-13、AC-14（+ AC-16 UI 端整合驗證）
**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && \
pnpm build
```

加上 `pnpm dev` 後人類在瀏覽器內完成一場「玩家主動速勝」對局；engine 層此階段不大改（小於 50 行 diff、不動公式）。

**Turn 上限**：45

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
  5. 速殺三家 AI 驗 AC-12（或反向被殺驗 AC-11）
- 完成定義：以上五步全通；通過後人類在 PR 標 `M2 manual smoke ✅`。

---

## M3 — AI 平衡與完整體驗

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
| AC-23  | ✅  |     |     |     |
| AC-24  | ✅  |     |     |     |
| AC-25  | ✅  |     |     |     |
| AC-26  | ✅  |     |     |     |
| AC-27  | ✅  |     |     |     |
| AC-28  | ✅  |     |     |     |
| AC-29  | ✅  |     |     |     |
| AC-30  | ✅  |     |     |     |
| AC-31  | ✅  |     |     |     |
| AC-32  | ✅  |     |     |     |
