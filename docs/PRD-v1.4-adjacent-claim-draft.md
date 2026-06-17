# PRD v1.4 草案 — 鄰邊攻擊 + 兩階段 claim（adjacent combat + break→capture）

> **狀態**：DRAFT，待使用者確認後折入 `docs/PRD.md` 並 bump v1.3 → v1.4。
> 本草案只描述「相對 v1.3 的差異」與新規則全文；未提到的章節（§3.1 / §3.3 self-replicate / §3.4 tier / §3.8 幾何 / §6 勝負）**維持 v1.3 不變**，除非下方明列。

---

## 0. 一句話總結

v1.2/v1.3 的「同 tile multi-occupant 互砍」整套廢除，改回**鄰邊（cross-edge）戰鬥**：
單位永遠**不**與敵軍共格。要拿下一個非己方 tile，流程是

1. **行軍**只能走自己 claim 的 tile，把攻擊部隊送到目標格的相鄰己方格（staging tile）。
2. 目標格上**有敵/野單位** → 用 §3.6（保留）公式跨邊互砍，直到敵單位殲滅。
3. 目標格**空但仍被敵方 claim** → 每 tick 花 1 單位 → 變 NEUTRAL（破壞）。
4. 目標格**空且中立 / 無主** → 再花 1 單位 → 變己方 claim（攻佔）。攻佔為 **claim-only**：部隊**不**移入，留在 staging tile。

戰鬥**只由派遣（dispatch）觸發**；被攻擊方的駐軍**自動還擊**，但閒置部隊不會主動找敵人打。

---

## 1. ⚠️ 我替你做的決策（請逐條確認 / 駁回）

下列是你前兩輪回答**沒有明講**、但實作上一定要定的點。我給了我認為合理的預設；不同意的請直接說。

| # | 決策點 | 我的提案 | 影響 |
| - | ------ | -------- | ---- |
| **D1** | 攻佔 / 破壞「花費的單位」是**永久消耗**還是只是動作標記？ | **永久消耗**（「花費」字面意義）：破壞 -1、攻佔 -1，都從 staging 駐軍 count 永久扣掉。 | 拿一個「敵方空 claim 格」總共要燒 2 兵；拿中立空格 1 兵。擴張有真實成本。 |
| **D2** | 攻擊部隊抵達 staging tile 後，是**併入該格駐軍變 occupant**，還是維持獨立 marching stack？ | **併入成 occupant**（駐軍），另存一筆 **AttackOrder { from, to }** 記錄「這格正在打那格」。 | 「unit stays put」最自然的解讀；戰鬥 phase 跑 AttackOrder 列表。 |
| **D3** | 鄰邊戰鬥的 tick-0 駐紮優勢給誰？ | 給**目標格駐軍（defender）**：order 的 `t=0` 只有 defender 還擊、攻方不輸出；`t≥1` 雙方互打。 | 攻堅要先賠一 tick，保留「守土結構優勢」（沿用 §3.6 精神）。 |
| **D4** | 多方同打一格 / 一格同打多目標 | 沿用 §3.6 multi-party：每對 (attacker,target) 獨立套 `min(base, attacker.count)`；defender 受各攻方總和、對每個攻方各還一份。 | 邊界多打一是允許的。 |
| **D5** | NEUTRAL 野怪（bandit）被攻 | 沿用 §6.3：NEUTRAL **不還擊**。攻方單方面砍到 0 → 該格中立空格 → 1 兵攻佔（不需破壞步驟）。 | 野怪維持「無威脅、1–2 次派遣可清」。 |
| **D6** | 派遣目標是**己方** tile（補給 / 重新佈署） | 正常移動：沿己方 claim 路徑，部隊**實際移入**目標格 occupant（併入 / 新增）。**不**走 siege 流程。 | territory 內調兵照舊搬人。 |
| **D7** | 「同格 multi-occupant」是否還可能發生？ | **不再允許**：一個 tile 至多一個 faction 在場（occupant 或 claim）。combat 全部跨邊。極端同 tick 兩家搶同一空格 → 用既有 RNG tiebreak 擇一 claim、另一方 order 落空。 | 大幅簡化資料模型；`combatStartTick` / 同格戰鬥碼移除。 |
| **D8** | staging 駐軍若被還擊打死、或玩家把它調走 | order 的 `from` occupant 消失 → 該 AttackOrder 自動作廢移除。 | siege 需要持續有兵在 staging 才繼續。 |
| **D9** | order 的 combat tick `t` 起算點 | `t = currentTick - order.startTick`；`startTick` = 部隊抵達 staging 並建立 order 的 tick。目標被殲滅後若 order 轉入破壞 / 攻佔階段，**不重置** t（破壞 / 攻佔每步固定花 1 兵、與 t 無關）。 | |

