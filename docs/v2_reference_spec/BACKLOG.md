# BACKLOG — Knight Strike（v2 國家大作戰經濟模型）

本文件是 v2 重製的**工作佇列**：把 [`MILESTONES.md`](MILESTONES.md) 的每個 milestone 拆成 **1–3 個 Claude turn** 可完成的 task，標出對應 [`PRD.md`](PRD.md) §9 的 AC 與測試型態。**規格查 PRD、交付契約查 MILESTONES、實作鐵則查 [`CLAUDE.md`](../../CLAUDE.md)**；本文件只排「做的順序、相依、狀態」。

> **使用約定**
> - 順序由上而下；`Deps` 標跨 milestone 相依。`Test` 欄：**U**=vitest 單元（同目錄 `*.test.ts`，TDD 先寫）、**I**=`runScenario` 整合、**S**=`pnpm smoke` CDP 圖形。
> - **改 engine = TDD**（CLAUDE.md §8.2）：先寫 U 測試 fail → 實作過 → 補 I。Engine line coverage ≥ 90%。
> - **改 PRD 數值 / 行為 = 先對齊**（CLAUDE.md §8.3）；§A 的預設值改動需回 PRD §6 bump。
> - 狀態：`todo` / `wip` / `done` / `blocked`。所有 v2 task 起始 `todo`。

---

## M5 — Engine Foundation

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-501 | `types.ts` | 定義 v2 `GameState` + 實體型別（Faction/Unit/House/Field/MonsterNest/Building/ConstructionTask/MarchOrder）；`FactionId` 加 `MONSTER`、`Terrain` 加 `LAVA`；全 `readonly` | — | U | — | todo |
| BL-502 | `state.ts` | `tileId`/`parseTileId` 沿用；新增 `mooreNeighbors`/`vonNeumannNeighbors`/`tileIndex`/`unitsOf`/`factionTerritory`；刪 occupant helper | — | U | BL-501 | todo |
| BL-503 | `clock.ts` | `tickMs(speed)`、`dayOf(tick)`、`advanceClock(acc,Δ,speed)`（accumulator + carry） | AC-01/02/03 | U | BL-501 | todo |
| BL-504 | `events.ts` | `GameEvent` union + factory（先 `tick.elapsed`/`day.elapsed`，其餘佔位）；`StepResult={state,events}` | AC-37 | U | BL-501 | todo |
| BL-505 | `tick.ts` | `step(state):{state,events}` 骨架 + 新結算順序（先串空子系統）；`day` 派生與 tick 前進 | AC-04 | U | BL-503/504 | todo |
| BL-506 | `tick.ts` | 決定論 golden-hash 測試（整數量、同序列同 final state）；no-op scenario 整合 | AC-04 | U,I | BL-505 | todo |

## M6 — Houses + Economy

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-601 | `combat-tier.ts` | `getTier(pop)` 1/1000/10000 → S/M/L（取代 `upgrade.ts`，先不刪舊） | AC-14 | U | M5 | todo |
| BL-602 | `combat-tier.ts` | `recomputeElite(state)`：各國最大標星、平手取小 id | AC-15 | U | BL-601 | todo |
| BL-603 | `house.ts` | `validateBuild`：6 reasons（gold/unit/Moore own-house/敵房允許/地形/已佔） | AC-05 | U | M5,BL-502 | todo |
| BL-604 | `house.ts` | `buildHouse`：扣 100 金 + 人力分配（≤200 半分 / >200 留 100）；邊界 199/200/201/1 | AC-06 | U | BL-603 | todo |
| BL-605 | `house.ts` | `expandFields`：Moore 八格轉田、每格 −10、不足跳過（每 2 天節奏） | AC-07 | U | BL-604 | todo |
| BL-606 | `house.ts` | `spawnFromHouses`：人數 ≥100 → 生 100 部隊於相鄰我方格、房 −100 | AC-08 | U | BL-604 | todo |
| BL-607 | `population.ts` | `growthPerDay`（稅率 0 → 2+田數、線性曲線、30% → 0）+ 天邊界 gating | AC-09 | U | BL-604 | todo |
| BL-608 | `connectivity.ts` | `computeConnectivity`：城堡 BFS over 我方田 / 房、柵欄 / 敵領阻斷；dirty flag | AC-10/11/12 | U | BL-604 | todo |
| BL-609 | `connectivity.ts`+`population.ts` | 不連通 → 稅率視為 0（增長最快）整合；`connectivity.recomputed` diff 事件 | AC-13/37 | U,I | BL-607/608 | todo |
| BL-610 | (scenario) | 經濟整合 scenario：單房成長 → 擴張 → 產兵 → 柵欄切連通；house 事件斷言 | AC-05..13 | I | BL-609 | todo |

