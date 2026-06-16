# CLAUDE.md — Knight Strike

## 1. 專案概要

Knight Strike 是日本 2005 年免費小品《国家大作戦》(lm_exp) 的 web 重製版：45° 斜俯視像素風、即時 tick（2s / tick）格狀戰棋，主城產兵 → 派駐升級 → 佔領敵方主城獲勝。**規格的單一真相來源是 [`docs/PRD.md`](docs/PRD.md)（目前版本 v1.2）**，本文件只負責 coding conventions、工具鏈、工作流；任何玩法 / 數值 / 規則的疑問都回去查 PRD。

## 2. 技術棧與版本

| 項目         | 選擇                                         | 備註                                              |
| ------------ | -------------------------------------------- | ------------------------------------------------- |
| Node         | **22 LTS**（鎖定於 `.nvmrc` 與 `engines.node`） | Vite 8 不支援 Node 18                             |
| 套件管理     | pnpm                                         | 不要混用 npm/yarn                                 |
| 編譯         | Vite                                         | dev server + production build                     |
| 語言         | TypeScript（strict + 額外旗標，見 §4）       |                                                   |
| 渲染         | Pixi.js v8                                   | 2D sprite + iso 投影；PRD §1 說明選型理由         |
| 動畫         | GSAP                                         | tween 引擎，驅動 Pixi 物件                        |
| 測試         | vitest（含 UI / coverage / watch-default）   | 詳見 §5                                           |
| Lint/Format  | ESLint + Prettier                            | 詳見 §6                                           |
| Pre-commit   | lefthook                                     | commit 前自動 lint + typecheck                    |

### 明確禁止（拒絕引入）

- **不用 React / Vue / Svelte / Solid 或任何 UI 框架**。HUD、Faction Panel、Tile Info、End Screen 一律用 Pixi 或原生 DOM 寫；複雜度不到需要框架。
- **不用 lodash / underscore / moment / dayjs / date-fns 等大型 utility 庫**。需要的小工具自己在 `src/engine/util/` 寫。
- **不用 jQuery**。
- **不用 Immer**（state 不可變靠手動 spread / structural copy；理由：headless playtest 跑 100 場時 proxy 成本非零，且 engine 模組 surface 已切細，手寫成本可控）。
- **不用 localStorage / IndexedDB / cookie**（存檔列入 PRD §8 future scope，MVP 不做）。
- **不引入大型 state 管理庫**（Redux / Zustand / MobX）。Engine 層自己管，UI 層用 props / 直接讀 engine state snapshot。

## 3. 檔案結構（與 PRD §9 對齊）

```
knight-strike/
├── docs/
│   └── PRD.md                # 規格單一真相來源
├── public/
│   └── *.png                 # sprite 資源
├── src/
│   ├── engine/               # 【純邏輯層】無 Pixi / DOM / GSAP 依賴
│   │   ├── types.ts          # Faction / Tier / Province / MarchingStack
│   │   ├── state.ts          # GameState、行軍佇列
│   │   ├── tick.ts           # step(state) → state'
│   │   ├── upgrade.ts        # deriveTier(count)
│   │   ├── combat.ts         # computeLoss + adjacency 結算 + stalemate counter
│   │   ├── movement.ts       # BFS 路徑 + marching stack 推進 + 碰撞解析
│   │   ├── production.ts     # 主城產兵
│   │   ├── ai.ts             # AI 狀態機 + RNG shuffle
│   │   ├── victory.ts        # 勝負判定
│   │   └── util/             # rng (seedable)、helpers
│   ├── render/               # 【Pixi 渲染層】
│   │   ├── app.ts            # Pixi Application 初始化 / resize
│   │   ├── board.ts          # 格子 sprite + iso 投影 + 高亮
│   │   ├── units.ts          # 駐紮 stack 渲染 + 升級動畫
│   │   ├── marching.ts       # 行軍 stack 插值動畫
│   │   ├── combat.ts         # bump + tint flash
│   │   └── paths.ts          # 拖曳預覽虛線
│   ├── input/                # 【輸入層】
│   │   ├── pointer.ts        # hit-test、click vs drag、左右鍵分流
│   │   ├── keyboard.ts       # Space / 1 / 2 / R / Esc / WASD
│   │   └── dispatch.ts       # 拖曳派遣手勢狀態機
│   ├── ui/                   # 【UI 面板層】原生 DOM 或 Pixi text
│   │   ├── hud.ts            # tick bar + 速度
│   │   ├── faction-panel.ts
│   │   ├── tile-info.ts
│   │   └── end-screen.ts
│   ├── playtest/             # 【Headless 測試層】跑在 Node
│   │   ├── cli.ts            # pnpm playtest 入口
│   │   ├── runner.ts         # scenario → result
│   │   └── integration.test.ts
│   ├── scenarios/            # 預設場景 JSON / TS
│   │   └── default.ts        # 11x11 預設開局
│   ├── assets/               # sprite 索引
│   └── main.ts               # 入口：建 engine + renderer + 接 UI
├── CLAUDE.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── biome.json (不用)         # 用 ESLint + Prettier 取代
├── .eslintrc.cjs
├── .prettierrc.json
├── lefthook.yml
├── .nvmrc
└── index.html
```

