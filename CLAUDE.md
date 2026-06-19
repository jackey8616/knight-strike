# CLAUDE.md — Knight Strike

## 1. 專案概要

Knight Strike 是日本 2005 年免費小品《国家大作戦》(lm_exp) 的 web 重製版：45° 斜俯視像素風、即時 tick（2s / tick）格狀戰棋，領地自然成長 → 拖曳派駐 / 征服行軍 → 佔領敵方主城獲勝。**規格的單一真相來源是 [`docs/PRD.md`](docs/PRD.md)（目前版本 v2.8）**，本文件只負責 coding conventions、工具鏈、工作流；任何玩法 / 數值 / 規則的疑問都回去查 PRD。

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
- **不用 localStorage / IndexedDB / cookie**（存檔列入 PRD §9 future scope，MVP 不做）。
- **不引入大型 state 管理庫**（Redux / Zustand / MobX）。Engine 層自己管，UI 層用 props / 直接讀 engine state snapshot。

## 3. 檔案結構與實作對應（工程細節單一真相）

> 本節是**工程細節的單一真相**：檔案結構、模組職責、與「PRD 規格 → 模組 / 函式」對應（見樹狀註解的 `PRD §x` 標註）。PRD 只描述產品設計（玩法 / 規則 / 數值），不重述實作；spec 數值改動時這裡只引用 PRD 章節、不複製數字。

```
knight-strike/
├── docs/
│   ├── PRD.md                # 規格單一真相來源（v2.0）
│   └── MILESTONES.md         # 交付 milestone × AC 對照
├── public/
│   └── knight.png            # sprite 資源
├── src/
│   ├── engine/               # 【純邏輯層】無 Pixi / DOM / GSAP 依賴
│   │   ├── types.ts          # FactionId / Tier / Terrain / Province（含 House 旗標）/ Occupant / MarchingStack / AttackOrder / AiMode / FactionEconomy / GameState（含 economy）
│   │   ├── state.ts          # derivedOwner / isOwnClaimed / findOccupant
│   │   ├── tick.ts           # step()：每 tick 結算順序（含經濟日）（PRD §4.2）
│   │   ├── upgrade.ts        # deriveTier()：兵力→tier（PRD §4.4）
│   │   ├── economy.ts        # buildHouse / growPopulation / collectTax / spawnFromHouses / setTaxPct / razeHouseAt / makeEconomy + 經濟常數（PRD §4.3）
│   │   ├── combat.ts         # resolveOrders()：cross-edge 戰鬥 + break→capture + 攻佔房屋夷平（PRD §4.6 / §4.3）
│   │   ├── movement.ts       # findPath / dispatch / garrison（export，供房屋產兵）/ advanceMarching / cancelMarchingStack（PRD §4.5）
│   │   ├── terrain.ts        # generateTerrain / coastOceanMask / 不可通行 / 減傷（PRD §4.7）
│   │   ├── ai.ts             # stepAi()：規則狀態機（含建造房屋）（PRD §5）
│   │   ├── ai-profile.ts     # RULE_PROFILES：難度旋鈕（PRD §5.3）
│   │   ├── victory.ts        # applyDefeats / evaluateOutcome（PRD §7）
│   │   └── util/             # rng (seedable)、helpers
│   ├── render/               # 【Pixi 渲染層】
│   │   ├── app.ts            # Pixi Application 初始化 / resize
│   │   ├── board.ts          # 格子 + iso 投影 + 起伏地表 + 地形紋理頂面 + 山堆疊 + 領地罩染 + 地圖外形懸崖/海環 + 高亮
│   │   ├── terrain-theme.ts  # 地形調色盤 + shade()（board / terrain-texture 共用真相，無 Pixi）
│   │   ├── terrain-texture.ts # 地形頂面 dithered 菱形貼圖生成（PRD §6.1）
│   │   ├── terrain-height.ts # 滾動高度場（value noise，board / units 共用，PRD §6.1）
│   │   ├── units.ts          # 駐紮 stack 渲染 + 升級動畫
│   │   ├── marching.ts       # 行軍 stack 插值動畫
│   │   ├── combat.ts         # bump + tint flash
│   │   ├── paths.ts          # 拖曳預覽虛線
│   │   └── sprites.ts        # tier texture 生成
│   ├── input/                # 【輸入層】
│   │   ├── pointer.ts        # hit-test、click vs drag、左右鍵分流、按壓 auto-pause
│   │   ├── keyboard.ts       # Space / 1-4 / R / Esc / WASD
│   │   ├── camera.ts         # wheel zoom + 觸控 pinch / pan
│   │   └── dispatch.ts       # 拖曳派遣手勢狀態機 + 比例滑桿
│   ├── ui/                   # 【UI 面板層】原生 DOM
│   │   ├── hud.ts            # tick bar + 速度
│   │   ├── faction-panel.ts
│   │   ├── tile-info.ts
│   │   ├── start-menu.ts     # 開場選單：玩法說明 + AI 難度 + 棋盤尺寸 + 地圖外形（PRD §6.2.1）
│   │   ├── end-screen.ts     # 勝負畫面 + Restart / Main Menu（PRD §6.2.2）
│   │   └── responsive.ts     # 窄螢幕重排
│   ├── playtest/             # 【Headless 測試層】跑在 Node
│   │   ├── cli.ts            # pnpm playtest 入口
│   │   ├── runner.ts         # scenario → result
│   │   └── integration.test.ts
│   ├── scenarios/            # 場景 JSON / TS（default / idle-target / spectator-4ai…）
│   │   └── sized.ts          # 程序產生預設可玩開局（11/15/19/27 × 難度，Start Menu 用）
│   └── main.ts               # 入口：建 engine + renderer + 接 UI
├── CLAUDE.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc.json
├── lefthook.yml
├── .nvmrc
├── index.html
└── .github/workflows/        # ci.yml（CI gate）+ deploy.yml（Pages）
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
- ESLint rule `no-restricted-imports` 設定 engine 目錄禁止以上 import patterns（見 `eslint.config.js`）。
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
  export function produce(state: GameState): GameState { ... }
  export function deriveTier(count: number): Tier { ... }
  ```