## M7 — Combat + Maintenance

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-701 | `movement.ts` | 整支部隊行軍：`findPath` BFS 沿用 + passability stub、`issueMarch`/`advanceMarch` | — | U | M5 | todo |
| BL-702 | `combat.ts` | 接觸偵測 + 配對（最近 / tie 小 id）；`combat.engaged` 事件 | AC-18 | U | BL-701 | todo |
| BL-703 | `combat.ts` | 逐 tick 傷害（§6 公式骨架）、等級量級、不可中斷打到殲滅；`damage_dealt`/`unit_destroyed` | AC-17/19 | U | BL-702 | todo |
| BL-704 | `combat.ts` | 人數至上 / 不合併（5000 vs 4999；兩 5000 vs 8000）；中立不還擊 | AC-16/18 | U | BL-703 | todo |
| BL-705 | `combat.ts`+`combat-tier.ts` | 戰損後精銳星轉移；`unit.elite_changed` | AC-15 | U | BL-703,BL-602 | todo |
| BL-706 | `maintenance.ts` | `applyMaintenance`：> 2000 扣費（§6 N）、國庫不足按比例裁員；`unit.starvation` | AC-20/21 | U | M5 | todo |
| BL-707 | (scenario) | 雙軍 / 窮國整合：大軍勝 + 不合併 + 裁員到 < 2000 | AC-16..21 | I | BL-705/706 | todo |

## M8 — Construction

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-801 | `terrain.ts` | 加 `LAVA`；`isPassable(state,tile,faction)`（橋解鎖水 / 岩漿、柵欄阻擋敵我） | AC-26 | U | M8 起 | todo |
| BL-802 | `movement.ts` | passability 接 `isPassable` | AC-26 | U | BL-801,BL-701 | todo |
| BL-803 | `construction.ts` | 狀態機 + `startConstruction`（驗證 + 扣錢）/`advanceConstruction`（−10/tick、ABORTED） | AC-22/23 | U | BL-801 | todo |
| BL-804 | `construction.ts` | 橋（河 / 岩漿、2000、2 tick、完成可通行）；柵欄（土地、500、5 tick、切連通） | AC-22/23 | U | BL-803,BL-608 | todo |
| BL-805 | `construction.ts` | `advanceDestruction`：S/M `sqrt(pop/100)`、L `sqrt(pop/10)`、耐久度；攻擊 −10/tick | AC-24 | U | BL-803 | todo |
| BL-806 | `construction.ts`+`victory.ts` | 破城堡耐久歸零 → 觸發殺國王 hook | AC-25 | U | BL-805 | todo |
| BL-807 | (scenario) | 架橋過河 + 柵欄翻連通 + L 秒破橋；construction / building 事件 | AC-22..26 | I | BL-806 | todo |

## M9 — Monsters

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-901 | `monster.ts` | `accumulateNests`：`(tick−created)%8===0 → +10`、100 → 生 100 怪物於相鄰格 | AC-27 | U | M5 | todo |
| BL-902 | `monster.ts`+`combat.ts` | `effectivePopulation` 倍率接傷害計算（扣真實人數） | AC-28 | U | BL-703,BL-901 | todo |
| BL-903 | `monster.ts` | `applyMonsterKingKill`：部隊變怪物、領土還原、金錢歸 0、巢穴不受影響 | AC-29 | U | M5 | todo |
| BL-904 | (scenario) | 巢穴生怪 + 玩家被怪物攻破災難；nest / monster / consumed 事件 | AC-27..29 | I | BL-903 | todo |

