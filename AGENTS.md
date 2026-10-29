# AGENTS.md — 开发与协作指南

> 面向 AI coding agent 与人类维护者的开发/协作指南。开始改动前请先读完本文件；产品功能、安装使用与仓库结构概览见 [README.md](./README.md)。
>

## 1. 项目定位

**dsh-devbench-plugin**（DSH DevBench，原名 `dsh-requirements-plugin`）是 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）的两端插件，以 DSH workspace 为项目来源，聚合需求、Git 提交、AI 提交、代码评审、工作树、后台任务与周报。

Package identity history: `dsh-requirements-plugin` -> `dsh-workbench-plugin` -> `dsh-devbench-plugin`.

- **Host 半侧**（Node.js，运行在 DSH 插件进程内）：HTTP JSON API、6 个 Agent 工具、Git/文件系统操作、后台任务与持久化。
- **Client 半侧**（浏览器）：通过 DSH 的 `__ModuleLoader__` 与 slots 机制注册侧边栏入口、工作台主面板、会话头部操作和全部界面。
- 两侧只通过 HTTP（`/dsh-devbench/api`）与 `src/shared/protocol.js` 通信；Client 不 import 任何 Host 模块。
- 插件零运行态依赖（无 `dependencies`）；浏览器 bundle 只 external `react`。Node ≥ 20.18.1（CI 用 24），DSH `>=0.2.1-rc.3 <0.3.0-0`。

## 2. 常用命令

| 命令 | 作用 | 说明 / 何时用 |
| --- | --- | --- |
| `npm ci` | 安装开发依赖 | 克隆后第一步；会自动执行 `prepare`（等价一次 build） |
| `npm run build` | esbuild 构建浏览器 bundle → `dist/client.js` | 改了 `src/client/**` 或 `src/shared/**` 必须重跑；产物 gitignore，不提交 |
| `npm run lint` | ESLint：语法 + 分层依赖规则 | 越界 import 会给出中文提示；修复方式是移动代码 |
| `npm run lint:fix` | 自动修复可修复的 lint 问题 | 修完再跑 `npm run lint` 确认 |
| `npm run messages:check` | 校验 Host 文案目录 | 缺 key / 有未使用 key / `messages/index.js` 漂移都会报；`-- --write` 重新生成索引 |
| `npm test` | `pretest` 先 build，再跑 `test/host/*` + `test/client/*` | 单文件：`node --test test/host/<name>.test.js`；Client 用例依赖 `dist/client.js` |
| `npm run check` | `lint` + `messages:check` + `test`（含 build） | **提交前必跑**；与 CI 常规门禁一致 |
| `npm run verify:publish` | `release:preflight` 的别名 | 发布就绪自检 |
| `npm run release:preflight` | 发布检查：包身份 / DSH 清单 / exports / bundle 契约 / tarball 内容 | `-- --registry-check` 查版本占用；`-- --publish` 检查发布态；`prepack`/`prepublishOnly` 生命周期也会自动跑 |
| `npm run release:pack` | build → preflight → `npm pack` → 写 `dist/release/manifest.json` | 会先清空 `dist/release/`，防止误发旧包；产物为 `*.tgz` + 校验清单 |
| `npm run release:smoke` | 用真实 DSH CLI 在临时 `DSH_HOME` 安装/卸载 tarball | `-- --tarball <path>`、`-- --cli <path>`、`-- --keep`；不碰真实 `~/.dsh` |
| `npm run release:publish` | 默认 dry-run；`-- --yes` 才发布到 npm 并创建本地 `v<version>` tag | `-- --tag next` 预发布、`-- --registry <url>` 私有 registry、`-- --no-tag` |
| `npm run release:catalog` | 生成 DSH 插件市场索引（format 1）`dist/catalog/index.json` | 发布后从 npm 读取真实版本；未发布预览用 `-- --local`，校验用 `-- --check` |

