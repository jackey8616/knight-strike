# MILESTONES — Knight Strike

本文件把 [`PRD.md`](PRD.md) 切成交付 milestone，給 `/goal` 與 PR 計劃用。**規格不在此重述**——所有玩法 / 數值 / 規則查 PRD；本文件只列「做什麼、涵蓋哪些 AC、怎麼判收、狀態」。工具鏈、命名、分層鐵則查 [`CLAUDE.md`](../CLAUDE.md)。

> **PRD 同步基準：v2.0（實作對齊整併版）**。AC 編號用 PRD §8 的 `AC-01`..`AC-24`（已隨 v2.0 整併把舊的 AC-01..39 / AC-V2 / AC-V4 / AC-V6 版號表退場）。設計演進史（v0.x–v1.6 逐版、被取代的同 tile multi-occupant 戰鬥 / stalemate drain / castle overflow 等）見 PRD changelog 指向的 git 標籤 `archive/prd-v0.12` 與 git log。

---

## 全域約定

- 每個 task 設計成 **1–3 個 Claude turn** 內完成；超過就拆。
- 每個 milestone 結尾有一個 **Manual Smoke**，由人類親自跑過才放行。
- **退出條件 = 一個或數個指令能 mechanical 驗證**；指令全綠才視為 milestone 完成。
- Milestone 完成判定基準（CLAUDE.md §6）：`pnpm test:run` + `pnpm typecheck` + `pnpm lint` + `pnpm playtest <scenario> --runs N` 全綠。
- Future scope（PRD §9）不在任何 milestone。

**整體狀態**：PRD v2.0 描述的玩法、AI、地形、UI 皆已實作並通過測試（99 tests 綠）。下列 milestone 均為 **shipped**；本文件現主要作為「milestone × 模組 × AC」對照與回歸基準。

---

## M1 — Engine Core（純邏輯層，可 headless）✅

**範圍**：`src/engine/**` 全層——資料模型、tick 結算、升級、產兵、戰鬥、移動 / 行軍、勝負、地形、AI、RNG。無 Pixi / DOM 依賴，跑得了 vitest 與 `pnpm playtest`。

**對應 PRD**：§3（名詞）、§4（玩法核心）、§5（AI）、§7（勝負）。

| 模組                                    | 職責                                                                                                                                                    | 對應 PRD | 涵蓋 AC                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------ |
| `types.ts` / `state.ts` / `util/rng.ts` | 型別、`derivedOwner` / `findOccupant` 等 helper、seedable PRNG                                                                                          | §3       | （結構基礎）                   |
| `upgrade.ts`                            | `deriveTier`，閾值 **5 / 15 / 30**                                                                                                                      | §4.4     | AC-04                          |
| `production.ts`                         | self-replicate **每 tick +1**、cap 100、被圍攻格凍結                                                                                                    | §4.3     | AC-03                          |
| `combat.ts`                             | `resolveOrders`：cross-edge `stageDamage` ramp、tick-0 守勢、NEUTRAL 不還擊、地形減傷、break→capture、佔領後前進                                        | §4.6     | AC-10 / 11 / 12 / 13 / 16      |
| `movement.ts`                           | `findPath`（己方補給 vs 征服行軍）、`dispatch`（比例 + 主城留 1 + `forceCount`）、`cancelMarchingStack`、`advanceMarching`（同陣營合併、siege staging） | §4.5     | AC-05 / 07 / 08 / 09 / 14 / 15 |
| `terrain.ts`                            | `isImpassableTerrain` / `applyTerrainDefense` / `generateTerrain`（seeded、連通修復）                                                                   | §4.7     | AC-16 / 17                     |
| `victory.ts`                            | `applyDefeats`（敗北 → NEUTRAL、清 stack / order）、`evaluateOutcome`                                                                                   | §7       | AC-22                          |
| `ai.ts` / `ai-profile.ts`               | `stepAi` 三檔規則狀態機（defense → assault → expand → rally）、交錯評估、`mixSeed` 決定論、`RULE_PROFILES`                                              | §5       | AC-18 / 19 / 20 / 21           |
| `tick.ts`                               | `step(state)`：AI → movement → produce → combat → defeats → `tick+1`                                                                                    | §4.2     | AC-02                          |

