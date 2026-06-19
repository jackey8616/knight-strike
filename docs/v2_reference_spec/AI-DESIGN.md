# AI 設計 — Knight Strike v2（M12）

> **狀態：已核准（user 拍板），實作中（M12）**。已折入 PRD §5.1（v2.2）。
>
> **關鍵發現（playtest）**：實作 AI 時發現——房屋只產 **100 人小隊**、若無「友軍合併」則經濟永遠養不出能破城（城堡 300 耐久）的大軍，4-AI 對局永遠 ongoing。故新增 **友軍同格合併**（PRD §4.7，修正 v2_reference_spec §3.2「不能合併人數」之框架）：友軍堆疊成一支大軍，戰鬥仍部隊間 1v1。這是 AI「④ 集結」能成軍的前提。

## 1. 目標與約束

- **對象**：3 個非玩家勢力（及任何設為 `easy`/`normal`/`hard` 的勢力）。玩家固定 idle 操作（手動）。
- **純邏輯 + headless**：AI 是引擎層純函數 `stepAi(state) => GameState`，無 Pixi/DOM；跑得了 `pnpm playtest:v2` 與 vitest。
- **決定論**：同 (種子, scenario) → 完全相同的 AI 決策序列（重播 / 回歸前提，AC-37 同源）。用 `mixSeed(rngSeed, faction, tick)` 推導 per-faction 亂數做 tie-break。
- **經濟感知**：v2 AI 必須經營經濟（建房 → 田地 → 人口 → 產兵）才有兵可打，與 v1 的純軍事 count-tier AI 完全不同。
- **可調**：所有數值走難度旋鈕表（§4），flagged-tunable，靠 playtest / balance 校準（§5）。

## 2. 評估節奏與決定論

- **同步評估（無交錯）**：所有 rule 勢力每隔「評估間隔」tick（難度旋鈕）在**同一批 tick**、各讀**同一份 tick 起始快照**評估、合併行動。沿用 v1 的反方位偏差設計。
- **wiring**：`stepAi` 排在 tick 結算順序**最前**（`advanceMarch` 之前），故 AI 本 tick 下的指令（建房 / 派軍）當 tick 生效。
- **決定論**：tie-break（多個等價目標）一律用 `mixSeed` 亂數，無 `Math.random`。

## 3. 決策優先序（每次評估，短路命中即停）

依序嘗試 **① 防守 → ② 經濟（建房 / 調稅）→ ③ 進攻 → ④ 推進**：

| 序 | 規則 | 觸發 / 動作 |
|---|---|---|
| ① 防守 | 自家城堡 / 房屋「防禦半徑」（Manhattan，難度）內有敵 / 怪物部隊 | 把最近的閒置我軍 `issueMarch` 回去攔截 |
| ② 經濟 | 國庫 ≥ 建房成本，且有閒置我軍站在「可建造、且不在我方房屋 Moore-8 內」的土地 | 該軍 `buildHouse`（撐起經濟 / 產兵循環）。稅率依難度固定設定（§4） |
| ③ 進攻 | 有「夠強」的閒置我軍（人數 ≥ 進攻門檻）且「攻擊距離」內有敵目標 | `issueMarch` 去打。目標排序：**可破的敵城堡** → 敵房屋（斷其經濟）→ 敵部隊 → 最近者 → tie 用 `mixSeed` |
| ④ 推進 | 有閒置我軍但無立即目標 | 朝**最近敵城堡**方向 `issueMarch` 一步步推進（取代隨機遊走），預備下一波 |

> **產兵交給引擎**：房屋人口 ≥100 自動產兵（M6），AI 不需顯式下令產兵；AI 只負責「建房 / 調稅 / 派閒置軍」。
> **破壞敵建築**：進攻抵達敵城堡 / 房屋時，引擎的 destruction 由 AI 下 `startDestruction`（攻城 = 殺國王 = 取勝）。

## 4. 難度旋鈕表（提案預設值，待 tune）