- `npm test` 自带构建，所以 `npm run check` 实际顺序是：lint → messages → build → tests。
- 不要绕过上述脚本手工执行等价命令；发布链路的所有检查都在 `scripts/` 里，改了脚本要同步跑对应命令验证。

## 3. 目录结构与分层

```
.
├── index.js                  # Host 包入口：re-export src/host/plugin.js 的 inject/apply
├── cordis.patch.yml          # DSH bundle patch：loader id devbench-manager → 包名
├── locale/{zh,en}.json       # DSH 插件页元数据（meta.title/description）
├── icon.svg
├── src/host/                 # Host 半侧（Node.js）
│   ├── plugin.js             # 唯一装配点：HTTP prefix、Agent 工具、重启后任务恢复
│   ├── http/                 # router / routes / body / security（JSON API）
│   ├── tools/                # Agent 工具定义（requirement_*、project_*）
│   ├── services/             # 用例编排：状态聚合、项目、提交/评审/需求任务、工作树、git 操作、检索、周报
│   ├── domain/               # 纯领域规则：需求文档、文件、评审文件、worktree 探测
│   ├── storage/              # config / workspaces / tasks 持久化与损坏检测
│   ├── integrations/git.js   # git 子进程封装（execFile 参数数组、超时、脱敏）
│   ├── platform/open.js      # 系统 / 编辑器打开路径
│   ├── shared/               # 最底层工具：原子写、path-safety
│   ├── prompts/              # 需求/提交/评审提示词渲染与默认模板
│   └── messages/             # Host 中文文案字典（纯数据，由 messages:check 校验）
├── src/client/               # Client 半侧（浏览器 bundle）
│   ├── entry.js              # __ModuleLoader__.load({ id: __PLUGIN_ID__, factory })
│   ├── plugin.js             # 声明 inject、注册 3 个 slot、注册中英文字典
│   ├── runtime.js            # React 绑定（唯一 require('react') 处）、t()、NS/PANEL_ID
│   ├── core/                 # api / async 竞态 / ui-store / navigation / 纯函数
│   ├── i18n/                 # 中英文字典（中英必须同步）
│   ├── ui/                   # 原子组件：common/dialogs/toast/icons/markdown/file-tree/...
│   └── views/                # 顶层视图：requirements-page/home/welcome/settings/link + project/*
├── src/shared/protocol.js    # 跨端协议常量（唯一共享模块，禁止依赖 Node/React/Host/Client）
├── scripts/                  # build-client.mjs、check-messages.cjs、release/、lib/
├── test/host + test/client   # node:test（Host 直调 handleHttp，Client 假 React 渲染）
├── .github/workflows/        # ci.yml（常规检查）、release.yml（v* tag 自动发布）
└── dist/client.js            # 构建产物（gitignore，不可手改）
```

依赖方向严格单向，由 `eslint.config.js`（flat config）强制：

```
host:   plugin → http/tools → services → domain → storage/integrations/platform
                          ↘ shared / prompts / messages / constants / errors
client: entry → plugin → views → ui → core → runtime
                         ↘ src/shared/protocol.js
```

- 每条分层规则都有中文错误提示；越界时移动代码，**不要用 `eslint-disable` 绕过**。
- `src/shared` 只放跨端常量；`i18n` 只放字典；`ui` 不得依赖 `views`；`core` 不得依赖 `ui`/`views`。
- 生效方式：Host 改动重启 DSH；`src/client/**`、`src/shared/**` 改动先 `npm run build` 再刷新/重启；`package.json` 的 `dsh` 字段、`cordis.patch.yml`、`locale/`、`icon.svg` 改动重启生效。
- `dist/client.js` 由 `scripts/build-client.mjs` 从 `src/client/entry.js` 构建（iife、react 外置、注入包名与版本 banner），**永远不要手改**。

## 4. 硬性约束

