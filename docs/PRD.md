# 知識戰爭 / Knight Strike — Product Requirements Document

**Version**: v0.5
**Status**: Draft（pre-implementation）
**Changelog**:
- v0.1 — 初稿（9x9、即時 tick、Three.js）
- v0.2 — 棋盤改 11x11、技術棧改 Pixi.js、操作方案重設、戰鬥公式重做、新增 §10 Headless Playtest
- v0.3 — 行軍碰撞細則補完（同勢力合併規則、敵方碰撞三子場景）、stalemate counter 實作規格、marching stack 移除 tier 欄位、AI 短路 + RNG shuffle、主城起始 count = 3
- v0.4 — 修正 scenario 範例主城 count 為 3；AC-19 時序對齊 §3.7；補同勢力跳過戰鬥、敗北勢力 stack 行為、Tick 編號約定
- v0.5 — 修正 §3.6 範例與 AC-08：原「10 Soldier」與 §3.4 閾值矛盾（count 10 應為 Knight），改用 6 Knight vs 5 Knight 場景

## 1. 願景與背景

重製日本免費小品《国家大作戦》(lm_exp, 2005 年前後)，以 Web 技術交付。45° 斜俯視棋盤、像素風角色、即時 tick 戰棋。目標：**單場 12–20 分鐘內結束的中節奏對 AI 戰**。

**Tech Stack**：Vite + TypeScript + **Pixi.js v8** + GSAP。

> **技術棧決策**：原 scaffolding 使用 Three.js + OrthographicCamera 把 2D sprite 放進 3D 空間，是把 2D 遊戲用 3D 引擎硬幹。本作所有玩法都在 2D 格網上發生（45° iso 只是視覺投影），改用 **Pixi.js v8** 更貼合需求：原生 2D sprite、內建 pixel-perfect 渲染、輸入事件 API 直接 hit-test 格子、bundle 更小、無 3D camera 帶來的 orbit/drag 衝突。GSAP 留作 tween 引擎驅動 Pixi 物件動畫。既有 scaffolding（state / faction / province 純資料層）保留，rendering / input 層重寫。

## 2. 名詞表

- **Tick**：遊戲時鐘最小單位，2 秒 / tick。所有產兵、移動、戰鬥都在 tick 邊界結算。
- **Tile / Province**：棋盤上的一格，是所有權與單位的最小單位。
- **Stack**：駐紮在同一格的單位群，由 `(tier, count)` 表示。
- **Marching Stack（行軍 stack）**：派遣後沿路徑移動的暫態單位群，獨立於格上駐紮 stack。
- **Tier**：單位階級 —— Soldier / Knight / Queen / King。
- **主城 (Main Castle)**：每個勢力的核心，失守即敗。
- **戰力 (Power)**：戰鬥結算用的派生值，= count × tier 倍率。

## 3. 玩法核心

### 3.1 棋盤與勢力

- **11x11** 方格。主城置於四角（座標 `(0,0) / (10,0) / (0,10) / (10,10)`）。
- 4 個玩家勢力（Tokugawa / Takeda / Oda / Uesugi），各佔據一個角落主城。
- Neutral 勢力佔據地圖中央 1–3 格山賊據點，不產兵但可被任何勢力佔領（佔領後變為己方一般領地）。Neutral 山賊起始 count = 3（與主城同 Soldier tier，無威脅但需 1–2 次派遣才能掃除）。
- 玩家固定操作 Tokugawa，其餘三勢力由 AI 控制。

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
- 起始太高（≥5 已是 Knight）→ AI 進攻規則 #3 在開局就可能觸發，造成早期翻車。

### 3.2 即時 Tick 引擎

- 全域時鐘以 **2 秒 / tick** 推進。HUD 顯示當前 tick 數與下一 tick 倒數。
- **Tick 編號約定**：Tick 0 為初始狀態（僅渲染、無結算）。Tick 1 起執行下述六步結算順序。產兵於 tick 2 首次觸發（「每 2 ticks +1」= tick 2, 4, 6, ...）。AI 起始評估偏移（§4.3）以 tick 1 為基準：Tokugawa 從 tick 1 評估、Takeda tick 2、Oda tick 3、Uesugi tick 4，之後每 5 ticks 一次。
- 暫停 / 繼續 / 變速 (1x / 2x) 支援；變速影響 tick 實際間隔。
- 每個 tick 結算順序固定：
  1. 移動推進（每 tick 沿路徑前進 1 格，包含 marching stack 入格與 stack-collision 判定）
  2. 戰鬥傷害結算（同步，含駐紮 vs 駐紮、駐紮 vs 行軍、行軍 vs 行軍）
  3. 佔領判定（空格被相鄰己方單位佔據時轉所有權；遭佔領主城觸發勢力敗北）
  4. 產兵（主城）
  5. 升級判定（count 跨過閾值即時推導 tier）
  6. 勝負判定

