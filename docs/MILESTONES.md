# MILESTONES — Knight Strike（v2 國家大作戰經濟模型）

本文件把 [`PRD.md`](PRD.md)（v2.0）切成交付 milestone，給 PR 計劃用。**規格不在此重述**——所有玩法 / 數值 / 規則查 PRD；本文件只列「做什麼、涵蓋哪些 AC、怎麼判收、狀態」。工作佇列（更細的 task）見 [`BACKLOG.md`](BACKLOG.md)。工具鏈、命名、分層鐵則查 [`CLAUDE.md`](../CLAUDE.md)。

> **PRD 同步基準：v2.2（Lord Monarch 經濟模型，全面取代 v1 原型）**。AC 編號用 PRD §9 的 `AC-01`..`AC-42`。**v1 原型 milestone（舊 M1–M4：count-tier engine / Pixi UI / playtest / deploy）已被取代**，封存於 git 標籤 `archive/prd-v2.5-prototype` 與 git log；下列 v2 milestone **延續 M5+ 編號**（branch 名 `feature/M5-...` 不與 v1 衝突）。

---

## 全域約定

- 每個 task 設計成 **1–3 個 Claude turn** 內完成；超過就拆（細項見 BACKLOG）。
- **改 engine = TDD**：先寫 / 改測試讓它 fail，再寫 code 讓它過（CLAUDE.md §8.2）。
- 每個 milestone 結尾有一個 **Manual Smoke**，由人類親自跑過才放行。
- **退出條件 = 指令能 mechanical 驗證**；指令全綠才視為 milestone 完成（CLAUDE.md §6）：`pnpm typecheck && pnpm lint && pnpm test:run && pnpm playtest <scenario> --runs N`。Engine line coverage ≥ 90%。
- **UI shell / `main.ts` 生命週期改動 → `pnpm smoke` 須 exit 0**（CLAUDE.md §5.4）。
- Future scope（PRD §10）不在任何 milestone。

**整體狀態**：v2 為對 v1 原型的**全面重製（full pivot）**。M5–M14 皆 **planned**（尚未實作）。引擎採**先 engine（純邏輯 TDD + headless 整合）後 render/UI（smoke）**切分（PRD 決策）。

> **遷移鐵則（最大風險）**：v1 的 `upgrade.ts`（5/15/30 tier）/ `ai.ts` 被 `runner.ts` 等 import；**保留 v1 可編譯到 v2 step pipeline 落地為止**，`upgrade.ts` / `ai.ts` 最後刪，否則 build 中途轉紅（BACKLOG 風險區）。`balance` gate 在 M5–M11 期間放寬 / 停用、M12 AI 上線後重新定門檻。

---

## M5 — Engine Foundation（時間 / 狀態 / 事件骨架）

**範圍**：`src/engine/**` 基座——新 `GameState`（entity-centric + 經濟）、`clock`（day/tick/速度/accumulator）、`tick` step 骨架（回 `{state, events}`）、`events`（AI Spectator 事件 union）。可跑 vitest，無 Pixi / DOM。

**對應 PRD**：§3（名詞）、§4.1–4.2（棋盤 / 時間）、§5.2（事件 log）。

| 模組 | 職責 | 對應 PRD | 涵蓋 AC |
| --- | --- | --- | --- |
| `types.ts` | 新實體與 state 型別（Faction/Unit/House/Field/Nest/Building/Construction…）；`FactionId` 加 `MONSTER`、`Terrain` 加 `LAVA` | §3 | （結構基礎） |
| `clock.ts` | `tickMs(speed)`、`dayOf(tick)`、`advanceClock(acc, Δ, speed)` | §4.2 | AC-01 / 02 / 03 |
| `tick.ts` | `step(state): {state, events}` 骨架 + 新結算順序 | §4.2 | AC-04 |
| `events.ts` | `GameEvent` union + factory；`tick.elapsed` / `day.elapsed` | §5.2 | AC-37（基礎） |
| `state.ts` | `tileId` / `parseTileId`（沿用）、`mooreNeighbors` / `vonNeumannNeighbors`、`tileIndex` | §4.11 | （結構基礎） |
| `util/rng.ts` | seedable PRNG（**沿用不動**） | — | AC-04 |

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run
```

**Manual Smoke**：跑一個 no-op scenario N tick，`state.tick` / `state.day` 正常前進、`tick.elapsed` / `day.elapsed` 事件依序產生；決定論 golden-hash 兩次跑一致。

---

## M6 — Houses + Economy（房屋 / 田地 / 人口 / 稅收連通性）

**範圍**：經濟核心——建房、田地擴張、人口增長 + 稅率、產兵、城堡連通性 BFS、S/M/L 等級判定。

**對應 PRD**：§4.3–4.6。

| 模組 | 職責 | 對應 PRD | 涵蓋 AC |
| --- | --- | --- | --- |
| `house.ts` | `validateBuild` / `buildHouse`（Moore 8 排除 + 人力分配）、`expandFields`、`spawnFromHouses` | §4.4 | AC-05 / 06 / 07 / 08 |
| `population.ts` | `growPopulation` / `growthPerDay`（稅率曲線、天邊界） | §4.4 | AC-09 |
| `connectivity.ts` | `computeConnectivity`：城堡 BFS over 我方田地 / 房屋、柵欄阻斷（dirty flag） | §4.5 | AC-10 / 11 / 12 / 13 |
| `combat-tier.ts` | `getTier`（1/1000/10000 → S/M/L）、`recomputeElite`（精銳星） | §4.6 | AC-14 / 15 |

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm test:coverage
```