1. **包名三处一致**：`package.json.name`（`dsh-devbench-plugin`）、`cordis.patch.yml` insert 行的 `name`、bundle 里 `__ModuleLoader__.load({ id })`（由构建从 `package.json.name` 注入）。改包名顺序：`package.json` → `cordis.patch.yml` → `package-lock.json` → `npm run build` → preflight。
2. **稳定标识不得改**（改了会破坏存量用户的安装、路由与数据）：
   - loader id `devbench-manager`（`cordis.patch.yml`）、plugin.js 的 effect 名称与日志前缀 `devbench-manager:*`
   - 路由前缀 `ROUTE_PREFIX = /dsh-devbench` 与 API base `/dsh-devbench/api`
   - 请求头 `REQUEST_HEADER = x-dsh-devbench`
   - 配置目录 `~/.dsh-devbench`（`CONFIG_DIR_NAME`）与项目内元数据目录 `.dsh-devbench`（`META_DIR`）
   - 测试/开发覆盖配置目录用的环境变量 `DSH_DEVBENCH_CONFIG_DIR`（测试大量依赖，改名会连带改测试）
   - Compatibility-only legacy values: `~/.dsh-requirements`, `.dsh-requirements`, `DSH_REQUIREMENTS_CONFIG_DIR`, and `dsh-req/*` branches. They are migration inputs only and must not become current identifiers again.
3. **不手改生成物**：`dist/client.js`（build 产物）、`src/host/messages/index.js`（由 `npm run messages:check -- --write` 生成）。
4. **零运行态依赖**：不新增 `dependencies`；客户端 bundle 只 external `react`，不要随手引入第三方包。确需基座模块时先确认 `dsh.client.inject`/`dsh.client.external` 契约，并跑 preflight。
5. **路径安全**：路径拼接与校验一律走 `src/host/shared/path-safety.js`（realpath、符号链接边界、rootDir/worktreeRoot 内校验）；拒绝 `..`、符号链接穿越和非绝对 rootDir。
6. **子进程安全**：一律 `execFile(cmd, [args])` 参数数组，禁止 shell 拼接/字符串插值；git 网络操作设 `GIT_TERMINAL_PROMPT=0`，错误输出脱敏后再返回。
7. **文案**：Host 文案放 `src/host/messages/`（代码用 `messages.KEY`，`npm run messages:check` 校验）；Client 文案放 `src/client/i18n/`，**中英文必须同时补齐**；`locale/*.json` 是插件页元数据，preflight 会检查 `meta.title/description` 非空。
8. **错误码是契约**：统一 `apiError(status, kebab-case-code, message)`；Client 依赖 `error.code` 分支，不要改已发布的错误码或语义。
9. **数据安全**：用户数据不在仓库内；测试不得写真实 `~/.dsh` 或 `~/.dsh-devbench`；临时目录用 `mkdtemp`，用完清理。

## 5. 测试

```
test/host/    27 个 *.test.js：HTTP API、任务状态机、worktree、git、路径安全、并发、兼容性
  helpers.js         createHarness()：伪造 ctx/webServer/workspaceRegistry/tools + 临时配置目录
  project-helpers.js 临时 git 仓库与项目夹具（makeGitProject/addProject）
  fake-agents.js     后台 Agent 假实现
test/client/  client.test.mjs（纯函数/契约/vm 加载 dist/client.js）、project.test.mjs、
              render-smoke.test.mjs（假 React 渲染虚拟树）
```

- **修 bug 先写复现测试**：先让测试失败，再修复，最后通过。
- Host 新行为覆盖主链路 + 错误分支（断言稳定的 `error.code`）；新 HTTP 接口用 harness 的 `request()` 测。
- Client 新组件/交互加到 `render-smoke.test.mjs`；纯函数、i18n 对齐、bundle 契约（module id、react 外置、factory）加到 `client.test.mjs`。
- **禁止 sleep / 固定延时等待**：用 `waitForTaskStatus`、`waitForBackgroundTask`、`waitForRequirementTask`、`waitForTaskRecovery` 或轮询条件。`node:test` 默认并发执行文件，测试之间不得共享可变全局状态。
- 隔离：每个 harness 用独立 `mkdtemp` 目录并设置 `DSH_DEVBENCH_CONFIG_DIR`；git 测试显式配置 `user.name/user.email`；测试不访问网络。
- 不提交 `dist/`、测试临时目录、绝对路径或凭据。

