# 知識戰爭 / Knight Strike — Product Requirements Document

**Version**: v2.0（實作對齊整併版）
**Status**: 鄰邊（cross-edge）戰鬥 + 兩階段領土 claim + 拖曳征服行軍 + seeded 地形 + 三檔規則 AI（easy / normal / hard）。

> **本文件定位**：Knight Strike 的單一真相來源（single source of truth），描述**目前 repo 實際實作**的玩法、機制與技術。本版把先前分散的規格（v0.1–v1.6 的逐版 changelog、4 份 `PRD-*-draft.md`）整併為一份實作對齊文件：移除已廢棄設計的考古層、把「AI 規格 orphan」狀態的規則 AI 正式寫回規格、並修正文件與程式碼的漂移。
>
> **與舊版差異（v1.6 → v2.0）**：玩法規則本身**沒有新增變動**，只是讓文件 = 程式碼。修正項目：①AI 由「deferred」改為完整規格（§5）；②tier 閾值 5/15/30（非舊文件的 5/12/25）；③`AttackOrder` 帶 `count` / `route`（v1.5 征服行軍）；④產兵為**每 tick +1**（非每 2 ticks）；⑤補上已實作但未入規格的 `cancelMarchingStack`、指標按壓 auto-pause、觸控縮放/平移。
>
> **設計演進史**：完整逐版 changelog 與被取代的設計（同 tile multi-occupant 戰鬥、§3.6.1 相鄰自動 claim、stalemate drain、castle overflow 等）保留在 git 標籤 `archive/prd-v0.12` 與 git log，不再內嵌於本文件。

---

## 1. 願景與背景

重製日本免費小品《国家大作戦》(lm_exp, 2005 年前後)，以 Web 技術交付。45° 斜俯視棋盤、像素風角色、即時 tick 戰棋。**核心循環**：主城自然成長 → 拖曳派兵擴張領土 / 圍攻敵格 → 佔領敵方主城獲勝。**目標體感**：單場數分鐘到十餘分鐘內結束的中節奏對 AI 戰。

## 2. 技術棧

| 項目 | 選擇                        | 備註                                        |
| ---- | --------------------------- | ------------------------------------------- |
| 編譯 | Vite + TypeScript（strict） | dev server + production build               |
| 渲染 | **Pixi.js v8**              | 原生 2D sprite、iso 視覺投影、pixel-perfect |
| 動畫 | GSAP                        | tween 引擎，驅動 Pixi 物件                  |
| 測試 | vitest                      | engine 單元 + 整合測試                      |

> **技術棧決策**：所有玩法都在 2D 格網上發生（45° iso 只是視覺投影），故用 Pixi.js v8（原生 2D sprite、輸入事件直接 hit-test 格子、bundle 小、無 3D camera 的 orbit/drag 衝突），而非把 2D 遊戲塞進 3D 引擎。早期 scaffolding 的 Three.js 已移除。

**架構鐵則**：`src/engine/**` 為純邏輯層，**不得** import Pixi / GSAP / DOM / render / input / ui，必須能在 Node headless 跑（vitest、`pnpm playtest`）。所有 engine 公開 API 收 `state` 回**新** `state`，不 mutate 輸入。

## 3. 名詞表

- **Tick**：遊戲時鐘最小單位，2 秒 / tick（`TICK_INTERVAL_MS = 2000`；變速時實際間隔 = `TICK_INTERVAL_MS / speed`）。所有產兵、移動、戰鬥都在 tick 邊界結算。
- **Tile / Province**：棋盤上的一格。持有 `{ id, x, y, isCastle, castleOwner, terrain?, occupants[], lastClaimedFaction }`。Tile 本身不持有 owner / count 欄位；所有權與兵力由 `occupants[]` + `lastClaimedFaction` 表達。
- **Occupant**：駐紮在 tile 上的單一 faction 單位群，`{ faction, amount, arrivalTick, isDefender }`。**不變式（v1.4 起）**：一個 tile 上至多有一個 faction 在場——單位永不與敵共格（戰鬥一律跨邊發生，§4.6）。
- **Marching Stack（行軍縱隊）**：派遣後沿路徑移動的暫態單位群 `{ id, faction, count, path[], idx, dispatchedAtTick }`，獨立於 tile 的 occupant。tier 不存欄位，由 `deriveTier(count)` 即時推導。
- **AttackOrder（圍攻指令）**：一筆跨邊圍攻關係 `{ from, to, faction, count, route, startTick }`。`from` 是縱隊所站的己方 staging 格、`to` 是相鄰（4-conn）目標格、`count` 是縱隊自身兵力（**不寄生** `from` 的駐軍）、`route` 是 `to` 之後尚待攻佔的剩餘格、`startTick` 錨定戰鬥 tick。
- **Tier**：單位階級 Soldier / Knight / Queen / King，由 `deriveTier(amount)` 即時推導，**只用於 sprite 顯示與升級語意，不參與戰鬥公式**。
- **主城 (Castle)**：每個勢力的核心 tile（`isCastle: true`、`castleOwner` 記錄原始勢力）。castleOwner 在其主城上失去 occupant 即敗北（§7）。
- **lastClaimedFaction**：tile-level 狀態。任何 occupant 進駐即設為其 faction；occupant 被殲滅後**保留**為剛死那家。空 tile 的 derived ownership 由它推導（渲染染色用），但**不授予派遣權**（派遣來源必須有自家 occupant 且 amount > 0）。
- **derivedOwner(tile)**：1 occupant → 該 faction；0 occupant → `lastClaimedFaction`（可能為 null）；2+ occupant → null。（程式碼保留 2+ 分支，但戰鬥不變式下空格/單佔是常態。）