### 3.3 城堡與產兵

- **主城**：每個勢力 1 座，固定在棋盤角落。每 2 ticks (= 4s) 在城堡格 `count + 1`；若敵軍佔領則停止產兵，所有權變更為佔領方，但**佔領主城 = 該勢力立即敗北**。
- **子城（future scope）**：MVP 不含；保留 `Province.isCastle` 介面供日後擴充。
- 一般領地：不產兵，佔領僅用於擴張勢力範圍與切斷敵方路徑。
- **空但仍屬己方的格子**：count = 0 但仍歸某勢力所有 → 維持所有權直到有敵方單位進入。

### 3.4 單位、Stack 與升級

- 每格的單位狀態為 `(tier, count)`，整格作為一個單位顯示。
- Tier 由 count 推導（純函數，無狀態）：
  - `count < 5` → Soldier
  - `5 ≤ count < 15` → Knight
  - `15 ≤ count < 30` → Queen
  - `count ≥ 30` → King
- Tier 升級 / 降級為**隱含結果**：count 變動後即時更新 tier。畫面上顯示對應 sprite + 數字。
- 同一格只能由單一勢力擁有；不同勢力進入同一格 = 戰鬥而非合併。

> 閾值 5 / 15 / 30 為初稿，待 playtest 微調。預期一場遊戲中段才會看到 Queen、後段才會看到 King。

### 3.5 移動、派駐、路徑、行軍碰撞

#### 3.5.1 派遣手勢（左鍵 hold-drag）

- 玩家在**己方任意格**按下左鍵，拖到**目標格**放開：派遣該格的單位前往目標。
- 拖曳過程：畫一條從來源到目標的高亮路徑（BFS 最短路徑）；若無路徑則顯示紅色不可派遣提示。
- 派遣比例滑桿（25% / 50% / 75% / 100%，記憶上次選擇，預設 100%）。最少派遣 1 兵。
- **主城派遣下限**：主城作為來源時，無論滑桿選何比例，**至少留下 1 兵**。例如主城 count = 10 且選 100%，派遣 9、留 1。若 count = 1 則無法派遣。

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

- **tier 不存欄位**：渲染（選擇 sprite）、戰力（power = count × tier_multiplier）皆由 `deriveTier(count)` 即時推導。原因：避免 stack 合併 / 受傷時忘記同步 tier 造成 bug；單一資料源 = count。
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
4. **敵方 marching stack 同 tick 進同一格**：**頭對頭碰撞**，以 §3.6 戰鬥公式互算傷害（dry-run 各自取對方原始 power 計算 loss，同步寫回）。倖存方行為依**雙方是否以此格為終點**分三子場景：

   | 子場景                              | 倖存方（count > 0）行為                                                      |
   | ----------------------------------- | ---------------------------------------------------------------------------- |
   | **(a) 雙方皆終點**                  | 倖存方停留在此格、入駐並轉所有權；另一方歸零 → 該格歸倖存方                  |
   | **(b) 雙方皆非終點**                | 倖存方繼續沿原路徑（`idx++` 已在 tick 推進階段完成）；該格仍是原所有權       |
   | **(c) 混合：一方終點 / 一方路過**   | 倖存方若為「終點方」→ 停留入駐；若為「路過方」→ 繼續其原路徑、不入駐此格    |

   雙方歸零（同歸於盡）：該格保持原所有權、無單位入駐、無人繼續行軍。

5. **敵方 marching stack 與敵方駐紮 stack 同 tick 抵達同格**：駐紮方視為「終點方」參與 §3.6 戰鬥（一次性結算）。倖存方依 #4 (c) 子場景判斷：駐紮方倖存 → 留下；marching 方倖存且為終點 → 取代所有權留下；marching 方倖存且非終點 → 繼續原路徑、該格成為空格（無 count）。
6. **路徑經過格被敵方臨時切入（敵方剛佔下中間格）**：marching stack 停在前一格（`idx` 不再前進），下 tick 從相鄰格觸發 §3.6 戰鬥；不自動繞路（MVP 簡化，列入 future scope）。