## 6. 文档策略（重要）

- 仓库只维护两份文档：`README.md`（产品 + 用户手册 + 项目结构）与 `AGENTS.md`（开发协作，本文件）。
- **禁止新增** `docs/` 目录、`CHANGELOG.md`、`CONTRIBUTING.md`、`VERIFICATION.md`，以及设计文档、发布说明、验证记录、变更日志等任何第三份文档。需要解释设计意图时写进提交信息 / PR 描述，或本文件。
- 用户可见行为变化（功能、设置项、数据位置、错误提示、安装方式）**必须同步更新 `README.md`**。
- 版本变化以 git tag（`v*`）记录，**不再维护 CHANGELOG**；`package.json.version` 是唯一版本来源，`package-lock.json` 同步更新。
- 不要在代码、注释或 README 中引用已删除的文档路径；也不要把验证日志、临时分析写成仓库文件。
- README 会被打进 npm tarball（`files[]` 含 `README.md`，preflight 要求必须有）；AGENTS.md 只留在仓库，不随包发布。

## 7. 提交与分支规范

提交信息使用中文 Conventional Commits：`<type>(<scope>): <中文摘要>`

- type：`feat`、`fix`、`refactor`、`perf`、`test`、`docs`、`build`、`ci`、`chore`
- scope：`host`、`client`、`release`、`worktree`、`requirements`、`project`、`docs` 等
- 一个提交只做一件事；重构与功能分开；正文写动机、影响面与验证方式（可选但推荐）
- 提交前必须 `npm run check` 通过

示例：

```
feat(worktree): 工作树列表支持按需求状态过滤
fix(host): 修复任务恢复时 awaiting_confirmation 被错误清理
docs: 重写 README 并补充使用手册
build(release): 移除发布门禁对 CHANGELOG 的依赖
```

分支：从 `main` 拉 `feat/<topic>`、`fix/<topic>`、`docs/<topic>`、`refactor/<topic>`、`release/<version>`；一个分支只做一件事。PR 描述包含：改了什么、为什么、怎么验证、是否有破坏性变更（尤其稳定标识、错误码、配置/数据格式、包名）。

## 8. 发布流程

本地顺序：`npm run check` → `npm run release:preflight` → `npm run release:pack` → `npm run release:smoke` → `npm run release:publish` → `npm run release:catalog`

1. **preflight**：检查包身份（名称/版本/license/description/engines.dsh）、DSH 清单（manifestVersion/patch/exports/files）、bundle 契约（id=包名、`factory(require)`、react 外置、无本地绝对路径、比源码新）、locale/icon、非本地依赖 spec、tarball 内容。`✖` 阻断，`!` 警告需确认。发布态用 `-- --publish`（git 干净、tag 未占用、npm 已登录）。
2. **pack**：自动 build + preflight，清空 `dist/release/` 后 `npm pack`，校验文件清单并写 `manifest.json`（sha256/sha512、git commit、完整文件列表）。tarball 不应包含 `test/`、`docs/`、`scripts/`、`.github/`、`src/client/`。
3. **smoke**：临时 `DSH_HOME` 安装 tarball → 校验 profile 依赖与 `dsh.profile.bundles` → `--dump-config` 中出现 `devbench-manager` 与包名 → 卸载并校验清理；失败会保留临时目录便于排查。
4. **publish**：默认 dry-run 只打印计划；`-- --yes` 才真正发布。流程：重新 build/preflight/pack → `npm publish <tarball> --ignore-scripts` → 对比 registry integrity 与本地 sha512 → 创建 annotated tag `v<version>`。稳定版 `latest`、预发布（版本含 `-`）`next`；不要复用已发布版本，坏了用 `npm deprecate`，不要依赖 unpublish。
5. **catalog**：发布成功后生成 `dist/catalog/index.json`（format 1；版本必须是精确 SemVer，发布时间来自 npm）；`-- --local` 未发布预览，`-- --check` 校验；托管为 HTTPS 后在 DSH「发现 → 索引源」中添加。