## 4. 玩法核心

### 4.1 棋盤與勢力

- **可選棋盤大小**：`N×N` 方格，玩家可選 **11 / 15 / 19 / 27**（預設 **19**；經 `?size=N` URL 參數記憶，切換 = 開新局）。棋盤 fit-to-viewport 自動縮放。
- 主城恆置於四角 `(0,0) / (N-1,0) / (0,N-1) / (N-1,N-1)`，4 個勢力各佔一角：**Tokugawa / Takeda / Oda / Uesugi**。玩家固定操作 **Tokugawa**。
- 中立據點（Neutral 山賊）置於中央 `(⌊N/2⌋, ⌊N/2⌋)`：不產兵、不行動，可被任何勢力佔領（佔領後變為己方一般領地）。
- **起始 count**：各勢力主城 = **3**（Soldier tier）；中立據點 = **3**；其餘格為空（0）。起始 3 < Knight 閾值 5 → 開局是 Soldier 對 Soldier，戰力對稱；主城 +1/tick 自然成長到 Knight(5) 需 2 ticks。

### 4.2 即時 Tick 引擎與結算順序

- 全域時鐘以 2 秒 / tick 推進。HUD 顯示當前 tick 數與下一 tick 倒數。支援暫停 / 繼續 / 變速（1x / 2x / 3x / 4x）。
- **Tick 編號約定**：Tick 0 為初始狀態（僅渲染、無結算）。Tick 1 起執行結算。產兵於 `tick > 0` 觸發。
- **每個 tick 固定結算順序**（`engine/tick.ts`，`step(state) → state'`）：

  1. **AI（`stepAi`）**：對每個 `aiConfig` 為 `rule` 模式且輪到評估的非玩家勢力跑規則狀態機，派出的行軍縱隊在本 tick 即進入 `marchingStacks`（§5）。`idle` / `scripted` 勢力於此略過。
  2. **Movement（`advanceMarching`）**：每條 marching stack `idx++`；抵達結算（移入己方格 / 建立 AttackOrder / 同陣營合併，§4.5）。所有加法寫回。
  3. **Production（`produce`）**：每個非戰鬥格的合格 occupant `amount += 1`（§4.3）；亦屬加法，置於戰鬥前，讓新兵當 tick 即可當增援。
  4. **Combat（`resolveOrders`）**：逐筆 `AttackOrder` 跨邊 step-function 結算 + break→capture（§4.6）。所有減法寫回，殲滅歸零 occupant，移除完成 / 失效 order。
  5. **Defeats（`applyDefeats`）**：castle 上無 castleOwner occupant 的勢力標為 `defeated`，其留存 occupant 轉 NEUTRAL、marching stack 與 AttackOrder 一併消滅（§7.3）。
  6. **`tick += 1`**。勝負判定（`evaluateOutcome`）由呼叫端讀 state 計算（§7）。

### 4.3 駐紮分裂與兵源（self-replicate）

`produce(state)`（`engine/production.ts`）：每 tick 對每個 tile 上的每個 occupant 套用——