**Manual Smoke**：單房屋 scenario 跑數十 tick → 田地擴張、產兵、以柵欄切斷後連通翻轉；`house.built` / `house.expanded_field` / `house.spawned_unit` / `connectivity.recomputed` 事件正確。

---

## M7 — Combat + Maintenance（戰鬥 / 維持費 / 裁員）

**範圍**：接觸即戰至殲滅、人數至上 / 不合併、等級量級傷害、多軍配對；維持費 + 裁員。

**對應 PRD**：§4.6–4.8。

| 模組 | 職責 | 對應 PRD | 涵蓋 AC |
| --- | --- | --- | --- |
| `combat.ts` | `resolveCombat`：接觸偵測 → 配對（最近 / tie 小 id）→ 逐 tick 傷害 → 打到殲滅 | §4.7 | AC-16 / 17 / 18 / 19 |
| `combat-tier.ts` | 精銳星轉移整合進戰損 | §4.6 | AC-15 |
| `maintenance.ts` | `applyMaintenance`：> 2000 維持費扣款 + 不足按比例裁員 | §4.8 | AC-20 / 21 |
| `movement.ts` | 整支部隊行軍（`findPath` BFS 沿用 + 改 passability）、`issueMarch` / `advanceMarch` | §4.7 | （配合戰鬥接觸） |

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm test:coverage
```

**Manual Smoke**：雙軍 scenario 大軍勝、同陣營不合併；窮國 scenario 大軍裁員到 < 2000；`combat.engaged` / `combat.damage_dealt` / `combat.unit_destroyed` / `unit.starvation` / `unit.elite_changed` 事件正確。

---

## M8 — Construction（橋 / 柵欄 / 破壞）

**範圍**：橋樑（河 / 岩漿）、柵欄（阻擋 + 切連通）、破壞建築（耐久 + 量級）、建造 / 破壞狀態機；地形 / 移動 passability 整合。

**對應 PRD**：§4.9–4.10。

| 模組 | 職責 | 對應 PRD | 涵蓋 AC |
| --- | --- | --- | --- |
| `construction.ts` | `startConstruction` / `advanceConstruction` / `advanceDestruction`、狀態機、ABORTED、城堡破壞 → 殺國王 | §4.9 | AC-22 / 23 / 24 / 25 |
| `terrain.ts` | 加 `LAVA`、`isPassable(state, tile, faction)`（橋解鎖水 / 岩漿、柵欄阻擋） | §4.10 | AC-26 |
| `movement.ts` | passability 接 `isPassable`（橋 / 柵欄 / 岩漿） | §4.7 | AC-26 |

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm test:coverage
```

**Manual Smoke**：架橋讓部隊過河；建柵欄翻轉連通；L 級秒破橋；破城堡觸發殺國王。`construction.started/completed/aborted` / `building.destroyed` 事件正確。

---

## M9 — Monsters（巢穴 / 怪物 / 殺國王災難）

**範圍**：巢穴累積與生成、怪物戰鬥力倍率、怪物殺國王災難（部隊變怪物、領土還原、金錢歸 0）。

**對應 PRD**：§4.9、§7.1。

| 模組 | 職責 | 對應 PRD | 涵蓋 AC |
| --- | --- | --- | --- |
| `monster.ts` | `accumulateNests`（8 tick +10、100 生成）、`effectivePopulation` 倍率接戰鬥、`applyMonsterKingKill` 災難 | §4.9 / §7.1 | AC-27 / 28 / 29 |

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm test:coverage
```

**Manual Smoke**：巢穴生怪 scenario；玩家被怪物攻破城堡 → 領土還原 + 部隊變怪 + 金錢歸 0；`nest.accumulated` / `monster.spawned` / `nation.consumed_by_monster` 事件正確。

---

## M10 — Victory + Scoring（敗北條件 / 關卡結算）

**範圍**：三種敗北 + 優先序、人類 vs 怪物殺國王分支、時間用盡、多關卡剩餘天數結算。

**對應 PRD**：§7。

| 模組 | 職責 | 對應 PRD | 涵蓋 AC |
| --- | --- | --- | --- |
| `victory.ts` | `applyDefeats`（三條件 + 優先序 + 繼承 / 災難分支）、`evaluateOutcome`、`scoreLevelEnd` | §7 | AC-30 / 31 / 33 / 34 / 35 / 36 |
| `tick.ts` | TIME_OUT 終局判定 | §7.1 | AC-32 |

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm test:coverage
```