> 規則設計原則：所有同 tick 事件先計算「將發生什麼」（dry-run），再同步寫回，避免順序依賴造成 bug。

### 3.6 戰鬥公式（初稿，playtest 微調）

**戰力倍率**：

| Tier    | Power per unit |
| ------- | -------------- |
| Soldier | 1              |
| Knight  | 4              |
| Queen   | 12             |
| King    | 30             |

**Tile / Stack Power** = `count × tier_multiplier(tier)`

**每 tick 結算**：對每對**相鄰的敵我格**（駐紮 vs 駐紮、駐紮 vs 行軍）及**頭對頭碰撞的行軍對**，雙方同步損失：

> 以下結算僅作用於 owner 不同的相鄰 pair；同勢力相鄰格（含 NEUTRAL 之間）自動跳過。


```
loss = max(0, floor((opponent_power - own_power / 4) / 4))
new_count = max(0, count - loss)
```

- 引入 `own_power / 4` 作為防禦折減：弱勢方對強勢方的攻擊可能為 0，強勢方可單方面壓制。
- 若一格同時被多個敵方相鄰格攻擊，每個攻擊者各別計算 loss 並累加（再扣除 count）。
- count 降到 0 = 該格清空（仍保留所有權直到敵方進入）。
- count 變動後立即重新計算 tier（純函數推導）。

**佔領**：若某格被清空後，下一 tick 有相鄰己方單位（含派遣抵達者），則該格所有權轉為該勢力，count 累加駐入。

**範例計算（用於 AC-08）**：

- 場景：6 Knight (count 6, tier 由 count 推導 = Knight, power = 6 × 4 = 24) vs 5 Knight (count 5, tier = Knight, power = 5 × 4 = 20)
- 6-stack 受到 loss = max(0, floor((20 − 24/4) / 4)) = max(0, floor((20 − 6) / 4)) = max(0, floor(3.5)) = **3**。count 6 → 3，tier 由 Knight 降為 Soldier (3 < 5)。
- 5-stack 受到 loss = max(0, floor((24 − 20/4) / 4)) = max(0, floor((24 − 5) / 4)) = max(0, floor(4.75)) = **4**。count 5 → 1，tier 由 Knight 降為 Soldier (1 < 5)。

設計意圖不變：同 tier 對戰也可造成顯著消耗、跨閾值即時降級。

**設計意圖**：高 tier 不只抗打更是輸出乘法 —— King 戰力倍率 30，可在小數量下單方面屠殺低 tier 大軍。閾值 5 / 15 / 30 拉開後，玩家需累積較久才能享受質變，但一旦升級威力顯著。

### 3.7 弱勢平衡（stalemate 防護）

公式中 `loss` 可為 0 → 兩個對峙小 stack 可能永久互相打不死。引入 **per-adjacency-pair stalemate counter** 強制消耗。

#### 3.7.1 規則

- 每對「**相鄰敵我格 pair**」（無向，以 `(tileA_id, tileB_id)` 排序後當 key）維護一個 `stalemateTicks: number`，預設 0。
- 每 tick 戰鬥結算後檢查每個現存 pair：
  - 若該 pair 本 tick 戰鬥**雙方 loss 都是 0** → `stalemateTicks++`。
  - 若**任一方 loss > 0** → `stalemateTicks = 0`（重置）。
- 當 `stalemateTicks >= 5`，pair 進入 **drain mode**：**該 tick 及之後每 tick**，無視公式直接讓兩格各扣 1 count（最小 0）。
- Drain mode **持續**直到 pair 不再存在（任一格清空、易主、雙方非相鄰）。一旦 pair 解散，counter 同 pair key 一併丟棄；若日後重新出現該 pair，counter 從 0 重數。

#### 3.7.2 實作層規格

```ts
type PairKey = string;  // 形如 "tile:3,5|tile:4,5"，小座標在前
type StalemateMap = Map<PairKey, number>;

function pairKey(a: TileId, b: TileId): PairKey {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// tick 結算尾段，combat 階段後呼叫
function updateStalemates(
  prevMap: StalemateMap,
  combatPairs: Array<{ a: TileId; b: TileId; lossA: number; lossB: number }>
): { nextMap: StalemateMap; drainDeductions: Map<TileId, number> } {
  const nextMap = new Map<PairKey, number>();
  const drain = new Map<TileId, number>();
  for (const { a, b, lossA, lossB } of combatPairs) {
    const key = pairKey(a, b);
    const prev = prevMap.get(key) ?? 0;
    const next = (lossA === 0 && lossB === 0) ? prev + 1 : 0;
    nextMap.set(key, next);
    if (next >= 5) {
      drain.set(a, (drain.get(a) ?? 0) + 1);
      drain.set(b, (drain.get(b) ?? 0) + 1);
    }
  }
  return { nextMap, drainDeductions: drain };
}
```