CI 两个 workflow：

- `.github/workflows/ci.yml`：push / PR 执行 `npm ci` → lint → messages:check → build → test → `release:preflight` → `release:pack` → 上传 tarball 产物。
- `.github/workflows/release.yml`：推 `v*` tag 触发，先校验 tag 与 `package.json.version` 一致，再 `npm run check` → `release:preflight -- --publish --allow-existing-tag`（CI 由 tag 触发，tag 已存在）→ `release:pack` → `npm publish --provenance` → 生成 catalog（带重试）→ `gh release create`。需要 secret `NPM_TOKEN`（npm automation token）与 `npm-publish` environment。
- **发布门禁不再要求 CHANGELOG**：publish 模式只要求 git 干净、版本未被占用、`v<version>` tag 不存在（CI 允许已存在）、npm 已登录；版本历史由 tag 与 GitHub Release 承载。

## 9. 常见坑与排查

- **改了 Client 没生效**：`src/client/**`、`src/shared/**` 改动必须 `npm run build`；preflight 的 `client bundle` 检查会报 `stale`。`dist/` 被 gitignore，不要提交，也不要手改。
- **改了 Host 没生效**：Host 模块在 DSH 进程内缓存，必须重启 DSH；只刷新浏览器不够。
- **本地 link 安装 / 包名迁移**：Desktop 由 Electron 独占管理，先**完全退出**（不是只关窗口），并使用 Desktop 自带 CLI 绝对路径（macOS：`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`）。包名变化后旧 `link:`/依赖仍指向旧名，必须 `plugin --profile desktop remove <旧包名>` 再 `plugin --profile desktop add "$PWD"`，重启后 `--dump-config` 应出现 `devbench-manager → dsh-devbench-plugin`。不污染真实 profile 的临时验证：`DSH_HOME=/tmp/dsh-dev-xxx <cli> plugin --profile dev add "$PWD"`。
- **npm 缓存只读**：沙箱/CI 里 `~/.npm` 不可写时，发布脚本自动回退到 `os.tmpdir()/dsh-devbench-npm-cache`；手工执行可设 `npm_config_cache=/tmp/npm-cache`。
- **worktree 路径**：需求工作树默认在 `~/.dsh-devbench/worktrees/`（`worktreeRoot` 可覆盖），**不在项目仓库内**，不要假设 `../` 相对关系；目录名由项目名/workspace 派生，标题变化会漂移，识别已有工作树要看 `devbench/<需求ID>` 分支与 git 注册路径，不能只看目录名。若在开发用 git worktree 中工作：`node_modules/` 与 `dist/` 不共享（被 gitignore），需重新 `npm ci` + `npm run build`；`link:` 依赖记录绝对路径，移动 checkout 后要重新 add。 Legacy `dsh-req/*` branches remain recognized.
- **测试并发/等待**：`node:test` 并发跑测试文件，禁止用固定 sleep 等后台任务；用 harness 的等待工具。共享 `process.env`（如 `DSH_DEVBENCH_CONFIG_DIR`）的测试要等前一个 harness `close()`；新测试要自己清理临时目录。
- **浏览器加载失败**：`client bundle not found` → 检查 `exports["./client"]` 与是否忘记 build；`could not load ... not registered` → bundle 内 id 与包名不一致（重 build + preflight）；`require("react")` 报错 → 引入了基座外第三方包。
- **HTTP 调试**：所有 API 必须带 `x-dsh-devbench` 头，且 Host/Origin 为本机回环；用 `curl` 复现后按稳定 `error.code` 定位。用 `DSH_DEVBENCH_CONFIG_DIR=/tmp/xxx` 隔离数据。
- **tarball / 安装问题**：先看 `dist/release/manifest.json` 文件列表与 preflight 输出；DSH 启动报 patch 行找不到包 → `cordis.patch.yml` 的 name 与包名不一致；浏览器报 module id 不匹配 → 忘了重新 build。