---

## 2. §3.5.2 路徑規則（改寫）

- **Passable（中間經過格）= 己方 claim only**：tile 作為**中間經過格**可通行 iff `derivedOwner(tile) === faction`。
  - 等價於：該格有自家 occupant（任何 amount），**或** 0 occupant 且 `lastClaimedFaction === faction`（walk-through 染色的空己方格）。
  - **空無主格（`lastClaimedFaction === null`）、中立格、敵方 claim / 敵方駐軍格 一律不可作中間經過格。**
- **目標格不需 passable**（沿用 v1.3）：目標可以是敵方駐軍 / 敵方空 claim / 中立 / 無主空格。BFS 只檢查中間格。
- **目標格為非己方時 → siege 模式**（見 §3.5.4'）：路徑終點是目標，但部隊**停在路徑倒數第二格**（己方 staging tile，與目標相鄰），不踏入目標。
- **目標格為己方時 → 普通移動**（見 D6）。
- 無己方連通路徑（source 與「目標相鄰的某己方格」之間無 own-claimed 通路）→ 紅線拒絕派遣。

> **設計後果**：擴張變成「逐格推進」——先攻佔邊界格（claim 翻面、變空己方格），再把駐軍往前搬一格，再攻下一格。self-replicate（§3.3 維持）負責把被消耗的邊界駐軍補回。

## 3. §3.5.4' 行軍抵達與 siege 建立（取代 v1.2/v1.3 §3.5.4 multi-occupant 加法）

marching stack 每 tick `idx++` 沿 path 前進（path 全程己方 claim）。抵達結算：

| 情境 | 行為 |
| ---- | ---- |
| **抵達 path 終點且終點為己方格** | 部隊移入該格：併入既有自家 occupant / 新增自家 occupant。stack 消滅。（普通移動，D6） |
| **抵達 staging tile（path 倒數第二格，終點為非己方目標）** | 部隊併入 staging tile 的自家 occupant（無則新增），stack 消滅；建立 / 更新 `AttackOrder { from: staging, to: target, faction, startTick: currentTick }`。同 (from,to) 已存在 order → 取較早 startTick、count 已併入駐軍。 |
| **中途格突然不再 passable**（被敵 claim / 敵軍進駐） | 該格不再是己方 → 視為「無路可走」：stack 停在前一個己方格。若前一格與原目標仍相鄰則退化為 staging（建立 order）；否則 stack 就地併入該己方格 occupant、放棄 order。（繞路屬 §8 future scope） |

> v1.2 的 force-join / 同格抽 defender / 同 tick 多 stack 抵敵格 全部**廢除**（不再有同格混戰）。同陣營多 stack 同 tick 抵同一己方格仍沿用 v1.2 #1 合併規則（count 加總、path 取剩餘步數最少）。

## 4. §3.6' 戰鬥公式（鄰邊版，保留 step-function）

**結算對象**：每一筆 `AttackOrder`（`from` 己方駐軍格、`to` 目標格）。**不再**以「同格 2+ faction」為觸發。

**combat tick**：`t = currentTick - order.startTick`。
**傷害**：`base = stageDamage(t) = 2 ** floor(log2(max(t,1)))`（**完全沿用 v1.2 公式與對照表**）。