- 該 tile **未被圍攻**（不是任何 AttackOrder 的 `to`），且 occupant `faction` 非 `NEUTRAL`、不在 `defeated`、`1 ≤ amount < 100` → `amount += 1`。
- **每格每 tick +1**（castle 與一般領地一視同仁；amount = 1 殘血也會回血）。**主城不再是特殊兵源**——castleOwner 在主城上的 occupant 走同一條 self-replicate；主城的特殊性只剩「失守即敗」。
- **被圍攻的目標格凍結**：任一 AttackOrder 的 `to` 暫停成長，避免守軍在攻城下無限回血。圍攻縱隊的兵力在 `order.count`（不是 occupant），其 staging 格 `from` 照常成長。
- **Cap = 100**（`PRODUCTION_CAP`），套在每個 occupant 各自的 amount。

### 4.4 單位、Occupant 與升級

- 每個 occupant 的 tier 由 `deriveTier(amount)` 即時推導（純函數，`engine/upgrade.ts`）：

  | amount             | tier    |
  | ------------------ | ------- |
  | `< 5`              | Soldier |
  | `5 ≤ amount < 15`  | Knight  |
  | `15 ≤ amount < 30` | Queen   |
  | `≥ 30`             | King    |

- 升級 / 降級為**隱含結果**：amount 變動後 tier 即時更新，畫面顯示對應 sprite + 數字。tier **不影響戰鬥數值**（戰鬥是 count-only ramp，§4.6）。

### 4.5 移動、派駐、路徑、行軍

#### 4.5.1 派遣手勢

- 玩家在**己方格**（`derivedOwner === 玩家` 且有自家 occupant）按下左鍵，拖到**目標格**放開：派遣。拖曳過程畫 BFS 最短路徑高亮；無路徑顯示紅色拒絕。
- **派遣比例**：25% / 50% / 75% / 100%（記憶上次選擇）。最少派遣 1 兵。
- **主城派遣下限**：主城作為來源時，無論比例**至少留 1 兵**（`amount = 1` 則無法派遣）。避免不小心清空主城被反吃。
- Engine `dispatch()` 另有 `forceCount` escape hatch（指定確切兵數，仍受主城留 1 與來源上限約束），供 AI 使用。

#### 4.5.2 路徑規則（`findPath`）

BFS（4-conn）。來源必須 `derivedOwner === faction`。目標若為不可通行地形（山 / 水）→ 直接 `null`。**Passable 規則依目標類型分流**：

- **目標為己方格（補給移動）**：整條路徑的中間格都必須 own-claimed（有自家 occupant，或空但 `lastClaimedFaction === faction` 的 walk-through 染色格）。中立 / 無主 / 敵方格皆為牆——己方補給只能在自己領土內走。
- **目標為非己方格（征服行軍 / conquer-march）**：用**最短路徑 BFS，忽略所有權**——除了不可通行地形外，所有 in-bounds 格皆可作中間格。縱隊會沿線逐格圍攻（§4.6）。
- 目標格本身永遠不需要 passable（可瞄敵格 / 中立格 / 無主格）。

#### 4.5.3 行軍與抵達（`advanceMarching`）

每 tick 每條 stack `idx++`，依**下一格**對該 faction 的所有權（讀 tick 起始快照，故同 tick 抵達互不干擾）：

- **下一格己方 + 終點** → 部隊移入該格（`garrison`：併入既有同陣營 occupant 或新增），縱隊消滅。
- **下一格己方 + 非終點** → 繼續前進。
- **下一格非己方** → **siege**：縱隊兵力進入一筆 `AttackOrder`（`from = 目前 staging 格、to = 下一格、count = 縱隊兵力、route = 之後剩餘格`），**不踏入目標格**。同 `(from, to, faction)` 已有 order → 合併 count。涵蓋「敵方終點」與「中途某格翻出己方控制」兩種情況。
- **同陣營多 stack 同 tick 抵達同格** → 合併為單一事件：count 加總；續行 path 取剩餘步數最少者（任一以該格為終點則視為終點抵達），tiebreak 取較早 `dispatchedAtTick`、再取 `id` 字典序。

#### 4.5.4 取消行軍（`cancelMarchingStack`）

玩家可在縱隊抵達終點前取消它（UI：點擊該行軍 sprite）。縱隊兵力就地**落在當前格**（必為 own-claimed）併入駐軍，order / stack 移除。純函數，回 `{ ok, state }`。

### 4.6 戰鬥（cross-edge 鄰邊 + 兩階段 claim）

`resolveOrders(state)`（`engine/combat.ts`）逐筆 `AttackOrder` 結算。單位永不與敵共格——戰鬥都發生在 `from`（己方 staging 駐軍）與相鄰 `to`（目標）之間。

**傷害公式（step-function ramp）**：