## M10 — Victory + Scoring

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-1001 | `victory.ts` | `applyDefeats`：領土全失 / 國王被打倒（人類繼承 vs 怪物災難分支）+ 優先序 | AC-30/31/33 | U | BL-903 | todo |
| BL-1002 | `tick.ts`+`victory.ts` | TIME_OUT（玩家 elapsed > remainingDays）+ `evaluateOutcome` | AC-32/33 | U | BL-1001 | todo |
| BL-1003 | `victory.ts` | `scoreLevelEnd`：佔領率懲罰 + 戰鬥效率獎勵（cap 600）+ 結算順序、跨關 remainingDays | AC-34/35/36 | U | BL-1002 | todo |
| BL-1004 | (scenario) | mini-game 跑到勝負 + 跨關保留；nation.defeated / level.completed 事件 | AC-30..37 | I | BL-1003 | todo |

## M11 — Headless Playtest Infra

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-1101 | `playtest/runner.ts` | v2 `ScenarioInput` schema + `parseScenario`（金錢 / 稅率 / isPlayer / 房 / 田 / 巢 / 部隊 / remainingDays / 怪物） | — | U | M10 | todo |
| BL-1102 | `playtest/runner.ts` | `TickEvent.events` → `GameEvent[]` 聚合；`runScenario` 回 outcome / 事件 | AC-37 | U,I | BL-1101 | todo |
| BL-1103 | `scenarios/*` | v2 default / 經濟 / 戰鬥 / 怪物 / 結算 fixture；`sized.ts` v2 程序開局 | — | I | BL-1101 | todo |
| BL-1104 | `playtest/integration.test.ts` | 經濟 → 戰鬥 → 勝負全流程整合回歸 | （整合） | I | BL-1103 | todo |
| BL-1105 | `playtest/cli.ts` | `--log events` v2 事件輸出；`pnpm playtest default --runs 10` 綠 | AC-37 | I | BL-1102 | todo |
| BL-1106 | （改）保留 v1 為彩蛋 | **不刪 v1**——保留為 `?v1` 隱藏彩蛋（原型完整保存、可開啟）。v1 engine/render/input/ui + `main-v1.ts` 留著；`main.ts` 以 `?v1` URL 參數動態載入 v1。CI 的 `pnpm playtest`/`balance`（v1）暫保留或另切 v2:* | — | — | M13 | done |

## M12 — Opponent AI

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-1201 | (design) | **AI 設計回合**：經濟感知決策（建房 / 調稅 / 擴張 / 進攻 / 破壞）優先序 + 旋鈕；對齊 PRD §5.1、補 AC 編號 | — | — | M11 | todo |
| BL-1202 | `ai.ts`/`ai-profile.ts` | 重寫經濟感知規則狀態機 + `RULE_PROFILES` v2 旋鈕 + 同步評估 + 決定論 | （待編號） | U | BL-1201 | todo |
| BL-1203 | `playtest/balance-check.ts` | v2 勝率 / 場長 / 僵局門檻重定；`pnpm balance` 綠 | — | I | BL-1202 | todo |

## M13 — Render / Input / UI + Smoke

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-1301 | `render/buildings.ts`+`units.ts` | 房 / 田頂面、橋 / 柵欄 sprite、怪物著色、精銳星、連通 overlay（可選） | AC-40 | S | M12 | todo |
| BL-1302 | `ui/hud.ts`+`ui/economy-panel.ts` | gold / day / 速度 + 稅率滑桿 + 各勢力經濟面板 | AC-39 | S | BL-1301 | todo |
| BL-1303 | `input/build.ts` | 建房 / 建橋 / 建柵欄模式 + 游標 + 放置預覽 | AC-41 | S | BL-1301 | todo |
| BL-1304 | `ui/level-result.ts`+`start-menu.ts` | 關卡結算畫面（remainingDays / 佔領率 / 效率 + Restart / Main Menu / 下一關）；Start Menu 接 v2 | AC-38/42 | S | BL-1301 | todo |
| BL-1305 | `main.ts` | wire v2 engine + renderer + tick loop；`window.__ks` 擴充（getState gold/houses/units/day、buildHouse/setTax/buildBridge/Fence） | AC-38/42 | S | BL-1302/1303/1304 | todo |
| BL-1306 | `scripts/smoke/driver.mjs` | 新增斷言 + 截圖：gold/day HUD、建房 → sprite、田地擴張、橋 / 柵欄、怪物、關卡結算 | AC-38..42 | S | BL-1305 | todo |