- `drainDeductions` 在 tick 結算最後一步套用（產兵之前），確保產兵能立刻補上。
- Pair 不在本 tick `combatPairs` 中（已解散）→ 自動從 `nextMap` 移除。
- Drain 與一般 loss **不疊加**：若某 tick 本身 loss > 0（counter 重置），不適用 drain；若 loss = 0 且 counter ≥ 5，**用 drain 取代** 0 loss。

#### 3.7.3 驗收

見 AC-19。

## 4. AI 行為（MVP 版）

每個 AI 勢力獨立跑簡單狀態機，每 5 ticks 評估一次。

### 4.1 規則（**短路執行**：依序檢查，**第一條觸發即執行並退出本次評估**）

1. **威脅評估**：若主城相鄰 2 格內有敵軍，從最近己方格調 50% 兵力回防（受 §3.5.1 主城下限保護）。
2. **擴張**：若有未控制的相鄰空格且自身某格 stack ≥ 5，派 50% 兵去佔領。
3. **進攻**：若任一己方格能在 ≤ 4 格內到達敵方主城且戰力差有利（己方 power ≥ 敵方 power × 1.5），派 100% 進攻。
4. **囤兵**：以上皆不滿足時不動，等下次評估。

### 4.2 評估順序 RNG shuffle（避免 deterministic bias）

當 AI 在某條規則中**選候選**（己方格、目標格、進攻路線）時，候選清單以**確定性 PRNG**（seed 來自 §10.2 的 `rngSeed` + 勢力 ID + tick）做 Fisher–Yates shuffle 後再 iterate。例如：

- 規則 #1「從最近己方格調兵」→ 取距離最小的候選集合（可能 ties），shuffle 後取第一個。
- 規則 #2「自身某格 stack ≥ 5」→ 篩出所有合格來源格，shuffle 後 iterate 直到找到可派遣空格組合。
- 規則 #3「己方格能在 ≤ 4 格內到敵方主城」→ 篩出所有合格 (來源, 目標) pair，shuffle 後取第一個滿足戰力差條件的。

> 設計意圖：純座標掃描會讓 AI 永遠先從 NW 角下手，造成對局可預測且空間不平衡；shuffle 引入多樣性但仍可重現（同 seed 同結果）。

### 4.3 評估間隔錯開

四家 AI（含玩家若 AFK）各自獨立 5-tick 評估週期，但**起始 tick 偏移**錯開：Tokugawa tick 1、Takeda tick 2、Oda tick 3、Uesugi tick 4 開始評估，後續每 5 ticks 一次。避免同一 tick 大量 AI 同時下令造成 lag spike。

三家 AI 行為相同；難度差異留待 future scope。

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
- 或：在所有其他勢力皆已敗北（被其他 AI 滅了）的狀態下玩家主城仍在 → 勝利。

### 6.2 敗北

- 玩家主城被任一敵方勢力佔領 → 敗北畫面。

### 6.3 AI 勢力敗北

- AI 勢力主城被佔領 → 該勢力 `defeated = true`（沿用 `GameState`），其餘城外格立即變為 Neutral 所有，stack 保留作為野怪（不再行動）。
- 敗北勢力的留存 stack 在後續結算中視同 `NEUTRAL` owner：正常參與 §3.6 戰鬥與 §3.7 stalemate counter；不主動派遣、不產兵。

## 7. Acceptance Criteria（可驗證）

每條都可由人類手動或自動化測試驗證。AC-04 / AC-05 / AC-08 等純邏輯項可在 Headless Playtest（見 §10）中跑自動測試。