```
stageDamage(t) = 2 ** Math.floor(Math.log2(Math.max(t, 1)))
t = currentTick - order.startTick
```

| t    | 0   | 1   | 2–3 | 4–7 | 8–15 | 16–31 | …   |
| ---- | --- | --- | --- | --- | ---- | ----- | --- |
| base | 1   | 1   | 2   | 4   | 8    | 16    | 2^k |

依 `to` 格狀態進入三階段之一（先 dry-run 全算、後同步寫回）：

**階段一 — 目標有敵 / 野單位**（`to` 有非 `faction` 的 occupant）：

- 守軍（defender）對縱隊還擊 `min(base, defender.amount)`，再經**縱隊所在格 `from` 的地形**減傷（§4.7）。
- `t ≥ 1` 時縱隊對守軍輸出 `min(base, order.count)`，再經**守軍所在格 `to` 的地形**減傷。**`t == 0`（攻堅首 tick）縱隊不輸出、只挨打**——攻方需兵力優勢才打得下守軍。
- `NEUTRAL`（野怪 / 敗北殘兵）**永不還擊**，但正常受擊。
- 縱隊扣到 `count ≤ 0` → order 作廢（攻堅失敗）；守軍扣到 0 → `to` 變空（`lastClaimedFaction` 保留為剛死那家）。
- **多 order 同打一格**：各自獨立計 `min(base, …)`；守軍歸零後在同 tick 由處理順序（`from` 字典序）推進 claim。

**階段二 — 目標空但敵方 claim**（`to.occupants = []`、`lastClaimedFaction` 為存活敵方）：**break**——縱隊花 1 兵，`lastClaimedFaction → null`（變中立 / 無主）。下一 tick 才 capture。

**階段三 — 目標空且中立 / 無主**：**capture**——縱隊花 1 兵，`lastClaimedFaction → faction`，order 完成。

**佔領後前進（conquer-march）**：capture 成功當下，縱隊以剩餘 `count` **前進到剛佔下的格**：

- `route` 非空（中繼格）→ 在 `to` re-spawn 一條 marching stack（`path = [from, to, ...route]`, `idx = 1`）續攻下一格；`to` 暫留為空己方 claim。
- `route` 為空（終點）→ 縱隊**駐紮 `to`**（落地成 occupant）。
- 兵力耗盡（`count ≤ 0`）→ order 作廢，已攻下的格維持己方 claim。

> **成本與節奏**：拿有駐軍的敵格 = 戰鬥傷亡 +（break 1 + capture 1）；拿敵方空 claim 格 = 2 兵（break + capture）；拿中立 / 無主格 = 1 兵。被消耗的邊界兵由 self-replicate（§4.3）補回。整體仍 `O(log₂(amount))` 收斂——不會出現打不死的對峙爛尾。

### 4.7 地形（terrain）

每個 tile 有 `terrain: Terrain ∈ { PLAINS, MOUNTAIN, WATER, FOREST }`（optional，省略視為 `PLAINS`）。helpers 在 `engine/terrain.ts`。

- **不可通行（MOUNTAIN / WATER）**：不能進駐、攻佔、作 BFS 中間格、或作派遣目標（`findPath` 對不可通行目標回 null，征服行軍最短路徑自動繞過）。
- **防禦減傷（FOREST）**：`applyTerrainDefense(dmg, terrain)`——FOREST ×0.75、其餘 ×1，用 `Math.ceil`（傷害 ≥1 永不歸零以免卡死）。攻方縱隊受還擊按 `from` 地形減傷；守軍受傷按 `to` 地形減傷。
- **程序生成（seeded）**：`generateTerrain(boardSize, seed, fixedPlains)` 由 scenario `rngSeed` 決定。流程：撒佈有機 blob（林權重高、山成嶺、水稀少；blob 數 ≈ `N²/7`、半徑 1–2、0.7 填充率）→ 強制 `fixedPlains`（主城 + 中立據點）及其四鄰為可通行 → **連通修復**（對未連通的固定點 carve L 型 PLAINS 走廊），保證所有固定點互相連通，任何主城都不會被地形封死。

### 4.8 幾何 / 距離 / 邊界

- **鄰格 = 4-connected**：`(x±1, y)` 與 `(x, y±1)`，不含對角。BFS 路徑、戰鬥配對、地形連通全部沿用；45° iso 投影只影響渲染、不改邏輯距離。
- **距離 = Manhattan**：`|ax−bx| + |ay−by|`（AI 威脅半徑 / 目標排序用）。
- **棋盤邊界**：`0 ≤ x,y < boardSize`；界外格不存在。
- **玩家派遣無 hop 上限**：只要 BFS 找得到 §4.5.2 的合法路徑就能派，無論多遠。