- 用 `readonly` 標記型別欄位，靠 TS 在編譯期擋 mutation：

  ```ts
  type Province = {
    readonly id: TileId;
    readonly isCastle: boolean;
    readonly castleOwner: FactionId | null;
    readonly occupants: readonly Occupant[];
    readonly lastClaimedFaction: FactionId | null;
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
| function / var   | camelCase           | `deriveTier`、`stageDamage`            |
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
- 不寫「`// TODO: 之後加 X 功能`」這類腐爛註解。要做的事開 issue 或寫進 PRD §9。
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

PRD §8 是所有 AC（內容、編號）的單一真相。規範：

- **每條 engine AC** → 對應模組至少一個 `it("[AC-XX] …")` vitest case（與模組同目錄）。
- **UI AC** → §8 工作流的 manual smoke 驗。
- 不在此重列各 AC 內容，避免與 PRD 漂移。

模組 → AC 對照（AC 內容查 PRD §8）：

- `economy`（PRD §4.3）→ AC-03 / 27 / 28 / 29 / 30 / 31
- `upgrade`（§4.4）→ AC-04
- `movement`（§4.5）→ AC-05 / 07 / 08 / 09 / 14 / 15
- `combat`（§4.6 / §4.3）→ AC-10 / 11 / 12 / 13 / 31（攻佔房屋夷平）
- `terrain`（§4.7）→ AC-16 / 17
- `ai`（§5）→ AC-18 / 19 / 20 / 21（含建房 §5.2）
- `victory`（§7）→ AC-22
- render / input / ui → AC-01 / 02 / 06 / 23 / 24

### 5.3 整合測試

- 跑完整 tick 流程的整合測試放 `src/playtest/integration.test.ts`。
- 使用 `src/playtest/runner.ts` 提供的 `runScenario(scenario, ticks)` API；可重用 CLI 的 runner 邏輯。

### 5.4 Render / Input / UI 層