> **重點對齊 v2.0**：戰鬥為**鄰邊 cross-edge + 兩階段 claim**（非舊版同 tile multi-occupant）；`AttackOrder` 帶 `count` / `route`（征服行軍）；**AI 已實作並寫入 PRD §5**（非舊文件的「deferred / 規格 orphan」）。`overflow.ts`（`applyCastleOverflow`）為歷史遺留 no-op，未被 `tick.ts` 呼叫。

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && \
pnpm playtest src/scenarios/default.json --runs 10 --max-ticks 500
```

**Manual Smoke**：`pnpm playtest src/scenarios/spectator-4ai.json --runs 10 --max-ticks 500` 無 crash / 無 NaN / 無負 count；AI 對局能正常推進與收斂。

---

## M2 — 渲染、輸入、UI（Pixi.js）✅

**範圍**：`pnpm dev` 開瀏覽器，玩家用滑鼠拖曳派遣、看到完整視覺回饋與 HUD / 面板 / end screen，能對 AI 對手打完一場。

**對應 PRD**：§6（視覺與 UI）、§4.5.1（派遣手勢）、§4.8。

| 層   | 模組                                                                      | 職責                                                                                                                                        | 涵蓋 AC    |
| ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 渲染 | `render/app` `board` `units` `marching` `combat` `paths` `sprites`        | iso 投影（64×32 菱形）、地形 prism、山堆疊方塊 + 遮擋淡化、tier sprite、行軍插值、GSAP bump / tint、拖曳虛線                                | AC-01      |
| 輸入 | `input/pointer` `keyboard` `camera` `dispatch`                            | click vs drag（>5px）、左右鍵分流、按壓 auto-pause、wheel + 觸控 pinch / pan、鍵盤（Space / 1–4 / R / Esc / WASD）、拖曳派遣手勢 + 比例滑桿 | AC-06 / 24 |
| UI   | `ui/hud` `faction-panel` `tile-info` `end-screen` `map-size` `responsive` | tick bar + 速度、勢力統計、hover 格資訊、勝負畫面、棋盤尺寸選單（11 / 15 / 19 / 27）、自適應佈局                                            | AC-02 / 23 |
| 入口 | `main.ts`                                                                 | 建 engine + renderer、wire UI、tick loop、auto-pause、cancel 接線（點行軍 sprite 取消，AC-15 UI 端）                                        | AC-15      |

> 預設可玩場景由 `scenarios/sized.ts` `makeScenario` 程序產生（19×19、玩家 Tokugawa = idle、其餘三家 = **normal** 規則 AI），故開局即有 AI 對手。

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm build
```

**Manual Smoke**（`pnpm dev` 後人類在瀏覽器）：① 棋盤 / 主城 / 玩家色（AC-01）→ ② 拖曳派遣一輪、看 BFS 路徑與征服行軍（AC-06 / 08）→ ③ Space + 變速（AC-24）→ ④ 點行軍 sprite 取消（AC-15）→ ⑤ 對敵城派決勝、看勝負畫面（AC-23）。

---

## M3 — Headless Playtest 與 Scenario ✅

**範圍**：`src/playtest/**` + `src/scenarios/**`——CLI、`runScenario` API、scenario loader / 驗證、整合測試後盾。

**對應 PRD**：§11。