## M14 — Build 與部署

| BL-ID | Module | Task | AC | Test | Deps | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BL-1401 | assets | v2 sprite（房 / 田 / 橋 / 柵欄 / 怪物）；`pnpm build` 過 | — | — | M13 | todo |
| BL-1402 | `README.md`+`deploy.yml` | README 玩法摘要回 PRD v2.0；Pages 部署可玩通一場 | — | — | BL-1401 | todo |

---

## 附錄 A — 待 playtest 調校（數值）

> 對應 PRD §6.1。改動需回 PRD bump。`Status: default-chosen` = 已選預設、待 playtest 驗證。

| 參數 | 預設值 | Status |
| --- | --- | --- |
| 戰鬥傷害 / tick | `max(1, floor(pop × tierWeight/100))`, tierWeight {S:1,M:10,L:100} | default-chosen (tuned M7) |
| 維持費 / tick | `max(1, floor((pop−2000)/100))`（pop > 2000） | default-chosen |
| 裁員速度 / tick | `floor((pop−2000)/4)`，≥1，至 2000 | default-chosen |
| 多軍配對 | 最近敵軍、tie 小 id | default-chosen |
| 怪物倍率 | `2.0` | default-chosen |
| L 級破壞力 / tick | `floor(sqrt(pop/10))` | default-chosen |
| 耐久度 | 房=pop、田 1、橋 10、柵欄 10、城堡 300、巢穴 100 | default-chosen |
| 稅率→增長曲線 | 線性 `(30−taxPct)/30` | default-chosen |
| 稅收金錢 / 天 | 連通房屋 `floor(pop × taxRate)` 入國庫 | default-chosen |
| 田地擴張節奏 | 每 2 天 | default-chosen |
| 林防禦減傷 | ×0.75（v2 可選，預設開） | default-chosen |
| 起始金錢 / 部隊 | 場景指定 | default-chosen |

## 附錄 B — 行為決議（語意）

> 對應 PRD §6.2。

| 行為 | 決議 | Status |
| --- | --- | --- |
| 柵欄擋自己 | 是 | default-chosen |
| 「敵方橋 500 金」 | MVP 不做獨立機制、破壞走通用規則 | 待釐清（future scope） |
| 建造中被攻擊 | 繼續；致死 ABORTED、不退款 | default-chosen |
| 怪物 / 巢穴 AI | 巢穴被動；怪物找最近敵、無偏好玩家 | default-chosen |
| 怪物殺國王金錢 | 歸 0 | default-chosen |
| 人數 = 1 建房 | 允許（房 0、暫不活動） | default-chosen |
| MONSTER 偽勢力 | 無金錢 / 稅、不受一般敗北、排除計分 | default-chosen |

## 附錄 C — 風險 / 排序地雷（實作前必讀）

1. **舊↔新 tier 衝突**：`upgrade.ts`（5/15/30）/ `ai.ts` 被 `runner.ts` 等 import；**保留 v1 可編譯到 M11 runner 切 v2**，BL-1106 才刪舊，否則 build 中途轉紅。
2. **balance gate**：M5–M11 無 v2 AI，`pnpm balance` 無意義 → 期間放寬 / 停用，M12（BL-1203）重定門檻。CI balance step 暫時不擋。
3. **連通 BFS 效能**：dirty flag 只在房 / 田 / 柵欄 / 城堡變動時重算；union-find 列入優化（PRD §10）。
4. **決定論 vs 浮點**：`sqrt` 傷害 / `(30−tax)/30` 增長產生浮點；儲存量一律整數（落地前 `floor`），保 golden-hash 穩定（BL-506）。
5. **天邊界 vs per-tick**：增長 / 擴張 / 產兵每天一次但 driver 是 per-tick；測精確 tick 數跨天邊界，避免雙算 / 漏算。
6. **兩條殺國王路徑**：人類繼承 vs 怪物災難共用觸發、結果分歧；明確 branch `killer==="MONSTER"`，兩路各測（BL-1001/903）。
7. **MONSTER 偽勢力**：滲入每個 `Record<FactionId,…>` 與計分 / 敗北迴圈；M5 型別階段就定 pseudo-faction 處理。
8. **AI 規格不足**：v2_reference_spec 未細定對手 AI；BL-1201 須先設計回合再實作。