- **不強制**單元測試（DOM / Pixi 互動 mock 成本高、回報率低）。
- 靠 **manual smoke**（§8 工作流）+ **`/run` skill** 跑實機驗證。
- 若某 input 純邏輯（如 `pointer.ts` 的 click vs drag 判斷），可選擇性寫 unit test。
- **動到 UI shell（`start-menu` / `end-screen` / `main.ts` teardown-rebuild），或任何會影響 menu→game→end→restart→main-menu 流程的改動 → push / 開 PR 前先跑 `pnpm smoke`**（zero-dep headless 瀏覽器端到端，須 exit 0）。框架見 `scripts/smoke/`；CI 為 manual-only（`.github/workflows/smoke.yml`），不會自動擋 PR，所以這條靠自律。

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
| `pnpm balance`                      | AI 平衡守門：固定 4-AI 批次，失衡即 fail（CI gate 一步）            |
| `pnpm smoke`                        | 無依賴 headless 瀏覽器 smoke（CDP 驅動 Chrome 跑 menu→game→end→restart）；UI shell 改動後手動驗，CI 為 manual-only（`scripts/smoke/`、`.github/workflows/smoke.yml`） |
| `pnpm lint`                         | ESLint + Prettier check（**不**自動 fix）；PR 前必跑                |
| `pnpm format`                       | Prettier write；commit 前手動跑或 lefthook 代勞                    |
| `pnpm typecheck`                    | `tsc --noEmit`；milestone 完成前必跑                                |

**milestone 完成的判定 = `pnpm typecheck` + `pnpm lint` + `pnpm test:run` + `pnpm playtest src/scenarios/default.json --runs 10` 全綠（與 `.github/workflows/ci.yml` CI gate 一致）**。

## 7. Git 規範

### 7.1 Branch 命名

格式：`feature/<milestone>-<short-desc>`

Milestone 列表（與 [`MILESTONES.md`](docs/MILESTONES.md) 對齊）：

| Milestone              | 範圍                                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `M1-engine-core`       | engine 全層（types / state / tick / upgrade / production / combat / movement / terrain / victory / ai）+ 單元測試 |
| `M2-render-ui`         | render + input + ui（board / units / marching、pointer / keyboard / camera / dispatch、HUD / panels / end screen） |
| `M3-headless-playtest` | playtest CLI + scenario loader + 整合測試                                                                        |
| `M4-build-deploy`      | sprite 資產 + `pnpm build` + GitHub Pages（CI gate）                                                             |

範例 branch：`feature/M1-engine-core-combat-formula`、`feature/M2-render-ui-dispatch-gesture`。

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
- **合併 PR 一律用 squash merge**（`gh pr merge --squash`）：一個 PR 收斂成 `main` 上的單一 commit，保持線性歷史。不要用 merge commit 或 rebase merge。
- PR description 必含：
  1. **對應 milestone**（M1 / M2 / ...）
  2. **覆蓋的 AC 編號列表**（例：`AC-04, AC-05, AC-08, AC-19, AC-20, AC-21`）
  3. **Manual 驗證步驟**（步驟條列，含預期結果；§5.4 提到的 render/UI 測試也寫這裡）
  4. **已知遺留**（PRD §9 future scope 中本 PR 沒做的）

## 8. 開發工作流（給未來的 Claude Code session 看）

### 8.1 動工前

1. **讀 `docs/PRD.md` 對應章節**。本文件不重述規格，只列規範。
2. 確認當前 branch 是 `feature/M<N>-...`。若在 `main` 直接動 = 退回切 branch。
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
- [ ] **若本次動到 UI shell / `main.ts` 生命週期 → `pnpm smoke` 通過（exit 0）**（§5.4）

### 8.5 遇到不確定 = 停下來問

PRD 沒寫的設計決策（命名、檔案切分粒度、特定 edge case 行為）**不要自己編**。用 `AskUserQuestion` 問清楚，問完寫入 PRD 或本文件對應段落。

## 9. 注意事項（環境 / 流程須知）

> 重製主體已完成、無遺留技術債；以下純為環境與流程須知。被取代的舊設計（scaffolding、Three.js、舊戰鬥 / AI 模型）見 git log 與 PRD changelog 指向的 `archive/*` 標籤。

- **Node 版本**：`.nvmrc` / `engines.node` 鎖 Node 22；`pnpm build`（Vite 8）在 Node 18 會 fail。`typecheck` / `test` / `lint` 在 Node 18 仍可跑，但發布前務必 `nvm use` 切 22。
- **CI gate**：`.github/workflows/ci.yml` 在 PR 跑 typecheck / lint / test / build；`deploy.yml`（GitHub Pages）依賴 CI 通過後才推。

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