## 10. 关键文件地图

| 路径 | 职责 |
| --- | --- |
| `index.js` | Host 包入口，re-export `src/host/plugin.js` |
| `src/host/plugin.js` | 唯一装配点：HTTP prefix、6 个 Agent 工具、重启后任务恢复 |
| `src/host/http/router.js`、`http/routes/` | JSON API 路由与分发（路由表汇总在 `routes/index.js`） |
| `src/host/services/` | 用例编排：状态聚合、项目解析、提交/评审/需求任务、后台 Agent、工作树、git 操作、检索、周报 |
| `src/host/domain/` | 领域规则：需求文档、文件、评审文件、worktree |
| `src/host/storage/` | 配置/工作区映射/任务持久化（原子写 + 锁 + 损坏检测） |
| `src/host/tools/` | Agent 工具 schema 与执行（错误统一转 `{ ok: false }`） |
| `src/host/shared/path-safety.js` | 路径/ID/realpath/符号链接边界校验 |
| `src/host/integrations/git.js` | git 子进程封装（execFile、超时、脱敏） |
| `src/host/messages/` | Host 中文文案字典（`base.js` + `extra.js` → 生成的 `index.js`） |
| `src/host/prompts/` | 需求/提交/评审提示词渲染与默认模板 |
| `src/client/entry.js` | 浏览器入口：`__ModuleLoader__.load({ id: __PLUGIN_ID__, factory })` |
| `src/client/plugin.js` | Client 装配：inject、3 个 slot、中英文字典注册 |
| `src/client/core/api.js` | fetch 封装（请求头、超时、`ApiError`、全部 API 函数） |
| `src/client/views/`、`src/client/ui/`、`src/client/i18n/` | 顶层视图 / 原子组件 / 中英文字典 |
| `src/shared/protocol.js` | 跨端协议常量（路由前缀、请求头、数据目录名） |
| `scripts/build-client.mjs` | 构建 `dist/client.js`（esbuild、react 外置、注入包名） |
| `scripts/check-messages.cjs` | 校验/生成 Host 文案索引 |
| `scripts/lib/preflight.mjs` | 发布检查的唯一实现（preflight / pack / publish 共用） |
| `scripts/lib/pack.mjs` | build + preflight + pack + manifest |
| `scripts/release/` | preflight / pack / smoke-install / publish / catalog CLI |
| `test/host/helpers.js` | `createHarness()` 临时仓库 harness |
| `test/client/render-smoke.test.mjs` | Client 组件渲染 smoke |
| `.github/workflows/` | `ci.yml`（常规检查）、`release.yml`（tag 发布） |
| `cordis.patch.yml` | bundle patch（loader id + 包名） |
| `package.json` | 版本/包名/DSH 清单/脚本的唯一来源 |
| `README.md` | 产品、用户手册、项目结构（会随 npm 包发布） |

## 附：常见改动落点

| 要加什么 | 改哪里 |
| --- | --- |
| 新 HTTP 接口 | `src/host/http/routes/<domain>.js` → `routes/index.js` → `src/client/core/api.js` → Host 测试（harness `request()`） |
| 新领域规则 / 编排 | `src/host/domain/<name>.js` / `src/host/services/<name>.js` |
| 新 Agent 工具 | `src/host/tools/<name>-tools.js` + `src/host/plugin.js` 注册（+ 文案与测试） |
| 新 Host 文案 | `src/host/messages/extra.js`，再跑 `npm run messages:check` |
| 新 Client 页签 / 组件 | `src/client/views/project/` 或 `src/client/ui/` + `i18n` 中英文 + `render-smoke` 测试 |
| 新配置项 | `src/host/storage/config.js` + `routes/config.js` + `views/settings.js` + README 设置项 |
| 新发布检查 | `scripts/lib/preflight.mjs` + 本文件发布章节 |