| 旋鈕 | easy | normal | hard | 意義 |
|---|---|---|---|---|
| 評估間隔（tick） | 8 | 5 | 3 | 越小越勤 |
| 防禦半徑（Manhattan） | 1 | 2 | 3 | 城堡 / 房屋威脅偵測半徑 |
| 攻擊距離（×棋盤邊長） | 0.5 | 1.0 | 1.75 | 進攻掃描半徑 = round(邊長 × 此值) |
| 進攻人數門檻 | 800 | 600 | 400 | 派軍進攻所需最低人數（balance pass 調高，配合友軍合併大軍） |
| 房屋目標數 | 3 | 5 | 7 | 經濟擴張：建到此房屋數才轉純軍事 |
| 稅率 | 10% | 15% | 20% | 高稅 = 多金養兵、慢成長（需 > 0 才有稅收，§6） |
| 建房積極度 | 低 | 中 | 高 | 每次評估最多發起幾筆建房 |

> easy = 慢、保守、低稅慢攻；hard = 勤評估、長攻擊距離、高稅快攻。

## 5. 平衡定義與調校

- **平衡判準**（4-AI spectator 對局，`pnpm playtest:v2 spectator-4ai --runs 100`）：①僵局率（到 maxTicks 未分勝負）低於門檻（提案 < 25%）；②單一勢力勝率不過半（各家收斂到 ~15–35%）；③平均場長合理（不過短 / 過長）。
- **調校工具**：新增一個 `spectator-4ai` v2 scenario（四角城堡 + 起始軍 + rule AI），跑 `--runs 100` 看勝率 / 場長分佈；再加 `pnpm balance` v2 守門（BL-1203）。數值改動回本文件 / PRD §6 bump。

## 6. 模組與 wiring

| 模組 | 職責 |
|---|---|
| `src/engine/v2/ai.ts` | `stepAi(state): GameState`——對每個 rule 勢力跑 §3 狀態機（同步、決定論）。複用 `mixSeed`（v1 util 移植）/ `vonNeumannNeighbors` / `findPath` / `issueMarch` / `buildHouse` / `startDestruction` |
| `src/engine/v2/ai-profile.ts` | `RULE_PROFILES: Record<RuleTier, Profile>`——§4 旋鈕表 |
| `src/engine/v2/tick.ts` | `stepAi` 排在 step 最前（march 之前） |
| `src/engine/v2/util/rng.ts` | `mixSeed`（若未有，從 v1 移植） |
| `src/playtest/v2/scenarios.ts` | 加 `spectator-4ai`（四家 rule AI 對局） |
| `src/playtest/v2/balance-check.ts`（新） | v2 平衡守門 + `pnpm balance` 切 v2 |

## 7. 新增 AC（提案，核准後編號）

- **AI 決定論**：同 (種子, scenario) → AI 決策序列完全相同；不同種子 → 分歧。
- **AI 經濟**：normal 勢力於數十 tick 內建房、控制格數 / 房屋數成長。
- **AI 進攻**：兵力足夠時對最近敵目標派軍 / 攻城。
- **AI 防守**：敵軍逼近城堡時回防。
- **idle / scripted 不變**：idle 勢力永不主動行動。

## 8. 議題決議（user 已拍板）

1. **稅率策略**：✅ **固定**（§4 每難度一值），動態列後續。
2. **平衡門檻**：✅ 僵局率 < 25% / 勝率 15–35%（迭代目標；數值 flagged-tunable）。
3. **怪物 AI**：✅ 後續再做（M12 怪物先靜止、被接觸才參戰）；AI 重心先放對手勢力。
4. **橋 / 柵欄 AI**：✅ M12 **不做**（只建房 + 派軍 + 攻城）。
5. **難度預設值**：✅ §4 表當起點，靠 balance 迭代。

> **平衡現況（balance pass 後）**：補上**稅收金錢**（§6——原本漏實作，國庫永遠不長 → 經濟養不出大軍）+ AI **經濟擴張**（建到 houseTarget 房屋）+ **seeded 目標 tie-break** 後，4-AI 對局**收斂到不同勝者**（24-seed 實測 ODA 54% / TAKEDA 33% / UESUGI 13%，平均 ~1022 tick）。仍偏態（ODA 偏高、TOKUGAWA 0%——位置 / 處理順序殘留不對稱）；**收斂到 15–35% 勻分為持續 tune 項**（旋鈕 / 城堡耐久 / 地圖皆 flagged-tunable）。診斷工具：`tsx src/playtest/v2/diag.ts`。