### 🚨 架構鐵則（違反 = 拒絕該 PR）

**`src/engine/**` 不得 import 任何下列模組**：
- `pixi.js` / `@pixi/*`
- `gsap`
- `src/render/**`、`src/input/**`、`src/ui/**`
- DOM API（`document`、`window`、`HTMLElement`、`MouseEvent`...）
- 任何 vite 專屬 import（`?raw`、`?url` 等）

**理由**：engine 必須能在 Node headless 跑（`pnpm playtest`、vitest 整合測試、CI balance run）。一旦 engine 沾到 Pixi 或 DOM，headless 測試就死。

**強制機制**：
- ESLint rule `no-restricted-imports` 設定 engine 目錄禁止以上 import patterns（見 `.eslintrc.cjs`）。
- PR review 時用 `rg "from ['\"](pixi|gsap)" src/engine/` 必須無命中。

## 4. Coding Conventions

### 4.1 TypeScript

`tsconfig.json` 開啟：

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Vite 端 `vite.config.ts` 與 vitest 端 `vitest.config.ts` 都要設一致的 `@/` alias。

### 4.2 Engine 層：純函數優先

- Engine 所有公開 API 收 `state`、回**新** `state`，**不 mutate** 輸入。
- Helper 內部可以用 mutable 區域變數（最後組成新物件回傳），但不可寫回參數物件。
- 範例簽名：

  ```ts
  export function step(state: GameState): GameState { ... }
  export function dispatch(state: GameState, cmd: DispatchCommand): GameState { ... }
  export function deriveTier(count: number): Tier { ... }
  ```

- 用 `readonly` 標記型別欄位，靠 TS 在編譯期擋 mutation：

  ```ts
  type Province = {
    readonly id: TileId;
    readonly owner: FactionId;
    readonly count: number;
    readonly isCastle: boolean;
  };
  ```

### 4.3 型別風格

- **不用 `enum`**，用 string literal union：

  ```ts
  type FactionId = "TOKUGAWA" | "TAKEDA" | "ODA" | "UESUGI" | "NEUTRAL";
  type Tier      = "SOLDIER" | "KNIGHT" | "QUEEN" | "KING";
  ```

- **不用 `class`**（除非 Pixi / GSAP API 強制），用 `function` + `interface` / `type`。

### 4.4 命名

| 對象             | 規則                | 範例                                   |
| ---------------- | ------------------- | -------------------------------------- |
| function / var   | camelCase           | `deriveTier`、`computeLoss`            |
| type / interface | PascalCase          | `GameState`、`MarchingStack`           |
| **真**常數       | UPPER_SNAKE         | `TICK_INTERVAL_MS = 2000`              |
| 變數值常數       | camelCase           | `defaultBoardSize = 11`                |
| 檔名             | kebab-case.ts       | `faction-panel.ts`、`derive-tier.ts`   |
| Test 檔          | `<name>.test.ts`    | `combat.test.ts` 與 `combat.ts` 同目錄 |

### 4.5 Import