- `playtest/cli.ts` + `runner.ts`：`pnpm playtest <file>` 跑單場，`--runs N`（勝率 / 場長分佈）、`--max-ticks`、event log。`parseScenario` 驗證 `{ name?, boardSize, initialState[], aiConfig, scriptedCommands?, rngSeed }`；`aiConfig` 接受 `idle` / `scripted` / `easy` / `normal` / `hard`（`default` 為棄用別名 → normal）。
- `playtest/integration.test.ts`：跨模組行為回歸（vitest）。
- `scenarios/*`：`default` / `idle-target` / `spectator-4ai` / `diff-tier` / `smoke-attack` 等 fixture，供 engine 回歸與 AI 對局。
- **涵蓋 AC**：AC-21（`idle` 勢力 marching 恆 0；`scripted` 於指定 tick 派一筆）。AI 已實作，`--runs N` 的勝率 / 場長統計重新具意義。

**退出條件**：`pnpm playtest src/scenarios/default.json --runs 10 --max-ticks 500` 無 crash、輸出合理。

---

## M4 — Build 與部署 ✅

**範圍**：production build + GitHub Pages。

**對應 PRD**：§2、§6.1（sprite）。

- `vite.config.ts` + `build:pages`（`VITE_BASE_PATH=/knight-strike/`）；`.github/workflows/deploy.yml` 自動部署。
- 資產：`public/knight.png` + tint / scale 區分 tier。
- `README.md`：`pnpm dev` / `test` / `playtest` / `build` 摘要，玩法連結回 PRD。

**退出條件**：`pnpm build` 過、`dist/` 部署到 Pages 後在實際網址可玩通一場。

**Manual Smoke**：`pnpm build && pnpm preview` 本機可玩；部署後實際網址無 404 / 無 console error。

---

## 對照表（AC × milestone）

> AC 編號 = PRD v2.0 §8。Engine 行為以 vitest headless 驗，UI 行為以 `pnpm dev` 瀏覽器驗。

| AC    | 描述（簡）                                  | M1 engine | M2 UI | M3 playtest |
| ----- | ------------------------------------------- | :-------: | :---: | :---------: |
| AC-01 | 棋盤 / 主城 / 玩家 Tokugawa / 尺寸切換      |           |  ✅   |             |
| AC-02 | tick 每 2 秒、變速                          |    ✅     |  ✅   |             |
| AC-03 | self-replicate +1/tick、cap 100、圍攻凍結   |    ✅     |       |             |
| AC-04 | `deriveTier` 5 / 15 / 30、降階              |    ✅     |       |             |
| AC-05 | 主城派遣留 1                                |    ✅     |  ✅   |             |
| AC-06 | 拖曳派遣 + BFS 路徑高亮                     |           |  ✅   |             |
| AC-07 | 己方目標 = 補給移動（own-only 路徑）        |    ✅     |       |             |
| AC-08 | 非己方目標 = 征服行軍（忽略所有權最短路徑） |    ✅     |  ✅   |             |
| AC-09 | siege staging → `AttackOrder`               |    ✅     |       |             |
| AC-10 | 戰鬥 `stageDamage` ramp、tick-0 守勢        |    ✅     |       |             |
| AC-11 | break→capture                               |    ✅     |       |             |
| AC-12 | 佔領後前進 / 駐紮                           |    ✅     |       |             |
| AC-13 | NEUTRAL 不還擊                              |    ✅     |       |             |
| AC-14 | 同陣營合併                                  |    ✅     |       |             |
| AC-15 | 取消行軍                                    |    ✅     |  ✅   |             |
| AC-16 | 地形不可通行 + FOREST 減傷                  |    ✅     |       |             |
| AC-17 | seeded 地形生成 + 連通保證                  |    ✅     |       |             |
| AC-18 | AI 決定論（同 seed 同序列）                 |    ✅     |       |             |
| AC-19 | AI 擴張                                     |    ✅     |       |             |
| AC-20 | AI 交錯評估                                 |    ✅     |       |             |
| AC-21 | idle / scripted 模式                        |    ✅     |       |     ✅      |
| AC-22 | 敗北處置（NEUTRAL 化 + 清 stack / order）   |    ✅     |       |             |
| AC-23 | 勝利 / 敗北畫面                             |           |  ✅   |             |
| AC-24 | 暫停 / 按壓 auto-pause                      |           |  ✅   |             |