**Manual Smoke**：mini-game 跑到分出勝負；`remainingDays` 跨關保留正確；`nation.defeated` / `level.completed` 事件正確。

---

## M11 — Headless Playtest Infra（runner / scenario v2 / 整合測試）

**範圍**：`src/playtest/**` + `src/scenarios/**`——v2 scenario schema、`runScenario` 事件聚合、整合測試後盾、事件 log 重播。

**對應 PRD**：§12、§5.2。

| 模組 | 職責 | 對應 PRD | 涵蓋 AC |
| --- | --- | --- | --- |
| `playtest/runner.ts` | 新 `ScenarioInput` 驗證（金錢 / 稅率 / isPlayer / 房 / 田 / 巢 / 部隊 / remainingDays / 怪物）、`TickEvent.events` → `GameEvent[]` 聚合 | §12 | AC-37 |
| `playtest/integration.test.ts` | 跨模組 v2 整合回歸（經濟 → 戰鬥 → 勝負全流程） | §12 | （整合） |
| `scenarios/*` | v2 default / 經濟 / 戰鬥 / 怪物 / 結算 fixture + `sized.ts` 程序開局 | §12 | — |

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && \
pnpm playtest src/scenarios/default.json --runs 10 --max-ticks 500 --log events
```

**Manual Smoke**：`--log events` 事件 log 良構、可重播；多場無 crash / 無 NaN / 無負量。

---

## M12 — Opponent AI（經濟感知規則 AI + balance）

**範圍**：在經濟模型上重做對手 AI（建房 / 調稅 / 擴張 / 進攻 / 破壞決策）+ 難度旋鈕 + 同步評估 + 決定論；重定 balance 門檻。**需先開一輪 AI 設計回合**（v2_spec 未細定，PRD §5.1）。

**對應 PRD**：§5.1。

| 模組 | 職責 | 對應 PRD | 涵蓋 AC |
| --- | --- | --- | --- |
| `ai.ts` / `ai-profile.ts` | 經濟感知規則狀態機（**重寫**，刪 v1 count-tier 機）、`RULE_PROFILES` v2 旋鈕 | §5.1 | （AI 行為 AC，設計後補編號） |
| `playtest/balance-check.ts` | v2 勝率 / 場長 / 僵局門檻重定 | §12 | — |

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm balance
```

**Manual Smoke**：`pnpm playtest src/scenarios/spectator-4ai.json --runs 10` AI 對局正常推進與收斂、勝率合理。

---

## M13 — Render / Input / UI + Smoke（圖形端到端）

**範圍**：v2 渲染（房 / 田 / 橋 / 柵欄 / 怪物 / 精銳星）+ 經濟 HUD（gold / day / 稅率滑桿）+ 建造模式 + 關卡結算畫面；CDP smoke 測試（含截圖）。

**對應 PRD**：§8、§9（UI AC）。

| 層 | 模組 | 職責 | 涵蓋 AC |
| --- | --- | --- | --- |
| 渲染 | `render/buildings`（新）`units` `board` | 房 / 田頂面、橋 / 柵欄 sprite、怪物著色、精銳星、連通 overlay（可選） | AC-40 |
| UI | `ui/hud` `ui/economy-panel`（新）`ui/level-result`（新）`start-menu` | gold / day / 速度、稅率滑桿、經濟面板、關卡結算畫面、Start Menu（+ 外形 / 難度） | AC-38 / 39 / 42 |
| 輸入 | `input/build`（新）`pointer` `dispatch` | 建房 / 建橋 / 建柵欄模式、游標 + 放置預覽 | AC-41 |
| 入口 | `main.ts` | wire v2 engine + renderer、`window.__ks` 擴充（getState 含 gold/houses/units/day、build/setTax 指令）、Start → game → level-result → restart / next 導航 | AC-38 / 42 |
| smoke | `scripts/smoke/driver.mjs` | 新增 gold/day HUD、建房 → 房 sprite、田地擴張、橋 / 柵欄、怪物、關卡結算畫面斷言 + 截圖 | AC-38..42 |

**退出條件**：

```bash
pnpm typecheck && pnpm lint && pnpm test:run && pnpm build && pnpm smoke
```

**Manual Smoke**（`pnpm dev` 後人類在瀏覽器 + `pnpm smoke` exit 0）：① Start Menu → 開局（AC-38）→ ② gold / day HUD 更新、調稅率（AC-39）→ ③ 進建造模式建房、看田地擴張（AC-40 / 41）→ ④ 架橋 / 建柵欄 → ⑤ 打到關卡結算畫面看 remainingDays（AC-42）。