- 從 `src/` 起算的路徑一律用 `@/` alias：`import { deriveTier } from "@/engine/upgrade";`
- 同層或往下走的相對 import 可用 `./xxx`、`./util/yyy`。
- **不准** `../../../xxx` 跨多層往上的相對 import — 改用 `@/`。

### 4.6 註解

- **預設不寫註解**。命名清楚的程式碼自說明。
- **只寫 why**（為何這樣設計、隱含限制、踩過的雷）；**不寫 what**（程式碼自己會說）。
- 不寫「`// TODO: 之後加 X 功能`」這類腐爛註解。要做的事開 issue 或寫進 PRD §8。
- 不寫「`// 本函數由 Claude 生成`」「`// 修 issue #42`」這類 metadata — PR description / git log 才是它們的家。

## 5. 測試規範

### 5.1 Engine 層

- **每個 engine 模組對應一份 `*.test.ts`，同目錄存放**：
  ```
  src/engine/upgrade.ts
  src/engine/upgrade.test.ts
  src/engine/combat.ts
  src/engine/combat.test.ts
  ...
  ```
- 純函數模組（`upgrade` / `combat` / `production` / `movement` 中的 BFS）**目標 line coverage ≥ 90%**。
- `pnpm test:coverage` 產出報告，未達標 PR review 退件。

### 5.2 AC 對應

下列 AC **必須**各對應至少一個 vitest case，`it()` 描述以 `[AC-XX]` 開頭：

| AC     | 對應模組          | 範例                                                          |
| ------ | ----------------- | ------------------------------------------------------------- |
| AC-04  | upgrade           | `it("[AC-04] count=5 → KNIGHT, 15 → QUEEN, 30 → KING", ...)` |
| AC-05  | upgrade           | `it("[AC-05] count drops below threshold → tier downgrades")` |
| AC-08  | combat            | `it("[AC-08] 10 Soldier vs 5 Knight: loss=4 vs 1, tier→Soldier")` |
| AC-15  | ai (integration)  | `it("[AC-15] each AI captures ≥1 adjacent tile within 30 ticks")` |
| AC-17  | movement          | `it("[AC-17] enemy marching head-on uses §3.6 formula")`       |
| AC-18  | movement          | `it("[AC-18] path cut: marching halts adjacent, fights next tick")` |
| AC-19  | combat (stalemate) | `it("[AC-19] 3v3 stalemate drains from tick 5")`              |
| AC-20  | movement          | `it("[AC-20] same-faction merge: shorter remaining path wins")` |
| AC-21  | movement          | `it("[AC-21] enemy head-on non-terminus: survivor continues")` |
| AC-22  | ai                | `it("[AC-22] same seed → deterministic; different seed → diverges")` |

### 5.3 整合測試

- 跑完整 tick 流程的整合測試放 `src/playtest/integration.test.ts`。
- 使用 `src/playtest/runner.ts` 提供的 `runScenario(scenario, ticks)` API；可重用 CLI 的 runner 邏輯。

### 5.4 Render / Input / UI 層

- **不強制**單元測試（DOM / Pixi 互動 mock 成本高、回報率低）。
- 靠 **manual smoke**（§8 工作流）+ **`/run` skill** 跑實機驗證。
- 若某 input 純邏輯（如 `pointer.ts` 的 click vs drag 判斷），可選擇性寫 unit test。

## 6. 執行指令

`package.json` `scripts` 對應如下。**每條指令的「何時用」標在右欄**。

