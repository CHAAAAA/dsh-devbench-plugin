# DSH DevBench

**dsh-devbench-plugin** 是 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）的工程/项目管理插件：以 DSH workspace 为项目来源，把需求、Git 提交、AI 提交、代码评审、工作树、后台任务和周报聚合到一个侧边栏工作台里。

| 项 | 值 |
| --- | --- |
| 包名 | `dsh-devbench-plugin` |
| 版本 | **1.0.1** |
| DSH 兼容 | `>=0.2.1-rc.3 <0.3.0-0` |
| Node.js | ≥ 20.18.1（推荐 24.x，CI 与 DSH Desktop 均使用 24） |
| 许可证 | MIT |

开发、测试与发布规范见 [AGENTS.md](AGENTS.md)；许可证全文见 [LICENSE](LICENSE)。

---

## 1. 功能

- **项目工作台**：三栏主从布局（项目树 · 列表 · 详情），概览/需求/提交/工作树/评审/任务六个页签；面包屑与视图历史。
- **需求管理**：按工作区保存 Markdown 需求（标题、状态、正文、资料文件、关联会话与关联提交），需求列表支持「标题 / 全文」两档检索（全文命中显示正文片段），带草稿恢复、离开拦截与保存冲突处理；需求文档的 Git 提交统一在设置页完成。
- **需求执行**：一键创建会话并发送模板化提示词；可为需求启用按需求 Git worktree（分支 `devbench/<需求ID>`）；对需求关联的提交发起评审时，评审会话会自动关联回需求。
- **AI 提交**：后台 Agent 生成中文 Conventional Commit，确认预览后提交；不自动 push，不自动建评审任务。
- **提交提示词可配置**：设置页可修改 AI 提交使用的提示词模板（整段可编辑，必须保留 `{taskId}`/`{changedFiles}`/`{diffText}` 占位符），可一键恢复默认；修改只影响之后创建的提交任务。
- **工作区 Git 操作**：项目「概览」tab 在 AI 操作面板下方展示当前未提交变更，支持手动提交（手填信息）、拉取（`--ff-only`）与推送（自动建立 upstream），操作后自动刷新概览、任务与工作树状态。
- **代码评审**：对任意提交发起只读评审，评审写入项目根 `.dsh-reviews/`；提交详情左侧变更文件树、右侧所选文件差异（差异区独立滚动）。概览「评审未提交」可评审当前工作区未提交变更（暂存 + 未暂存 + 未跟踪文件），结果同样写入 `.dsh-reviews/` 并标记为「未提交变更」。
- **工作树管理**：三态列表（已创建/目录缺失/已启用未创建），行内立即创建、查看改动、AI 提交、推送、VS Code/终端/文件管理器打开、复制路径分支、清理残留注册、删除（保留分支）。
- **任务中心**：提交/评审/需求任务的状态、取消、重试、打开会话（会话操作位于右侧内容区）。
- **项目启动器**：项目页头按平台检测并显示 VS Code / 文件管理器 / iTerm 打开按钮。
- **主页与周报**：跨项目最近任务、未完成任务、本地生成的周报。
- **会话关联**：会话头部按钮把当前会话关联到某个需求，或跳回需求。
- **Agent 工具**：`requirement_read/update/list`、`project_commit_propose/git_show/review_write` 6 个工具，让执行 Agent 读写需求、写提交信息与评审。

---

## 2. 安装

### 2.1 DSH 插件页（推荐）

1. 打开 DSH →「插件」页（不同版本可能在侧边栏；部分版本在「设置 → 插件」）。
2. 点「添加插件」。
3. 输入包名与精确版本：`dsh-devbench-plugin@1.0.1`。
4. 等待安装完成，点「立即启用」。
5. 如果界面提示需要重启，**完全退出并重新打开 DSH**（不是只关窗口）。

### 2.2 CLI

```sh
dsh plugin --profile web add dsh-devbench-plugin@1.0.1
dsh plugin --profile web list
dsh --profile web --dump-config | grep -A3 devbench-manager
```