## 5. 非玩家勢力 AI（規則狀態機）

每個非玩家勢力的控制模式由 scenario `aiConfig`（per-faction `AiMode`）指定。`AiMode` 為 discriminated union：

| 模式                     | 行為                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `{ kind: "idle" }`       | 完全靜默：不評估、不派兵（主城仍 self-replicate）。                     |
| `{ kind: "scripted" }`   | 只聽 scenario `scriptedCommands`：在指定 tick 觸發指定派遣，其餘 idle。 |
| `{ kind: "rule", tier }` | 跑規則 AI 狀態機，`tier ∈ { easy, normal, hard }`（§5.3）。             |

> scenario JSON `aiConfig` 接受 shorthand 字串 `"idle"` / `"scripted"` / `"easy"` / `"normal"` / `"hard"`，或 `{ kind, tier }` 物件。`"default"` 為**已棄用別名**（→ normal，附 console 警告）。**預設可玩場景**（`makeScenario`）：玩家 Tokugawa = `idle`，其餘三家 = `normal`——所以開局即有真正的 AI 對手。

### 5.1 評估節奏與決定論

- **交錯評估**：每家有固定 offset（Tokugawa 1 / Takeda 2 / Oda 3 / Uesugi 4），於 `(tick - offset) % evalInterval === 0` 時評估一次（`evalInterval` 依 tier）。四家永不在同一 tick 撞評估。
- **決定論**：每次評估用 `mixSeed(rngSeed, faction, tick)`（per-faction salt）建一個 seeded RNG。**同 seed → 同決策序列**；不同 seed → 分歧。`stepAi` 只動 `rule` 模式且未敗北的勢力。

### 5.2 規則優先序

`evaluateFaction` 依序嘗試，命中即停（短路）：

**① 防守（tryDefense）** → **② 進攻（tryAssault）** → **③ 擴張（tryExpand）** → **④ 集結（tryRally）**

> 進攻置於擴張之上：一旦兵力夠破敵城就committed 進攻，而非無止境擴張空格（避免對峙僵局）。進攻會自我把關（aggregate force 不足就跳過），故早期自然降級為擴張成長，直到能發動決定性會師。

- **① 防守**：若自家主城 `defenseRadius`（Manhattan）內有敵方 / 野怪 occupant → 從**最近的己方非主城格**（己方領土內 BFS）以 50% 增援主城。
- **② 進攻**：挑一個「可抵達的敵 / 野**邊界**格」（至少有一個非敵鄰格，否則 findPath 跨不過去），把**多個**來源格的餘兵（每格 count ≥ Knight 閾值 5、各留 1 兵）經征服行軍 BFS（忽略所有權、`attackHops` 內）會師過去；要求 `aggregate ≥ defender × attackPowerRatio` 才發動。目標排序：可破的**敵主城**優先 → 離敵主城最近 → 守軍最弱 → id。**無 RNG，純決定論**。
- **③ 擴張**：來源 = 有餘兵的己方格（非主城需 ≥ 5，送 `floor(count × expandRatio)`；主城依 tier band 保留——`<5` 不送、`5–14` 送 `min(⌊c×0.25⌋, c−5)`、`15–29` 送 `min(⌊c×castleQueenSendRatio⌋, c−15)`、`≥30` 送 `⌊c×0.5⌋`）。目標 = 與己方領土相鄰的空格。配對 shuffle（RNG）後派遣。
- **④ 集結**（僅 `rallyEnabled` 的 tier）：挑最強的非主城前線格為 anchor，從其相鄰的己方非主城格各送 50%（cap `count − 1`）匯集，準備下一波。

### 5.3 RuleProfile 旋鈕表

三檔共用同一組旋鈕（`engine/ai-profile.ts`）：

| 旋鈕                   | easy  | normal | hard | 意義                               |
| ---------------------- | ----- | ------ | ---- | ---------------------------------- |
| `evalInterval`         | 8     | 5      | 3    | 每幾 tick 評估一次（越小越勤）     |
| `defenseRadius`        | 1     | 2      | 3    | 主城周邊威脅偵測半徑（Manhattan）  |
| `attackHops`           | 4     | 8      | 10   | 進攻掃描的最大 BFS 跳數            |
| `attackPowerRatio`     | 2.0   | 1.5    | 1.25 | 發動進攻所需的兵力優勢倍率         |
| `rallyEnabled`         | false | true   | true | 是否啟用集結規則                   |
| `expandRatio`          | 0.5   | 0.5    | 0.66 | 非主城來源擴張時送出的比例         |
| `castleQueenSendRatio` | 0.2   | 0.33   | 0.4  | Queen-band 主城（15–29）抽出的比例 |