| 指令                                | 何時用                                                              |
| ----------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev`                          | 本機開發；Vite dev server (port 5173)，HMR 即時刷新                 |
| `pnpm build`                        | 產出 `dist/` 給 production；發布前必跑                              |
| `pnpm preview`                      | 在本機跑 `pnpm build` 產物，模擬 production 行為                    |
| `pnpm test`                         | **預設 watch mode**；coding 時開著                                  |
| `pnpm test:run`                     | 跑一次後結束（CI / 手動驗證用）                                     |
| `pnpm test:watch`                   | 顯式 watch（與 `pnpm test` 等效，留作習慣語意）                     |
| `pnpm test:ui`                      | 開瀏覽器 vitest UI；看 state diff / snapshot 差異                   |
| `pnpm test:coverage`                | 出 coverage 報告；milestone 完成前跑、檢查 engine ≥ 90%             |
| `pnpm playtest <scenario.json>`     | 跑單場 headless；scenario 路徑必填、無預設                          |
| `pnpm playtest <s.json> --runs 100` | balance / 回歸測試                                                  |
| `pnpm lint`                         | ESLint + Prettier check（**不**自動 fix）；PR 前必跑                |
| `pnpm format`                       | Prettier write；commit 前手動跑或 lefthook 代勞                    |
| `pnpm typecheck`                    | `tsc --noEmit`；milestone 完成前必跑                                |

**milestone 完成的判定 = `pnpm test:run` + `pnpm typecheck` + `pnpm playtest src/scenarios/default.json --runs 10` 三條全綠**。

## 7. Git 規範

### 7.1 Branch 命名

格式：`feature/<milestone>-<short-desc>`

Milestone 列表（與 PRD §9 分層對齊）：

| Milestone           | 範圍                                                       |
| ------------------- | ---------------------------------------------------------- |
| `M1-engine-core`    | engine 全層（state / tick / combat / upgrade / movement / production / victory / ai）+ 單元測試 |
| `M2-pixi-render`    | Pixi app + board + units 渲染；移除 Three.js 相依          |
| `M3-input-dispatch` | pointer / keyboard / dispatch 手勢                         |
| `M4-ai`             | AI 整合進 engine（含 RNG shuffle）+ AC-15 / AC-22          |
| `M5-ui-endscreen`   | HUD / faction panel / tile info / end screen               |
| `M6-headless-playtest` | playtest CLI + scenario JSON loader + balance script    |

範例 branch：`feature/M1-engine-core-combat-formula`、`feature/M3-input-dispatch-drag-gesture`。

### 7.2 Commit Message

遵循 [Conventional Commits](https://www.conventionalcommits.org/) v1.0。

- **格式**：`<type>(<scope>)?: <subject>`
- **Subject 英文、imperative mood、≤ 50 characters、句尾不加句點**。
- **常用 type**：`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `build` / `ci` / `perf` / `style`
- **常用 scope**：`prd`（PRD 改動）、`engine` / `render` / `input` / `ui` / `playtest` / `ai` / `combat` / `movement` / `upgrade` 等模組名；scope 可省略（全域改動如根層 config）
- **範例**：
  - `feat(engine): implement deriveTier with threshold tests`
  - `fix(movement): correct BFS termination on enemy tile`
  - `test(combat): add AC-08 vitest case`
  - `docs(prd): v0.4 fix scenarios, AC-19, rule details`
  - `refactor(engine): split combat into resolve and apply`
  - `chore(deps): remove three.js after M2 migration`
- **Body**（可選）：空一行後寫，每行 ≤ 72 chars；解釋 why 而非 what；可引用 AC 編號 / PRD 章節。
- **Breaking change**：subject 後加 `!`，例：`feat(engine)!: rename Province to Tile`；body 補 `BREAKING CHANGE: ...` footer。
- 一個 commit 一件事。`wip` / `update` / `fix bug` 等資訊為零的訊息 = review 退件。

### 7.3 PR

- **一個 milestone 一個 PR**（不准在 `M1` 的 PR 裡偷塞 `M2` 的東西）。
- PR description 必含：
  1. **對應 milestone**（M1 / M2 / ...）
  2. **覆蓋的 AC 編號列表**（例：`AC-04, AC-05, AC-08, AC-19, AC-20, AC-21`）
  3. **Manual 驗證步驟**（步驟條列，含預期結果；§5.4 提到的 render/UI 測試也寫這裡）
  4. **已知遺留**（PRD §8 future scope 中本 PR 沒做的）

## 8. 開發工作流（給未來的 Claude Code session 看）

### 8.1 動工前

1. **讀 `docs/PRD.md` 對應章節**。本文件不重述規格，只列規範。
2. 確認當前 branch 是 `feature/M<N>-...`。若在 `master` 直接動 = 退回切 branch。
3. `pnpm install` + `pnpm test` 跑起來確認基準綠。