Desktop profile 由 Electron 管理：先完全退出 DSH，再使用 Desktop 自带 CLI：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add dsh-devbench-plugin@1.0.1
```

### 2.3 离线 tarball

```sh
npm run release:pack      # 在仓库内构建 dist/release/*.tgz
dsh plugin --profile web add /绝对路径/dsh-devbench-plugin-1.0.1.tgz
```

也可以在插件页「添加插件」中直接输入 tarball 绝对路径。保留 tarball 原文件：profile 依赖会记录 `file:` 绝对路径。

### 2.4 插件市场索引

如果维护者已托管市场索引：插件 →「发现」→「索引源」→ 添加 HTTPS 索引 URL → 搜索 `dsh-devbench-plugin` → 确认版本/来源/兼容性 → 安装。索引由维护者用仓库脚本生成（见 4.4）。

安装后在 **设置 → 需求根目录** 选择（或新建）一个目录即可开始使用。

### 2.5 从旧包名迁移

v1.0.1 renames the package from `dsh-workbench-plugin` to `dsh-devbench-plugin` and updates all plugin-level identifiers: loader id `devbench-manager`, route `/dsh-devbench`, header `x-dsh-devbench`, config directory `~/.dsh-devbench/`, and project metadata directory `.dsh-devbench/`. Legacy config/metadata directories are migrated automatically; `DSH_REQUIREMENTS_CONFIG_DIR` remains a compatibility alias, and legacy `dsh-req/*` worktree branches remain recognized.

```sh
dsh plugin --profile web remove dsh-workbench-plugin
dsh plugin --profile web add dsh-devbench-plugin@1.0.1
```

- **已安装旧版的用户**：插件页移除旧版 →「添加插件」输入 `dsh-devbench-plugin@1.0.1` → 启用 → 完全退出并重新打开 DSH。
- **本地 link 开发**：先移除 profile 中的旧包名记录（`plugin --profile desktop remove <旧包名>`），再以新仓库目录重新 `add`，详见 4.3。
- **数据不受影响**：配置、需求文档、任务记录、Git 仓库与 `.dsh-reviews/` 评审文件全部保留；不需要迁移数据。

---

## 3. 快速上手

1. 打开左侧栏「DevBench」，默认进入主页；
2. 「添加项目」输入本地 Git 仓库绝对路径（同步为 DSH 工作区）；
3. 项目 →「需求」→「新建需求」，编辑正文并保存；
4. 点「执行」创建会话，Agent 通过 `requirement_read/update` 读写需求；
5. 在「概览」查看未提交变更并手动提交/拉取/推送，或使用「AI 提交」生成提交信息；
6. 在「提交」页对提交发起评审；
7. 用「工作树」页按需创建工作树、查看改动/提交/推送、清理残留并删除（保留分支）。

---

## 4. 开发与发布

> 本章只保留命令概要；分层约束、测试组织、提交规范、分支策略与发布检查清单等详细规范见 [AGENTS.md](AGENTS.md)。

### 4.1 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20.18.1（推荐 24.x，CI 与 DSH Desktop 均使用 24） | 插件本身无运行时依赖 |
| npm | ≥ 10 | 构建、测试、打包、发布 |
| DSH | `>=0.2.1-rc.3 <0.3.0-0` | 开发期用于 link 安装和真实启动验证 |
| Git | 任意现代版本 | Host 会调用 `git` 子进程；测试也会创建临时仓库 |

### 4.2 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm ci` | 安装开发依赖；会自动执行 `prepare`（等价一次 build） |
| `npm run build` | esbuild 构建浏览器 bundle → `dist/client.js` |
| `npm run lint` | ESLint：语法 + 分层依赖规则（越界 import 会失败并给出中文提示） |
| `npm run lint:fix` | 自动修复可修复的 lint 问题 |
| `npm run messages:check` | 校验 Host 文案字典；`-- --write` 重新生成文案索引 |
| `npm test` | `pretest` 先 build，再跑 `test/host/*` + `test/client/*`（node:test） |
| `npm run check` | `lint` + `messages:check` + `test`，提交前必跑，与 CI 门禁一致 |
| `npm run release:preflight` | 发布就绪检查：包身份、DSH 清单、exports、bundle 契约、tarball 内容 |
| `npm run release:pack` | build + preflight + 打 tarball，并写 `dist/release/manifest.json` |
| `npm run release:smoke` | 用真实 DSH CLI 在临时 `DSH_HOME` 安装/卸载 tarball |
| `npm run release:publish` | 默认 dry-run；`-- --yes` 才真正发布到 npm 并创建 `v<version>` tag |
| `npm run release:catalog` | 生成 DSH 插件市场索引 `dist/catalog/index.json`；`-- --local` 预览、`-- --check` 校验 |

### 4.3 本地开发与调试

Desktop profile 由 Electron 独占管理：操作前**完全退出 Desktop**（不是只关窗口），然后使用 Desktop 自带 CLI 绝对路径：

```sh
APP_CLI="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
PROJECT="/Users/你/项目/dsh-devbench-plugin"

"$APP_CLI" plugin --profile desktop add "$PROJECT"
"$APP_CLI" plugin --profile desktop list
cat ~/.dsh/profiles/desktop/package.json
```

正确结果：依赖为 `"dsh-devbench-plugin": "link:/.../dsh-devbench-plugin"`，`dsh.profile.bundles` 包含 `dsh-devbench-plugin`。Web profile 可用 `plugin --profile web add "$PROJECT"`，再用 `--dump-config | grep -A3 devbench-manager` 确认输出 `devbench-manager → dsh-devbench-plugin`。

| 改动位置 | 生效方式 |
| --- | --- |
| `src/host/**` | 重启 DSH（Host 代码在进程内缓存，不能热替换） |
| `src/client/**`、`src/shared/**` | `npm run build` → 刷新浏览器；若 DSH 未启用 HMR 则需重启 |
| `package.json` 的 `dsh` 字段、`cordis.patch.yml`、`locale/*.json`、`icon.svg` | 重启 DSH（插件清单在启动时读取） |
| 测试/文档 | 无需重启 |

调试要点：

- **Host 报错**：DSH 会把插件日志写到宿主日志；插件内部用 `ctx.logger?.warn?.(...)`。HTTP 错误响应含稳定 `error.code`，先用 curl/测试复现。
- **Client 加载失败**：查看浏览器 DevTools Console：`client bundle not found` → 检查 `exports["./client"]` 与是否忘记 build；`not registered` → bundle id 与包名不一致；`require("react")` 报错 → 引入了基座外第三方包。
- **不污染真实数据**：Host 支持 `DSH_DEVBENCH_CONFIG_DIR=/tmp/xxx` 覆盖配置目录，测试 harness 默认就这么做。
- **不要手改生成物**：`dist/client.js` 由 `scripts/build-client.mjs` 生成；`src/host/messages/index.js` 由 `messages:check -- --write` 生成。

### 4.4 发布链路

```sh
npm run check
npm run release:preflight
npm run release:pack
npm run release:smoke
npm run release:publish -- --yes   # 先不加 --yes 看 dry-run
npm run release:catalog            # 发布成功后生成市场索引
```

- **CI**：`.github/workflows/ci.yml` 在 push/PR 时执行 lint → messages:check → build → test → preflight → pack，并上传 tarball 产物；`.github/workflows/release.yml` 由 `v*` tag 触发，校验 tag 与 `package.json.version` 一致后发布到 npm（需要 `NPM_TOKEN` secret 与 `npm-publish` environment），随后生成市场索引并创建 GitHub Release。
- **版本**：`package.json.version` 是唯一版本来源；版本历史以 git tag（`v*`）和 GitHub Release 记录。
- **市场索引**：`npm run release:catalog -- --local` 可在发布前预览，`-- --check` 校验；把 `dist/catalog/index.json` 托管为 HTTPS 后，用户在 DSH「插件 → 发现 → 索引源」中添加该 URL 即可搜索安装。

> 更细的分层约束、硬性约束、测试要求、提交/分支规范、发布检查项与常见坑，统一见 [AGENTS.md](AGENTS.md)。

---

## 5. 许可证

[MIT](LICENSE) © DSH DevBench Plugin contributors