> easy = 反應慢、視野短、保守，玩家可輕鬆側翼；normal = 均衡基準；hard = 評估勤、攻擊距離長、抽城更兇。

## 6. 視覺與 UI

### 6.1 視覺風格

- **45° 斜俯視 iso**：菱形格 `TILE_WIDTH = 64`、`TILE_HEIGHT = 32`；`isoX = (x − y) × 32`、`isoY = (x + y) × 16`；以 `x + y` 深度排序。
- **像素風**：`NEAREST` scale mode、整數縮放避免次像素糊化。4 勢力色 + Neutral 灰。
- **地形繪製**：只有**山有高度**——以堆疊方塊（stacked cubes）繪製，高度（cube 單位）= 該格深入山體的 4-conn 距離變換（邊緣 1、往內 +1，cap 5；每單位 12px），cluster 由邊往中心升高成曲面、頂部加金字塔峰、前面畫 cube 接縫線。平原 / 水 / 林為平面僅以顏色區分。**45° 遮擋處理**：抬高的山格若遮到後方有單位的格 → prism 淡化（alpha）。
- **動畫（GSAP）**：戰鬥 = 互相 bump（由單一 shared ticker 驅動）+ 受擊 tint flash；行軍 = 0.7× 縮小 sprite 沿路徑插值 + count 標籤；hover 高亮 / selection outline / 派遣虛線路徑。

### 6.2 HUD 與面板

桌機佈局——底部一排：Faction Panel（左）／ HUD（中）／ 派遣比例滑桿（右）；頂部：Tile Info（中）／ Map Size 選單（右）。

- **HUD（底部中央）**：當前 tick、下一 tick 倒數、暫停 + 1x/2x/3x/4x。
- **Faction Panel（底部左）**：4 勢力控制格數、總兵力、主城存活，玩家高亮。
- **Tile Info（頂部中央）**：hover 格顯示所有權 / tier / count / 是否主城。
- **Map Size 選單（頂部右）**：切換 11 / 15 / 19 / 27（= 開新局）。
- **End Screen**：勝利 / 敗北 + 統計 + 重新開始（滿版覆蓋）。
- **Responsive（窄螢幕）**：HUD 移頂部中央、Tile Info 移頂部左、Faction 移底部左，避免重疊。

### 6.3 操作方案

| 操作                  | 動作                                                           |
| --------------------- | -------------------------------------------------------------- |
| 左鍵 click            | 選取格（顯示 Tile Info）                                       |
| 左鍵 hold + drag      | 從己方格派遣到目標格                                           |
| 點擊行軍 sprite       | 取消該行軍縱隊（落地併入當前格）                               |
| 右鍵 hold + drag      | 平移視窗（pan）                                                |
| 滾輪 / 中鍵           | 縮放                                                           |
| 觸控雙指              | pinch 縮放 + 平移（單指保留給選取 / 派遣，雙指時暫停單指手勢） |
| 方向鍵 / WASD         | 平移視窗                                                       |
| `Space`               | 暫停 / 繼續                                                    |
| `1` / `2` / `3` / `4` | 變速                                                           |
| `R`                   | 重置攝影機                                                     |
| `Esc`                 | 取消當前拖曳派遣                                               |

- **拖曳判定**：滑鼠移動 > 5px 才算 drag；否則放開 = click。
- **指標按壓 auto-pause**：任何指標按壓期間遊戲時間自動暫停，放開後恢復（手動暫停優先：按壓中若手動暫停，放開不會自動恢復）。讓玩家從容拖曳派遣。

## 7. 勝負條件

### 7.1 勝利

- 玩家「佔領所有其他勢力的主城」（每家 castleOwner 在其主城上失去 occupant → 該家 `defeated`），或在所有其他勢力皆已敗北時玩家主城仍在 → 勝利畫面。

### 7.2 敗北

- 玩家主城 tile 上找不到玩家 faction 的 occupant → 敗北畫面（不論奪城者是誰）。

### 7.3 非玩家勢力敗北

- castleOwner 在其主城上失去 occupant → `defeated = true`。處置：
  - **留存 occupant**：原地轉 `NEUTRAL`（被動 punching bag——正常受擊、不還手、不產兵）。同格多 NEUTRAL 合併。
  - **marching stack + AttackOrder**：立即全部消滅（敗北 = 立即停止行動）。