| #     | 條件                                                                                                                            | 驗證方式                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| AC-01 | 啟動後可見 **11x11** 棋盤、4 主城在四角、玩家為 Tokugawa                                                                        | 開啟瀏覽器肉眼確認                                                                                                |
| AC-02 | Tick 計數每 2 秒 +1，HUD 顯示                                                                                                   | 觀察 10 秒應為 5 ticks                                                                                            |
| AC-03 | 主城所在格每 4 秒 count +1                                                                                                      | 暫停所有派遣，觀察 20 秒應 +5                                                                                     |
| AC-04 | 當格 count 達 5 → sprite 變為 Knight；達 15 → Queen；達 30 → King                                                               | Headless 測試：強制 setCount，斷言 deriveTier 回傳正確 tier                                                       |
| AC-05 | count 從 15 掉到 14 → sprite 退回 Knight；從 5 掉到 4 → 退回 Soldier                                                            | Headless 測試：模擬戰鬥減 count，斷言 tier 更新                                                                   |
| AC-06 | 從己方格 hold-drag 到 5 格外目標 → 顯示 BFS 路徑高亮，**目標格為敵方時仍可派遣**                                                | 操作確認；嘗試 drag 到敵方相鄰格與 5 格外敵方格                                                                   |
| AC-07 | 派遣後來源 count 減少對應數，目標格在抵達 tick 後 count 增加（或進入戰鬥）                                                      | 觀察兩格 count 變化吻合；測試比例 50% / 100%                                                                      |
| AC-08 | 6 Knight vs 5 Knight 相鄰 1 tick 後：6-stack count=3 tier=Soldier，5-stack count=1 tier=Soldier                                  | Headless 測試：setUp 後 advance(1)，斷言 count 與 tier 完全符合                                                   |
| AC-09 | 空格被相鄰己方派遣/推進佔領，所有權變更，HUD 計數更新                                                                           | 操作確認                                                                                                          |
| AC-10 | 佔領敵方主城 → 該 AI 勢力 `defeated`，其餘領地變 Neutral                                                                        | 操作確認 + 控制台檢查；或 Headless 跑「玩家秒殺」場景                                                             |
| AC-11 | 玩家主城被佔領 → 顯示「敗北」畫面 + 重新開始按鈕                                                                                | 操作確認；重新開始可回初始狀態                                                                                    |
| AC-12 | 玩家佔領所有 3 個 AI 主城 → 顯示「勝利」畫面                                                                                    | 操作確認                                                                                                          |
| AC-13 | 暫停按鈕停止 tick，恢復後從停止處繼續                                                                                           | 暫停 5 秒後恢復，tick 數連續                                                                                      |
| AC-14 | 2x 速度按下後 tick 間隔 = 1 秒                                                                                                  | 計時 10 秒應為 10 ticks                                                                                           |
| AC-15 | AI 勢力會擴張：開局後 30 ticks 內每 AI 至少佔領 1 個鄰格                                                                        | Headless 跑 30 ticks，斷言每 AI 控制格數 ≥ 2                                                                      |
| AC-16 | 主城派遣 100% 時來源至少保留 1 兵                                                                                               | 操作 / Headless：主城 count = 10，派遣 100%，斷言來源剩 1、marching stack count = 9                               |
| AC-17 | 敵方 marching stack 同 tick 進同格 → 頭對頭碰撞使用 3.6 公式                                                                    | Headless：兩 marching stack 同時抵達中間格，斷言 loss 計算與 3.6 一致                                             |
| AC-18 | 路徑被切：marching stack 在前一格停下，下 tick 從相鄰戰鬥                                                                       | Headless：派遣中讓敵方切入路徑，斷言 marching stack idx 停滯且觸發 3.6                                            |
| AC-19 | 僵局持續消耗：兩相鄰 3 Soldier 對峙（loss = 0），第 5 tick 起每 tick 雙方 count 各 −1 直到歸零                                  | Headless：擺 3 vs 3 對峙，advance(4) 後雙方 count = 3；advance(5) 後 = 2；advance(6) 後 = 1；advance(7) 後 = 0      |
| AC-20 | 同勢力雙 marching stack 同 tick 入同格 → 合併、path 取剩餘步數最少者，tiebreak 取早派遣者                                       | Headless：派遣 stack A（剩 3 步）與 stack B（剩 1 步）同時抵達；斷言合併後 count 加總且 path 用 B 的剩餘 path     |
| AC-21 | 敵方 marching stack 頭對頭（雙方非終點）→ 倖存方繼續原路徑、不入駐碰撞格                                                       | Headless：擺好兩條路徑交叉的 stack，斷言碰撞 tick 後倖存方 idx 仍前進、碰撞格無新主                               |
| AC-22 | AI 評估順序 RNG shuffle：同 seed 重跑 100 場結果完全相同；不同 seed 結果分佈不同                                                | Headless：`pnpm playtest scenario.json --runs 100 --seed 42` 兩次跑結果 hash 一致；換 seed → hash 不同            |

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
| `src/engine/ai.ts`         | AI 狀態機                                           |
| `src/engine/victory.ts`    | 勝負判定                                            |
| `src/engine/types.ts`      | 共用型別（Faction / Tier / Province / MarchingStack）|

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