### 8.2 改 Engine 層 = TDD

- **改 engine 前先寫 / 更新測試**：先讓 test fail，再寫 code 讓它過。
- 不寫 test 就改 engine 公開 API = PR review 退件。

### 8.3 改 PRD = 先問

- PRD 是契約。**改規格、改數值、改公式前必須先跟使用者確認**。不要在 PR 裡夾帶 PRD 改動。
- 若 implement 過程發現 PRD 不夠精確 → 停下來，回頭跟使用者對齊，更新 PRD，bump 版本號，再回來寫 code。

### 8.4 Milestone 完成檢查清單

- [ ] `pnpm test:run` 全綠
- [ ] `pnpm typecheck` 全綠
- [ ] `pnpm lint` 全綠
- [ ] `pnpm playtest src/scenarios/default.json --runs 10` 跑完無 crash、輸出合理勝率
- [ ] `pnpm test:coverage` engine line coverage ≥ 90%
- [ ] 用 `/run` skill 啟動 dev server，瀏覽器肉眼跑通本 milestone 對應的 manual 驗證步驟
- [ ] 用 `/verify` skill 端到端跑一次

### 8.5 遇到不確定 = 停下來問

PRD 沒寫的設計決策（命名、檔案切分粒度、特定 edge case 行為）**不要自己編**。用 `AskUserQuestion` 問清楚，問完寫入 PRD 或本文件對應段落。

## 9. 已知技術債 / 注意事項

### 9.1 既有 scaffolding 將被重寫

下列既有檔案會在 M1 / M2 完整重寫，但**型別概念保留**（`Faction` / `FactionId` / `Province` 等遷入 `src/engine/types.ts`）：

```
src/main.ts
src/game/state.ts, faction.ts, province.ts
src/map/index.ts, block.ts
src/unit/index.ts, knight.ts
src/manager/scene.ts, unit.ts, input.ts, asset.ts
src/event/*.ts
src/namedMap/first.ts
```

不要花時間「修」這些檔案 — 直接照新結構（§3）重寫。

### 9.2 Three.js 移除時機

- **Three.js 與 `@types/three` 在 M2 早期移除**（隨 Pixi.js 接管渲染層）。
- 移除前不要動既有 Three.js 相關 import — 留到一次性清掉，避免 cherry-pick 衝突。
- 移除步驟：(a) 確認 `src/render/**` 完整接手；(b) 刪 `src/manager/*.ts`；(c) `pnpm remove three @types/three`；(d) 一次 commit。

### 9.3 Node 18 → 22 遷移

- 開發機目前可能跑 Node 18（PRD 撰寫時環境為 v18.20.8）。
- M1 開工前必須切到 Node 22（`nvm use` 會讀 `.nvmrc`）。
- Vite 8 在 Node 18 直接會 fail，沒救濟空間。

## 10. Skills 與工具

本專案實際會用到的 Claude Code skills（**僅列當前可用者**）：

| Skill          | 何時用                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| `/run`         | 啟動 dev server（`pnpm dev`）並在瀏覽器自動跑通本 milestone 對應的驗證流程；milestone 完成檢查清單最後一步 |
| `/verify`      | PR 階段端到端驗證；確認 manual 驗證步驟在 reviewer 機器上也跑得起來    |
| `/code-review` | PR 自審；low/medium 跑高信度 finding，high 含不確定項                  |
| `/security-review` | 雖然是 client-only game，發布前掃一次 input handling / sprite asset 路徑等 |

> **`/goal` 不在當前可用 skill 清單**（你之前提過要列）。要用要先 publish 一個本專案 plugin、或直接呼叫 `Agent` 工具的 `Plan` subagent。本文件先不列。

### 工具備忘

- **`AskUserQuestion`**：PRD 沒寫的決策、命名選擇、行為歧義一律問，不要自己編。
- **`Agent` (Explore subagent)**：跨多檔搜尋實作位置或對齊既有 pattern 時用；單檔知道目標就 `Read` / `Grep`。
- **`/loop`**：跑 `pnpm playtest --runs 100` 等耗時動作可放 background 但**不要 polling sleep**。