---

## M14 — Build 與部署

**範圍**：production build + GitHub Pages。

**對應 PRD**：§8（sprite）；build 細節見 CLAUDE.md §2、§6。

- `vite.config.ts` + `build:pages`；`.github/workflows/deploy.yml`。
- 資產：v2 新 sprite（房 / 田 / 橋 / 柵欄 / 怪物）。
- `README.md` 更新玩法摘要回 PRD v2.0。

**退出條件**：`pnpm build` 過、部署到 Pages 後實際網址可玩通一場。

**Manual Smoke**：`pnpm build && pnpm preview` 本機可玩；部署後實際網址無 404 / 無 console error。

---

## 對照表（AC × milestone）

> AC 編號 = PRD v2.0 §9。Engine 行為以 vitest headless + `runScenario` 驗；UI 行為以 `pnpm dev` 瀏覽器 + `pnpm smoke` 驗。

| AC | 描述（簡） | M5 | M6 | M7 | M8 | M9 | M10 | M11 | M13 |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| AC-01 | 速度 → tickMs 500/250/125 | ✅ | | | | | | | |
| AC-02 | day = floor(tick/2) | ✅ | | | | | | | |
| AC-03 | 速度切換不跳號 / 暫停不前進 | ✅ | | | | | | | |
| AC-04 | 決定論 golden-hash | ✅ | | | | | | | |
| AC-05 | 建房驗證 6 reasons | | ✅ | | | | | | |
| AC-06 | 人力分配邊界 | | ✅ | | | | | | |
| AC-07 | 田地擴張 −10 / 跳過 | | ✅ | | | | | | |
| AC-08 | 產兵 ≥100 | | ✅ | | | | | | |
| AC-09 | 人口增長 + 稅率 | | ✅ | | | | | | |
| AC-10 | 連通（相鄰 / 田地路徑） | | ✅ | | | | | | |
| AC-11 | 連通切斷（敵田 / 柵欄） | | ✅ | | | | | | |
| AC-12 | 連通崩潰（城堡 / 關鍵田） | | ✅ | | | | | | |
| AC-13 | 不連通稅率視為 0 | | ✅ | | | | | | |
| AC-14 | 等級 S/M/L | | ✅ | ✅ | | | | | |
| AC-15 | 精銳星 / 轉移 | | ✅ | ✅ | | | | | |
| AC-16 | 人數至上 / 不合併 | | | ✅ | | | | | |
| AC-17 | 等級壓制 | | | ✅ | | | | | |
| AC-18 | 接觸即戰 / 不可中斷 | | | ✅ | | | | | |
| AC-19 | 傷害 ramp | | | ✅ | | | | | |
| AC-20 | 維持費觸發 | | | ✅ | | | | | |
| AC-21 | 裁員 / 按比例 | | | ✅ | | | | | |
| AC-22 | 橋樑 | | | | ✅ | | | | |
| AC-23 | 柵欄 + 切連通 | | | | ✅ | | | | |
| AC-24 | 破壞量級 | | | | ✅ | | | | |
| AC-25 | 破城堡 = 殺國王 | | | | ✅ | | ✅ | | |
| AC-26 | 柵欄阻擋移動 | | | | ✅ | | | | |
| AC-27 | 巢穴累積 / 生成 | | | | | ✅ | | | |
| AC-28 | 怪物戰鬥倍率 | | | | | ✅ | | | |
| AC-29 | 怪物殺國王災難 | | | | | ✅ | ✅ | | |
| AC-30 | 領土全失 | | | | | | ✅ | | |
| AC-31 | 人類殺國王繼承 | | | | | | ✅ | | |
| AC-32 | 時間用盡 | | | | | | ✅ | | |
| AC-33 | 失敗優先序 | | | | | | ✅ | | |
| AC-34 | 佔領率懲罰 | | | | | | ✅ | | |
| AC-35 | 戰鬥效率獎勵 | | | | | | ✅ | | |
| AC-36 | 結算順序 / 跨關 | | | | | | ✅ | | |
| AC-37 | AI Spectator 事件 log | ✅ | | | | | | ✅ | |
| AC-38 | Start Menu | | | | | | | | ✅ |
| AC-39 | 經濟 HUD / 稅率滑桿 | | | | | | | | ✅ |
| AC-40 | v2 渲染 | | | | | | | | ✅ |
| AC-41 | 建造模式 | | | | | | | | ✅ |
| AC-42 | 關卡結算畫面 | | | | | | | | ✅ |

> M12（AI）與 M14（build）不直接對應現有 AC：M12 的 AI 行為 AC 待設計回合後補編號；M14 以 build / 部署可玩驗收。