每 tick combat phase（dry-run，先全算後同步寫回）對每筆 order：

```
A = from.occupant(faction)          # 攻方駐軍
D = to.occupant(any hostile)        # 目標駐軍（可能不存在）

if D exists and D.amount > 0:        # 階段一：消滅敵單位
    base = stageDamage(t)
    # tick-0 駐紮優勢（D3）：t==0 只有 defender 還擊
    if t >= 1 and A.faction != NEUTRAL:
        D.incoming += min(base, A.amount)
    if D.faction != NEUTRAL:                       # NEUTRAL 不還擊（D5）
        A.incoming += min(base, D.amount)
    # 同步寫回、移除歸零 occupant
else if to is empty:                 # 階段二/三：claim 結算（與 t 無關）
    if to.lastClaimedFaction is a live hostile faction (非 NEUTRAL/null):
        A.amount -= 1                # 破壞：花 1 兵
        to.lastClaimedFaction = null # → 中立
    else:                            # to 已中立 / 無主
        A.amount -= 1                # 攻佔：花 1 兵
        to.lastClaimedFaction = A.faction
        order 完成 → 移除
    if A.amount <= 0: from occupant 消滅、order 作廢（D8）
```

- **多 order 對同一 `to`**：先全部跑階段一（各自對 D 造成傷害、各自吃 D 還擊），D 歸零後同 tick 內由「處理順序最前（`from` tile id 字典序）」的 order 推進 claim；其餘 order 看到更新後狀態（已中立 → 直接攻佔 or 已被別人佔走 → 作廢）。
- **claim-only**：攻佔成功時部隊**不移入** `to`；`to` 變 `occupants: []`、`lastClaimedFaction = A.faction`（己方空格，之後可被行軍通過 / 移入）。A 駐軍留在 `from`。
- §3.6 的 `combatStartTick` tile 欄位**移除**（改由 order.startTick 承載）。同歸於盡、defender 抽籤、assignDefender 等同格邏輯**全部移除**。

## 5. 資料模型變更（§9.1）

```ts
// types.ts
type Province = {
  readonly id: TileId;
  readonly x: number; readonly y: number;
  readonly isCastle: boolean;
  readonly castleOwner: FactionId | null;
  readonly occupants: readonly Occupant[];   // 不變式：至多 1 個 faction（單格不混戰）
  readonly lastClaimedFaction: FactionId | null;
  // 移除：combatStartTick
};

type AttackOrder = {
  readonly from: TileId;       // 己方 staging 駐軍格
  readonly to: TileId;         // 目標格（與 from 4-conn 相鄰）
  readonly faction: FactionId;
  readonly startTick: number;
};

type GameState = {
  // ...既有...
  readonly attackOrders: readonly AttackOrder[];   // 新增
  // occupants 不變式收緊為單 faction，Occupant.isDefender / arrivalTick 可保留供 tier/UI，但戰鬥不再讀 isDefender
};
```

- `Occupant.isDefender`：戰鬥不再用（defender 角色由 order 結構決定）。可暫留欄位避免大改 fixture，或一併移除（待確認）。
- `combatStartTick`：移除。

## 6. §3.2 step order（v1.4）

```
1. movement   advanceMarching：stack idx++、抵達 → 移入己方格 or 建立 AttackOrder（§3.5.4'）
2. produce    castle / self-replicate 加法（§3.3 不變）
3. combat     resolveOrders：跑 AttackOrder 列表（§3.6' 階段一傷害 + 階段二/三 claim）
4. defeats    castle 上無 castleOwner occupant → defeated；其 occupant 轉 NEUTRAL、marching stack + 其 AttackOrder 立即消滅（§6.3 沿用 + order 清理）
5. victory
```

## 7. AC 變更（§7.2）

**廢除**（同格 multi-occupant 模型相關）：AC-V2-08 / 10 / 11 / 16 / 17 / 24 / 26 / 28（同格互砍、force-join、同格抽 defender、同歸於盡 …）。