## 10. Headless Playtest 腳本規格

引擎層完全無 Pixi/DOM 依賴 → 可在 Node 跑純邏輯模擬，用於 **balance 測試、回歸測試、formula 微調**。

### 10.1 CLI 入口

```bash
pnpm playtest <scenario.json>                  # 跑單場
pnpm playtest <scenario.json> --runs 100       # 跑 100 場統計勝率
pnpm playtest <scenario.json> --log events     # 輸出 per-event 詳細 log
pnpm playtest <scenario.json> --max-ticks 500  # 超時平局
```

實作位置：`src/playtest/cli.ts`，由 `tsx src/playtest/cli.ts` 執行。

### 10.2 Scenario 檔格式

```json
{
  "boardSize": 11,
  "initialState": [
    { "x": 0,  "y": 0,  "owner": "TOKUGAWA", "count": 3, "isCastle": true },
    { "x": 10, "y": 0,  "owner": "TAKEDA",   "count": 3, "isCastle": true },
    { "x": 0,  "y": 10, "owner": "ODA",      "count": 3, "isCastle": true },
    { "x": 10, "y": 10, "owner": "UESUGI",   "count": 3, "isCastle": true },
    { "x": 5,  "y": 5,  "owner": "NEUTRAL",  "count": 3, "isCastle": false }
  ],
  "aiConfig": {
    "TOKUGAWA": "default",
    "TAKEDA":   "default",
    "ODA":      "default",
    "UESUGI":   "default"
  },
  "scriptedCommands": [
    { "atTick": 3,  "from": [0,0], "to": [1,0], "ratio": 1.0 },
    { "atTick": 10, "from": [1,0], "to": [2,0], "ratio": 0.5 }
  ],
  "rngSeed": 42
}
```

- `aiConfig` 任一勢力填 `"default"` = 跑 AI；填 `"scripted"` = 只聽 `scriptedCommands`；填 `"idle"` = 不動。
- `rngSeed` 必填 → 完全可重現。

### 10.3 輸出格式

**Summary（預設）**：

```
Scenario: default-11x11
Runs: 100
Results:
  TOKUGAWA wins: 24 (24%)
  TAKEDA wins:   31 (31%)
  ODA wins:      22 (22%)
  UESUGI wins:   18 (18%)
  Stalemate:      5 (5%)
Avg game length: 187 ticks (374s @ 1x)
Median:          164 ticks
P95:             312 ticks
```

**Detail mode (`--log events`)**：每 tick 一行 JSON，含產兵 / 派遣 / 戰鬥 / 佔領 / 升級 / 敗北事件。

### 10.4 用途與驗收

| 用途           | 驗證方式                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| Balance 檢查   | 100 場勝率所有勢力差距 ≤ ±10%（位置不對稱可能造成天然差距，但需在可控範圍） |
| Formula 回歸   | 改公式前後跑相同 seed 100 場，diff 平均場長、勝率變化                      |
| AC 自動驗證    | AC-04 / 05 / 08 / 15 / 17 / 18 / 19 用 playtest 框架寫成 vitest 測試       |
| 發布前 smoke   | `pnpm playtest src/scenarios/default.json --runs 10` 過 = 引擎可玩         |

### 10.5 與單元測試的分工

- **vitest 單元測試**：純函數（`deriveTier`、`computeLoss`、BFS）。
- **vitest 整合測試**：呼叫 playtest engine API、設場景、advance、斷言。
- **CLI playtest**：人類觸發的探索性壓測，產出統計報告，不掛 CI。

## 11. 驗證計畫（總覽）

| 階段             | 工具                                       | 範圍                                          |
| ---------------- | ------------------------------------------ | --------------------------------------------- |
| 開發中           | vitest 單元 / 整合測試                     | AC-04 / 05 / 08 / 15 / 17 / 18 / 19           |
| Manual smoke     | `pnpm dev` + 瀏覽器                        | AC-01 / 02 / 03 / 06 / 07 / 09 / 11 / 12 / 13 / 14 / 16 |
| Balance 探索     | `pnpm playtest --runs 100`                 | 勝率分佈、場均長度                            |
| 發布前 sign-off  | `/run` skill 跑三場：速勝 / 敗北 / AI 互打 | 端到端體感                                    |
| PR 驗證          | `/verify` skill                            | 最後一次端到端跑通                            |