- `evaluateOutcome`：存活非中立勢力 0 → 平局（winner null）；1 → 該家勝；≥2 → ongoing。

## 8. Acceptance Criteria（current behaviour）

> 對應現行實作的可驗證條目。Engine 條目以 vitest headless 驗（`it("[AC-XX] …")`）；UI 條目以 `pnpm dev` + 瀏覽器肉眼驗。歷史版號（AC-V2/V4/V6 等）已隨整併退場。

| #     | 條件                                                                                                                                              | 驗證                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| AC-01 | 啟動可見 N×N 棋盤（預設 19）、4 主城在四角、玩家為 Tokugawa；`?size=` 切換尺寸 = 開新局                                                           | UI                  |
| AC-02 | Tick 每 2 秒 +1，HUD 顯示；2x 速度時間隔 1 秒                                                                                                     | UI                  |
| AC-03 | 非戰鬥格的非 NEUTRAL / non-defeated occupant（`1 ≤ amount < 100`）每 tick +1；被圍攻的 `to` 凍結；NEUTRAL / 敗北 / cap=100 不長                   | Headless            |
| AC-04 | `deriveTier`：`<5` Soldier、`5` Knight、`15` Queen、`30` King；amount 下降即降階                                                                  | Headless            |
| AC-05 | 主城派遣 100% 來源至少留 1 兵；`amount = 1` 不能派                                                                                                | Headless / UI       |
| AC-06 | 從己方格 hold-drag 顯示 BFS 路徑高亮；目標為敵 / 中立可派，無合法路徑顯示紅色拒絕；無 hop 上限                                                    | UI / Headless       |
| AC-07 | **己方目標 = 補給移動**：中間格須全 own-claimed；中間隔一格中立 / 無主 → `findPath` null，先 claim 該格後找得到                                   | Headless            |
| AC-08 | **非己方目標 = 征服行軍**：最短路徑忽略所有權（僅不可通行地形阻擋），縱隊沿線逐格圍攻                                                             | Headless            |
| AC-09 | **Siege staging**：派往敵格 → 縱隊在相鄰己方 staging 格建立 `AttackOrder`、不踏入敵格；兵力進 `order.count` 而非 staging 駐軍                     | Headless            |
| AC-10 | **戰鬥 ramp**：from=50 vs to=30（敵 claim）逐 tick 序列吻合 `stageDamage`；`t=0` 只有守軍還擊、攻方不輸出                                         | Headless            |
| AC-11 | **break→capture**：守軍殲滅後，敵 claim 格下 tick break（claim→null）、再下 tick capture（claim→faction）；中立 / 無主格 1 步 capture（無 break） | Headless            |
| AC-12 | **佔領後前進**：capture 後 route 非空 → 在 `to` re-spawn 縱隊續攻；route 為空 → 駐紮 `to`；count 耗盡 → order 作廢、已佔格保留                    | Headless            |
| AC-13 | **NEUTRAL 不還擊**：野怪格單方面被砍、清空後 1 步攻佔                                                                                             | Headless            |
| AC-14 | **同陣營合併**：兩條同陣營 stack 同 tick 抵同格 → count 加總、續行 path 取剩餘步數最少（tiebreak 早派遣 / id）                                    | Headless            |
| AC-15 | **取消行軍**：點擊己方行軍 sprite → 縱隊落在當前格併入駐軍、stack 移除                                                                            | UI / Headless       |
| AC-16 | **地形**：山 / 水不可作派遣目標（`findPath` null）、征服路徑繞過；FOREST 守軍受傷 ×0.75（`ceil`）                                                 | Headless            |
| AC-17 | **地形生成**：seeded `generateTerrain` 後主城 + 中立據點恆 PLAINS、四鄰可通行、所有固定點互相連通                                                 | Headless（多 seed） |
| AC-18 | **AI 決定論**：同 `rngSeed` → AI 決策序列完全相同；不同 seed → 分歧                                                                               | Headless            |
| AC-19 | **AI 擴張**：normal-tier 勢力於數十 tick 內佔領鄰近空格（控制格數成長）                                                                           | Headless            |
| AC-20 | **AI 交錯評估**：四家於 `(tick − offset) % evalInterval` 評估、offset 1/2/3/4 不撞 tick                                                           | Headless            |
| AC-21 | **idle / scripted**：`idle` 勢力 marching stack 始終為 0；`scripted` 於指定 tick 派出一筆                                                         | Headless            |
| AC-22 | **敗北處置**：castleOwner 主城失 occupant → defeated、留存 occupant 轉 NEUTRAL、其 marching stack 與 AttackOrder 立即消滅                         | Headless            |
| AC-23 | **勝利 / 敗北畫面**：玩家佔所有敵城 → 勝利；玩家主城失守 → 敗北                                                                                   | UI                  |
| AC-24 | **暫停 / auto-pause**：Space 暫停從停點續算；指標按壓期間時間暫停、放開恢復                                                                       | UI                  |