**新增 / 改寫**（草案，folding 時編號定案）：

| # | 條件 | 驗證 |
| - | ---- | ---- |
| AC-V4-01 | BFS passable = 己方 claim only：中間隔一格中立 / 無主空格 → `findPath` 回 null；把該格先 claim 成己方後 → 找得到路 | Headless |
| AC-V4-02 | 派遣到敵方駐軍格 → 部隊停在相鄰己方 staging、建立 AttackOrder（不踏入敵格） | Headless：斷言 marching stack 消滅、`attackOrders` 多一筆、敵格 occupants 不含我方 |
| AC-V4-03 | 鄰邊戰鬥沿用 `stageDamage`：攻 12 vs 守 30，逐 tick 斷言雙方 count 序列；t=0 只有守方還擊 | Headless |
| AC-V4-04 | 敵單位殲滅後 → 目標格空但敵 claim → 下 tick 花 1 兵變 NEUTRAL → 再下 tick 花 1 兵變己方 claim（claim-only，攻方留 from） | Headless：斷言 lastClaimedFaction 兩段轉移、from.count 各 -1 |
| AC-V4-05 | 中立空格 / 野怪清空後 → 直接 1 兵攻佔（無破壞步驟） | Headless |
| AC-V4-06 | claim-only：攻佔後 `to.occupants === []`、`derivedOwner(to)===faction`、`from` 駐軍仍在 | Headless |
| AC-V4-07 | staging 駐軍被還擊打光 → 對應 AttackOrder 自動移除、不再推進 | Headless |
| AC-V4-08 | 逐格擴張：capture 邊界格 → 該空己方格變 passable → 可再把兵移過去攻下一格 | Headless |
| AC-V4-09 | NEUTRAL 野怪不還擊（單方面被砍） | Headless |
| AC-V4-10 | 派遣到己方空 claim 格 / 己方駐軍格 → 普通移動、部隊實際移入（非 siege） | Headless |

（self-replicate AC-V2-29、walk-through claim AC-V2-30、tier AC-V2-04/05、idle/scripted AC-V2-20/21、勝負 AC-V2-12/25/27 等**維持**。）

## 8. 受影響檔案（實作範圍預估）

| 檔案 | 動作 |
| ---- | ---- |
| `engine/types.ts` | +`AttackOrder`、`GameState.attackOrders`；-`combatStartTick` |
| `engine/state.ts` | `derivedOwner` 不變；passable helper 改為「own-claimed only」；移除同格 `isContested` 戰鬥語意（保留或刪） |
| `engine/movement.ts` | BFS passable 改 own-only；`advanceMarching` 改為「移入己方格 or 建立 AttackOrder」；移除 force-join / 同格抽 defender |
| `engine/combat.ts` | 整檔重寫為 `resolveOrders(state)`：跑 AttackOrder（保留 `stageDamage`） |
| `engine/tick.ts` | step order 串新 combat |
| `engine/victory.ts` | defeats 時清掉該 faction 的 AttackOrder |
| `engine/*.test.ts` | combat / movement / tick / integration 測試大改；補 AC-V4-* |
| `playtest/*`, `scenarios/*` | scenario 若帶舊 occupant fixture 需調整 |

> 渲染 / 輸入 / UI 層（M2+）尚未接這套，本草案只動 engine + PRD + 測試。

---

## 9. 待確認清單（給使用者）

1. §1 表格 D1–D9 是否同意？特別是 **D1（攻佔/破壞永久消耗兵力）** 與 **D3（攻方 t=0 不輸出）**。
2. `Occupant.isDefender` 欄位是保留（少改 fixture）還是一併移除？
3. 這版要不要連 **AI**（`stepAi`）一起改成會下 AttackOrder，還是維持 idle（AI 仍 deferred）？
4. 確認後我就：folding 進 `PRD.md` bump v1.4 → 切 / 確認 feature branch → TDD（先寫 AC-V4-* 測試）→ 實作 → typecheck / test / playtest 三綠。