## 9. 範圍外（Future Scope）

- 任意 / 非方形棋盤、更多尺寸選項
- 子城 / 多城制（已保留 `tile.isCastle` 介面）
- 多人連線、音樂與音效、存檔 / 讀檔、自訂勢力顏色與名稱
- 行軍縱隊主動繞路（中途被切時自動 re-route，目前為退化成 staging）
- **LLM-tier AI（僅設計，未實作）**：在 rule tier 之外加一檔由瀏覽器直連 LLM API、以非同步「scripted channel + `expiresAtTick`」回填決策的 AI。涉及 CORS 部署、prompt caching、成本與降級策略；完整設計探索見 git 歷史中的 `docs/PRD-v1.1-section-4-draft.md`（本次整併移除）。

## 10. 技術對應（模組職責）

### 10.1 引擎層（`src/engine/**`，純邏輯、可 headless）

| 模組            | 職責                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`      | `FactionId` / `Tier` / `Terrain` / `Province` / `Occupant` / `MarchingStack` / `AttackOrder` / `AiMode` / `GameState`     |
| `state.ts`      | `tileId` / `parseTileId` / `derivedOwner` / `isOwnClaimed` / `findOccupant` / `totalAmount`                               |
| `tick.ts`       | `step(state)`：AI → movement → produce → combat → defeats → `tick+1`                                                      |
| `upgrade.ts`    | `deriveTier` + 閾值常數 5 / 15 / 30                                                                                       |
| `production.ts` | `produce`：self-replicate +1/tick、cap 100、圍攻凍結                                                                      |
| `movement.ts`   | `findPath`（own-only / conquer-march）、`dispatch`、`cancelMarchingStack`、`advanceMarching`                              |
| `combat.ts`     | `resolveOrders`：cross-edge `stageDamage` ramp + break→capture + 佔領後前進；`CombatEvent`（fight/break/capture，供渲染） |
| `terrain.ts`    | `isImpassableTerrain` / `applyTerrainDefense` / `generateTerrain`                                                         |
| `victory.ts`    | `applyDefeats` / `evaluateOutcome` / `NON_NEUTRAL_FACTIONS`                                                               |
| `ai.ts`         | `stepAi` + 規則狀態機（defense / assault / expand / rally）+ 交錯評估 + `mixSeed` 決定論                                  |
| `ai-profile.ts` | `RULE_PROFILES`（easy / normal / hard 旋鈕表）                                                                            |
| `util/rng.ts`   | `createRng`（seedable PRNG）                                                                                              |

### 10.2 渲染 / 輸入 / UI 層

| 層           | 模組                                                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 渲染（Pixi） | `render/app` `board`（iso + 地形 prism + 山堆疊 + 遮擋）`units` `marching` `combat`（GSAP）`paths` `sprites`                                 |
| 輸入         | `input/pointer`（click vs drag、左右鍵分流、按壓 auto-pause hook）`keyboard` `camera`（wheel + 觸控 pinch/pan）`dispatch`（拖曳手勢 + 比例） |
| UI           | `ui/hud` `faction-panel` `tile-info` `end-screen` `map-size` `responsive`                                                                    |
| 入口         | `main.ts`（建 engine + renderer + wire UI、tick loop、auto-pause、cancel 接線）                                                              |

## 11. Headless Playtest 與驗證

- **vitest**：engine 單元 + `playtest/integration.test.ts` 跨模組整合測試（CI / 開發回歸網）。
- **`pnpm playtest <scenario.json>`**（`playtest/cli.ts` + `runScenario`）：跑單場 headless。scenario 格式 = `{ name?, boardSize, initialState[], aiConfig, scriptedCommands?, rngSeed }`。可用 `idle` + `scriptedCommands` 跑引擎回歸劇本，或用 `rule` tier 跑 AI 對戰；`--runs N` 做 balance / 勝率分佈（AI 已實作，統計有意義）。
- **PR 驗證**：`/verify` skill 端到端跑通；render / UI 條目靠 manual smoke。
