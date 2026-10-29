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
- **Agent 工具**：`requirement_read/update/list`、`project_commit_propose/git_show/review_write` 6 个工具，让执行 Agent 读写需求、写提交信息与评审（详见 4.8）。

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

如果维护者已托管市场索引：插件 →「发现」→「索引源」→ 添加 HTTPS 索引 URL → 搜索 `dsh-devbench-plugin` → 确认版本/来源/兼容性 → 安装。索引由维护者用仓库脚本生成（见 6.4）。

安装后在 **设置 → 需求根目录** 选择（或新建）一个目录即可开始使用。

### 2.5 从旧包名迁移

v1.0.1 renames the package from `dsh-workbench-plugin` to `dsh-devbench-plugin` and updates all plugin-level identifiers: loader id `devbench-manager`, route `/dsh-devbench`, header `x-dsh-devbench`, config directory `~/.dsh-devbench/`, and project metadata directory `.dsh-devbench/`. Legacy config/metadata directories are migrated automatically; `DSH_REQUIREMENTS_CONFIG_DIR` remains a compatibility alias, and legacy `dsh-req/*` worktree branches remain recognized.

```sh
dsh plugin --profile web remove dsh-workbench-plugin
dsh plugin --profile web add dsh-devbench-plugin@1.0.1
```

- **已安装旧版的用户**：插件页移除旧版 →「添加插件」输入 `dsh-devbench-plugin@1.0.1` → 启用 → 完全退出并重新打开 DSH。
- **本地 link 开发**：先移除 profile 中的旧包名记录（`plugin --profile desktop remove <旧包名>`），再以新仓库目录重新 `add`，详见 6.3。
- **数据不受影响**：配置、需求文档、任务记录、Git 仓库与 `.dsh-reviews/` 评审文件全部保留；不需要迁移数据。
- 升级/回滚的完整步骤见 4.10。

---

## 3. 快速上手

1. 打开左侧栏「DevBench」，默认进入主页；
2. 「添加项目」输入本地 Git 仓库绝对路径（同步为 DSH 工作区）；
3. 项目 →「需求」→「新建需求」，编辑正文并保存；
4. 点「执行」创建会话，Agent 通过 `requirement_read/update` 读写需求；
5. 在「概览」查看未提交变更并手动提交/拉取/推送，或使用「AI 提交」生成提交信息；
6. 在「提交」页对提交发起评审；
7. 用「工作树」页按需创建工作树、查看改动/提交/推送、清理残留并删除（保留分支）。

以上每一步的完整操作说明见第 4 章「用户使用手册」。

---

## 4. 用户使用手册

本章是插件的完整用户手册：能力总览、启用与首次配置、界面导览、每个核心工作流、数据与文件位置、设置项、权限与安全、Agent 工具参考、常见问题、升级卸载回滚、已知限制与反馈。

### 4.1 能力总览

| 能力 | 说明 |
| --- | --- |
| 项目工作台 | 项目树 + 列表 + 详情三栏；概览、需求、提交、工作树、评审、任务六个页签 |
| 需求管理 | 按工作区保存 Markdown 需求：标题、状态、正文编辑、资料文件、关联会话与提交、软删除 |
| 需求执行会话 | 一键创建会话并发送渲染好的提示词；需求开启 worktree 时在独立工作树目录执行；评审关联提交时回链评审会话 |
| AI 提交 | 后台 Agent 按可配置的提示词（设置页「提交提示词模板」）生成中文 Conventional Commit，人工确认后提交（不会自动 push） |
| 工作区 Git 操作 | 项目「概览」展示当前工作区未提交变更，支持手动提交、拉取（`--ff-only`）与推送（自动建立 upstream） |
| 代码评审 | 对任意提交或当前未提交变更发起只读评审，结果写入 `.dsh-reviews/`；提交详情展示全部变更文件与逐文件 diff |
| Git 工作树 | 列出/查看改动/提交/推送/删除按需求创建的 `devbench/<需求ID>` 工作树 |
| 任务中心 | 提交/评审/需求三类后台任务的状态、取消、重试、打开会话（操作位于详情右侧） |
| 项目启动器 | 按平台检测并支持在 VS Code / 文件管理器 / iTerm 中打开项目目录 |
| 主页与周报 | 跨项目最近任务、未完成任务、本周汇总（本地生成，不调用 AI） |
| 会话关联 | 会话头部按钮把当前会话关联到某个需求，或跳回需求 |
| Agent 工具 | 6 个工具让执行 Agent 读写需求、写提交信息与评审（详见 4.8） |

### 4.2 安装、启用与首次配置

四种安装方式（DSH 插件页 / CLI / 离线 tarball / 插件市场索引）见第 2 节；本节从安装完成开始。

#### 4.2.1 启用与重启检查

- 左侧栏出现「DevBench」图标（工作台面板图形）。
- 打开后默认进入「主页」。
- 会话头部出现「需求」关联按钮。
- 如果浏览器控制台报 `client bundle not found` 或侧边栏没有图标：确认插件已启用、完全退出并重启 DSH、检查安装版本不是旧版 link。

#### 4.2.2 首次配置（必做）

1. 打开工作台 → 左下角「设置」。
2. 「需求根目录」：选择一个本地目录（可以是空目录）。插件会按项目在其中建立 `<项目目录>/<需求ID>/requirement.md`。
3. 建议点「初始化 Git 仓库」，让需求文档也有提交历史（可选）。
4. 可选：
   - 「执行提示词模板」：自定义执行需求时发送给 Agent 的提示词；
   - 「评审提示词模板」：自定义评审任务的提示词（必须保留 `{taskId}` 占位符）；
   - 「提交提示词模板」：自定义 AI 提交任务的提示词（必须保留 `{taskId}`、`{changedFiles}`、`{diffText}` 占位符）；可点「恢复默认」填回默认模板，恢复默认与修改一样需要再点「保存设置」才生效；
   - 「Worktree 根目录」：自定义按需求工作树的存放位置，留空使用默认 `~/.dsh-devbench/worktrees/`。
5. 点「保存设置」。

> 没有配置需求根目录时，需求相关操作会提示「尚未设置需求根目录」，这是预期行为。

### 4.3 界面导览

#### 4.3.1 整体布局

```
┌──────────────┬───────────────────────────────────────────────────────────┐
│              │ 面包屑：DevBench / 项目 / 当前页                        │
│  项目树      ├───────────────────────────────────────────────────────────┤
│  (240px)     │ 页面头：项目标题 + Git 状态 + 页签                        │
│  - 搜索项目  ├───────────────┬───────────────────────────────────────────┤
│  - 添加项目  │  列表栏       │  详情栏                                   │
│  - 项目行    │  （可搜索/   │  （选中项详情、编辑器、操作区）           │
│    + 任务红点│   筛选/分页）│                                           │
├──────────────┴───────────────┴───────────────────────────────────────────┤
│ 主页 · 项目 · 设置 · 关联需求（独立页面，可通过面包屑/返回回到来源）     │
└──────────────────────────────────────────────────────────────────────────┘
```

- 窗口变窄时列表栏会收窄；低于约 900px 未提供完整“列表/详情”二级切换（已知限制）。
- 支持深色/浅色主题（跟随 DSH）。

#### 4.3.2 页签

| 页签 | 内容 |
| --- | --- |
| 概览 | 统计卡、AI 操作（AI 提交 / 评审最新提交 / 评审未提交）、工作区面板（当前未提交变更，含手动提交 / 拉取 / 推送）、最近提交、运行中任务、最近评审、任务摘要 |
| 需求 | 需求列表 + 详情编辑；支持搜索（标题 / 全文两档）、状态筛选、分页；详情含关联会话与关联提交 |
| 提交 | 当前分支最近提交（默认 10 条，可加载更多，最多 100 条）；选中提交后左侧显示变更文件树，点击文件在右侧查看该文件差异（差异区独立滚动，长 diff 不再被裁切），并可直接发起评审或关联需求 |
| 工作树 | 本项目的工作树：三态列表（已创建/目录缺失/已启用未创建）、立即创建、清理残留、改动、提交、推送、编辑器/终端打开、复制、删除 |
| 评审 | 评审列表与 Markdown 内容（右侧内容区独立滚动） |
| 任务 | 后台任务列表：打开会话/取消/重试（打开会话位于右侧内容区） |

项目页头右上角提供打开项目目录按钮：按当前系统检测并显示 **VS Code**、**文件管理器**、**iTerm**；未安装的目标不会出现。

#### 4.3.3 主页

- 统计：项目数、需求数、未完成任务数、执行中需求数。
- 「最近任务」「未完成任务」：默认 10 条，「加载更多」逐页展开；会话存在时整行可点击进入会话。
- 「执行中的需求」：当前正在执行的需求。
- 「本周周报」：点「生成周报」汇总最近 7 天工作，可「复制 Markdown」。
- 点项目名进入项目概览。

#### 4.3.4 设置页

- 需求根目录、执行/评审/提交提示词模板、Worktree 根目录；
- Git 区块：需求文档的唯一提交入口（提交所有需求变更）；
- 有未保存修改时离开会拦截；修改 rootDir/worktreeRoot 会有强确认。

### 4.4 核心工作流

#### 4.4.1 添加与同步项目

- 项目来自 DSH 工作区（workspaceRegistry），不能在本插件里“删除 DSH 工作区”。
- 点项目树底部「添加项目」→ 输入本地目录绝对路径 → 插件通过 `workspaceRegistry.create` 同步到 DSH。
- DSH 侧新增工作区后，工作台通过状态轮询 + 窗口 focus 自动出现（约 5 秒内）。
- 支持嵌套项目；以 canonical path 去重。

#### 4.4.2 需求列表、检索与新建

**列表与检索**：需求列表顶部搜索框右侧有「检索范围」下拉，可选「标题」（默认）或「全文」：

- **标题**：输入即在本地过滤列表，匹配需求标题与需求 ID（忽略大小写），不发网络请求、无延迟；
- **全文**：停顿约 0.25 秒后由 Host 扫描当前工作区的需求文档（标题 + ID + 正文）；正文命中的行在标题下方显示命中片段（单行省略，悬停可看完整片段）；
- 「检索范围」与搜索词会被记住：切换页签/项目后再回来，关键词与范围保留，全文模式会自动重新检索；
- 两种范围下，状态筛选与分页都继续生效；匹配过多（默认超过 100 条）时列表底部提示「匹配较多，仅显示前 N 条」，可缩小关键词；
- 检索中列表显示「检索中…」；失败显示错误与「重试」按钮；无命中沿用「没有匹配的需求」空态。清空搜索词即恢复完整列表；
- 说明：全文检索只查当前工作区，不跨工作区；查询词上限 200 字符；不做正则 / 分词 / 拼音匹配，也不高亮命中文字。

**新建需求**：

1. 选中项目 →「需求」tab →「新建需求」。
2. 填标题；可选填正文（留空生成模板）。
3. 可选勾选「启用 worktree」：以后执行该需求时在独立工作树目录中运行。
4. 创建后进入详情，可直接编辑正文。

#### 4.4.3 编辑需求

- 编辑/预览切换；标题与正文都有「未保存」提示。
- 保存失败有两种常见情况：
  - **冲突**：他人/其他窗口已更新该需求 → 提示后选择覆盖或重新加载；
  - **离开拦截**：切换页签/项目/主页/设置/打开会话前提示「保存并离开 / 放弃修改 / 继续编辑」。
- 浏览器意外关闭/刷新后，草稿会从 localStorage 恢复（同一次编辑会话）。
- 状态：新建 / 执行中 / 已完成 / 已归档 / 已取消；已完成等终态切换有轻确认。
- 右侧信息：需求 ID、创建/更新时间、关联会话、关联提交、资料文件、worktree。每个需求内的 Git 历史已移除；需求文档提交统一在「设置 → Git → 提交所有需求变更」完成。

#### 4.4.4 需求资料文件

- 「资料文件」区块可新建文件/目录、编辑保存、删除、在系统文件管理器中打开。
- 支持子目录（如 `notes/deploy.md`）；文本文件可预览/编辑，二进制只提示不可预览。
- Agent 可用 `requirement_read` 的 `file` 参数读取资料文件；写入资料文件需用户在界面操作。

#### 4.4.5 执行需求

1. 需求详情点「执行」（或「再次执行」）。
2. Host 渲染提示词，必要时创建/复用 worktree，把状态置「执行中」。
3. 浏览器创建新会话并发送提示词；你可以在会话里继续补充要求。
4. 侧边栏项目红点、主页「未完成任务」会出现该需求任务；会话空闲后任务自动完成。
5. 执行不会自动改需求状态为「已完成」——状态始终由你手动维护。
6. 若开启了 worktree：会话 cwd 是工作树目录，分支为 `devbench/<需求ID>`；需求详情可「打开目录」或「移除 worktree」。

> 执行会话创建成功但发送提示词失败时，不会留下成功任务；可重试。

#### 4.4.6 AI 提交

1. 在项目「概览」点「AI 提交」（或工作树行内「提交」）。
2. Host 创建后台任务，用设置页的「提交提示词模板」渲染提示词；Agent 只读变更并调用 `project_commit_propose` 生成中文 Conventional Commit。
3. 任务进入「待确认」后，概览/任务会出现提示条；点「查看预览」打开确认框。
4. 确认框显示项目、路径、分支、HEAD、变更文件、提交信息与字符数；信息必须为中文且 ≤2000 字。
5. 关闭弹窗（X/ESC/遮罩）只是收起，**不会取消任务**；稍后可重新打开。
6. 确认后才执行 `git add -A` + `git commit`；提交成功不会自动推送，也不会自动创建评审任务。
7. 如需取消待确认任务：任务列表/概览中「取消任务」（二次确认）。

> 确认时 Host 会重新校验 HEAD 与变更集；若期间代码又变了，会返回 `stale-preview` 并要求重新生成预览。

#### 4.4.7 工作区 Git 操作（拉取 / 手动提交 / 推送）

项目「概览」tab 的 AI 操作面板下方是当前工作区（working tree）面板，用于不经过 AI 直接完成高频 Git 操作；「提交」tab 只保留提交历史主从布局。

- **未提交变更**：显示当前分支、HEAD、未提交文件清单（状态 + 路径，重命名显示 `旧 -> 新`）与数量；点「查看差异」展开暂存 + 未暂存 + 未跟踪文件列表的统一 diff（超过 20 万字符会截断）。工作区干净时显示「工作区干净」；中文、空格与重命名路径正常显示。非 Git 项目不显示该面板。
- **拉取**：执行 `git pull --ff-only`，只做快进；当前分支没有 upstream、无法快进或网络/权限失败时返回错误，不会自动 merge（没有浏览器内冲突解决）。
- **手动提交**：点「提交」→ 输入提交信息（1–2000 字符，中英文均可）→ 确认。确认后执行 `git add -A` + `git commit`，即把当前工作区的全部未提交变更一次性提交；不调用 AI、不生成预览任务。无未提交变更、detached HEAD 或已有进行中的 AI 提交任务时按钮禁用。
- **推送**：推送当前分支；有 upstream 直接推送，无 upstream 时自动 `git push -u <origin|唯一远端> <分支>` 建立 upstream。没有远端、或多远端但没有 origin 时提示配置远端；不会 force push。
- **互斥与安全**：任一操作进行中时按钮显示进行中文案并禁用；存在排队/执行中/待确认的 AI 提交任务时，手动提交与拉取禁用（避免预览失效）；需求正在项目主工作区执行时，手动提交与拉取返回 409 `requirement-running`，等执行结束再操作。git 子进程禁交互提示（`GIT_TERMINAL_PROMPT=0`），失败快速返回并对输出中的 URL 凭据脱敏。
- 操作成功后自动刷新该面板、概览统计（含最近提交）、任务与工作树列表；失败按错误码提示（见 4.9 常见问题）。

#### 4.4.8 发起评审

1. **提交评审**：在「提交」tab 选一条提交 → 右侧内容区顶部「评审此提交」；或在概览「评审最新提交」评审最新提交。
2. **未提交评审**：在概览「AI 操作」点「评审未提交」评审当前工作区未提交变更。
   - 范围：暂存、未暂存与未跟踪的新文件（`.dsh-reviews/` 与已被忽略的文件除外）。
   - 无未提交变更、项目未初始化 Git 或已有未提交评审任务进行中时按钮禁用；并发发起返回 409。
3. 选中提交后，右侧内容区左侧显示变更文件树、右侧显示所选文件的完整 diff（差异区占满详情剩余高度并独立滚动，过大时截断）；只有一个变更文件时省略文件树、直接全宽显示差异。提交元信息、已关联需求与最近评审压缩在详情顶部，不挤占差异区。
4. 后台 Agent 只读代码，必须调用 `project_git_show` 获取 diff（提交评审返回该提交的 diff；未提交评审返回暂存、未暂存与未跟踪文件内容的组合 diff），再调用 `project_review_write` 写评审。
5. 评审文件在项目根 `.dsh-reviews/`，文件名 `YYYYMMDD-摘要.md`，同日重名追加 `-2/-3`。未提交评审的文件 frontmatter 带 `target: "uncommitted"`（`commit` 为空），在概览「最近评审」、评审 tab 与任务中心显示为「未提交变更」，且不会把任何提交标记为已评审。
6. 评审任务产生后，提交详情顶部会出现「打开评审会话」；评审列表可查看 Markdown。未提交评审同属 review 任务，可取消、失败可重试；重试会重新检查当前工作区（变更文件与提示词重建，工作区已无未提交变更时提示无需评审），并仍受「同一工作区同时只有一个未提交评审」约束。

#### 4.4.9 工作树

「工作树」tab 只列出插件管理的 `devbench/<需求ID>` 工作树（目录在 worktree 根目录内），并按三种状态展示：

- **已创建**：目录存在，可以查看改动、提交、推送、打开与删除。
- **目录缺失**：注册还在但目录被外部删除；提供「清理残留注册」，只删除注册记录、保留分支（等价于 `git worktree prune`）。
- **已启用未创建**：需求已勾选「启用 worktree」但目录尚未创建；可在此「立即创建」，或到需求详情执行需求时自动创建。

每行的详情区提供：

- 「查看改动」：变更文件列表 + 统一 diff（过长会截断）；中文/空格/重命名路径正常显示。
- 「提交」：与 AI 提交相同流程，但只在工作树分支提交；需求正在执行时会被拒绝（避免提交半成品）。工作树提交会话的 cwd 是工作树目录（在项目目录之外），DSH 只允许 cwd 与项目路径一致的会话挂到项目分组，因此该会话显示在 DSH 侧栏「未分组」；可在任务中心/主页用「打开会话」按会话 id 直接进入。
- 「推送」：推 `devbench/<需求ID>` 到远端并设置 upstream；远端有多个但没有 origin 时会提示配置 origin。
- 打开方式：按当前平台提供「文件管理器 / VS Code / iTerm」按钮；另有「复制路径」「复制分支」「打开需求」。
- 「删除工作树」：删目录、保留分支；有未提交变更时拒绝删除；需求上的 worktree 开关不变，下次执行会重新创建。
- 列表页头在有目录缺失时提供「清理全部残留」。

> worktree 要求项目已是 Git 仓库且至少有一次提交；否则执行/创建时返回 400（`worktree-not-git` / `worktree-no-commit`）。
> 目录已在插件外被删除时，「删除工作树 / 移除 worktree」会清理注册并返回成功（分支保留），不再报 404。
> 逐文件 diff、提交历史、合并回主分支等能力尚未提供，工作树分支不会自动合并回主分支。

#### 4.4.10 任务中心

- 类型：提交（commit）、评审（review）、需求执行（requirement）。
- 状态：排队、执行中、待确认、成功、失败、已取消。
- 选中任务后，右侧内容区顶部提供「打开会话」；提交/评审任务另有取消、失败重试。
- 未提交评审任务在详情中标注「评审目标：未提交变更」。
- 需求任务：只提供打开会话（会话空闲后自动完成）。
- DSH 重启时：排队/执行中的任务会转为失败；待确认任务保留。

#### 4.4.11 会话与提交关联

- 会话关联：在任意会话头部点「需求」按钮 → 选择需求 → 「关联」；关联后需求详情的「关联会话」可打开会话，也可「解除关联」。
- 提交关联（需求侧）：「需求」详情 →「关联提交」→ 从最近提交中选择；每条关联提交显示短哈希与摘要，可点击跳转到「提交」tab 并选中该提交，也可「取消关联」。
- 提交关联（提交侧）：「提交」tab 选中提交 → 右侧内容区「关联到需求」→ 选择需求；已关联需求可打开需求详情或取消关联。
- 评审回链：若对需求关联的提交发起评审，Host 会自动把该评审会话加入需求的「关联会话」；若先评审后关联提交，关联时也会补链已有评审会话。

#### 4.4.12 周报

- 主页「生成周报」：本地汇总最近 7 天的提交、评审、任务、需求变动，生成中文 Markdown（不调用 AI、不写文件）。
- 「重新生成」可刷新；「复制 Markdown」复制到剪贴板。

### 4.5 数据与文件位置

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 插件配置 | `~/.dsh-devbench/config.json` | rootDir、执行/评审/提交提示词模板、worktreeRoot |
| 工作区映射 | `~/.dsh-devbench/workspaces.json` | 工作区 → 需求目录 |
| 任务 | `~/.dsh-devbench/tasks.json` | 最近 200 条，原子写 |
| 默认 worktree 根 | `~/.dsh-devbench/worktrees/` | 可在设置覆盖 |
| 需求文档 | `<rootDir>/<项目目录>/<需求ID>/requirement.md` | frontmatter + Markdown |
| 需求资料 | 同一需求目录下任意文件/子目录 | Agent 可读，用户可写 |
| 评审 | `<项目根>/.dsh-reviews/YYYYMMDD-摘要.md` | 不纳入 Git（写 `.git/info/exclude`）；未提交变更评审 frontmatter 带 `target: "uncommitted"` |

**备份**：复制 `~/.dsh-devbench/` 和需求根目录即可；worktree 目录可以丢弃（分支在项目仓库里）。

**卸载不会删除数据**：配置、需求文档、Git 仓库、评审文件都保留；需要彻底清理才手工删除。

**软删除需求**：从列表移除，但需求目录和文件保留；删除记录写入 `deleted-requirements.json`。资料文件/目录删除是硬删除，不可撤销。

### 4.6 设置项说明

| 设置 | 作用 | 注意事项 |
| --- | --- | --- |
| 需求根目录 | 需求文档的存放根目录 | 必须是绝对路径；变更会有强确认；旧数据不会自动迁移 |
| 执行提示词模板 | 执行需求时发送的提示词 | 占位符：`{workspaceTitle}` `{title}` `{id}` `{requirementPath}` `{folderPath}` `{body}` |
| 评审提示词模板 | 评审任务的提示词 | 必须包含 `{taskId}`，否则保存失败（400 `bad-review-template`）；可「恢复默认」 |
| 提交提示词模板 | AI 提交任务生成提交信息时发送的提示词 | 默认模板占位符：`{taskId}` `{projectPath}` `{worktreeInfo}` `{changedFiles}` `{diffText}`；必须保留 `{taskId}`、`{changedFiles}`、`{diffText}`，否则保存失败（400 `bad-commit-template`）；「恢复默认」只填回编辑器，仍需点「保存」 |
| Worktree 根目录 | 按需求工作树的默认父目录 | 留空用默认；变更需要确认；不会移动已有工作树 |
| Git 提交（设置页） | 提交需求根目录的所有变更 | 需求文档的唯一提交入口；详情页只读历史 |

执行/评审/提交提示词模板的修改只影响**之后创建**的任务；已有任务使用创建时的提示词。

### 4.7 权限、安全与隐私

- 插件 HTTP 服务只监听 DSH 本机 webServer：Host/Origin 必须是回环地址，且每个请求都带 `x-dsh-devbench` 请求头（值为 `1`）。其他网页无法直接调用。
- 文件操作限制在需求根目录/worktree 根目录内，拒绝符号链接穿越。
- 提交确认有二次校验，防止确认期间代码被改。
- 评审 Agent 被限制为只读工具；需求 Agent 只能改正文和 new/running 状态。
- 插件不上传任何数据；AI 调用由 DSH 的模型配置决定（沿用你当前会话的模型）。
- Git 提交/推送由你明确触发；不会自动 push、不会创建 PR。
- 需求根目录与配置目录都不在代码仓库内（除非你主动把需求根目录设进仓库）；评审目录 `.dsh-reviews/` 会写入项目 `.git/info/exclude`，不改项目 `.gitignore`。

### 4.8 Agent 工具参考

执行需求或后台任务时，Agent 可以使用以下工具（普通会话中是否可见取决于 DSH 工具授权）：

| 工具 | 参数 | 用途 |
| --- | --- | --- |
| `requirement_read` | `requirement_id?`、`workspace_id?`、`file?` | 读取需求正文；带 `file` 读取资料目录中的文本文件 |
| `requirement_update` | `content`（必填）、`requirement_id?`、`workspace_id?`、`mode=replace\|append`、`status=new\|running` | 修改正文或追加内容；状态只能改为 new/running |
| `requirement_list` | 无 | 列出各工作区需求（ID、状态、标题） |
| `project_commit_propose` | `task_id`、`message` | 提交后台任务专用：提交中文 Conventional Commit 信息 |
| `project_git_show` | `task_id` | 评审后台任务专用：读取提交 diff；未提交评审返回工作区未提交变更的组合 diff |
| `project_review_write` | `task_id`、`summary`、`content` | 评审后台任务专用：写入评审 Markdown |

约束：工具与会话/任务绑定；提交信息必须中文且 ≤2000 字符；评审 Agent 不能修改代码；Agent 不能把需求标记为已完成。需求工具只能修改正文与 `new`/`running` 状态、不能改 frontmatter 元数据；评审任务每个只能写入一次；后台任务工具通过 `tools.restrict({ deny })` 限制写类工具，评审 Agent 保持只读。

### 4.9 常见问题

| 现象 | 排查 |
| --- | --- |
| 侧边栏没有「DevBench」 | 插件是否启用；是否完全重启 DSH；安装的是 registry 版还是旧 link 版；浏览器控制台是否 `client bundle not found` |
| 打开面板提示连接失败 | 插件 Host 未启用或版本不匹配；重启 DSH；查看 DSH 日志 |
| 提示「尚未设置需求根目录」 | 设置 → 选择需求根目录 → 保存 |
| 需求执行后没有任务/红点 | 确认提示词已发送成功；DSH 重启后旧任务会失败；刷新主页 |
| 执行返回 `worktree-not-git` / `worktree-no-commit` | 项目先 `git init` 并至少提交一次 |
| 移除/删除工作树失败 `worktree-dirty` | 先提交或清理未提交变更 |
| 创建/执行需求失败 `worktree-outside-root` | 该分支已被 worktreeRoot 之外的工作树检出；先手工 `git worktree remove <路径>` 再重试 |
| 执行需求失败 `worktree-commit-active` | 该需求有待确认的工作树提交预览；先在工作树 tab 确认或取消提交 |
| 推送失败 | 项目没有 remote、多个 remote 无法确定、或没有权限；默认使用 origin，仅一个 remote 时回退 |
| 手动提交失败 `bad-manual-commit-message` | 提交信息为空或超过 2000 字符；改为 1–2000 字符后重试 |
| 手动提交/拉取返回 `project-task-active` | 有排队/执行中/待确认的 AI 提交任务；先确认或取消该任务 |
| 手动提交/拉取返回 `requirement-running` | 需求正在项目主工作区执行；等执行结束后重试（工作树内的需求执行不受影响） |
| 拉取失败 `pull-no-upstream` | 当前分支没有 upstream；先推送一次建立 upstream（或在终端 `git branch -u`） |
| 拉取失败 `pull-failed` | 无法快进、工作区冲突、网络或权限问题；在终端/IDE 手工处理后重试，插件不做自动 merge |
| 手动推送返回 `push-no-remote` / `push-remote-ambiguous` | 项目没有远端，或有多个远端但没有 origin；先配置 origin |
| 提交提示词模板保存失败 `bad-commit-template` | 自定义模板缺少 `{taskId}`、`{changedFiles}` 或 `{diffText}`；补回占位符或点「恢复默认」后再保存 |
| 概览页看不到「工作区」面板 | 非 Git 项目不显示该面板；确认项目路径已 `git init`，或概览数据加载失败时刷新重试 |
| AI 提交一直待确认 | 概览/任务中打开预览确认；关闭弹窗不等于取消 |
| 提交确认返回 `stale-preview` | 确认期间代码变了 → 重新生成预览再确认 |
| 评审没有产物 | 评审 Agent 未调用 `project_review_write` 或任务失败；查看任务错误/重试；模板不要删掉必须调用工具的指令 |
| 概览「评审未提交」按钮不可点 | 工作区没有未提交变更、项目未初始化 Git，或已有未提交评审任务进行中 |
| 会话历史报 `lacks an identified message` | 旧版本 bug 产生的会话，无法自动修复；在 DSH 会话列表归档/删除 |
| 需求保存冲突 | 其他窗口已修改；选择覆盖或重新加载 |
| 全文检索没有结果或报错 | 确认检索范围选的是「全文」（「标题」档只在本地过滤标题与需求 ID）；关键词超过 200 字符会提示错误，缩短后重试；确认需求正文已保存且已配置需求根目录；当前工作区没有需求时检索结果为空 |
| 页面极窄时列表/详情拥挤 | 已知限制；拉宽窗口或暂时收起项目树 |
| 升级后插件消失 | 若包名发生过变化，需重新安装或重新 link（见 2.5 与 4.10） |

### 4.10 升级、卸载与回滚

#### 4.10.1 升级

插件管理页对第三方插件通常不提供版本选择器，采用卸载重装：

1. 插件页 → 本插件详情 → 卸载/移除；
2. 「添加插件」→ 输入新版本 `dsh-devbench-plugin@x.y.z`；
3. 启用并完全重启 DSH；
4. 建议升级前备份 `~/.dsh-devbench/` 和需求根目录。

#### 4.10.2 卸载

插件页移除并重启；CLI：

```sh
dsh plugin --profile web remove dsh-devbench-plugin
```

卸载只移除插件包与 bundle 选择，**不删除**配置、需求文档、任务、Git 仓库、评审文件。

#### 4.10.3 回滚

- 安装旧版本精确 spec：`dsh plugin --profile web add dsh-devbench-plugin@x.y.z`；
- 或安装旧 tarball；
- 如果新版本改过数据格式，回滚前先恢复备份，不要假设旧版本能读懂新数据。

### 4.11 已知限制

- 三栏主从在宽度 < 900px 时只收窄列表栏，没有完整的窄屏二级切换。
- 搜索/分页状态在需求列表持久化；提交/评审/任务的部分分页状态切换页签后会回到第一页。
- 需求全文检索按需扫描当前工作区的需求文档，不建索引：需求很多（数百条）或正文很长时首次检索会略慢；结果默认最多返回前 100 条，超出时提示缩小关键词。
- 删除需求是软删除，但没有恢复入口；资料文件删除不可撤销。
- 需求任务“完成”的判定是会话 Agent 空闲：会话内部报错不会阻止任务成功。
- 旧版本需求会话派生的任务时间取需求 `updatedAt`，可能不等于真实执行时间。
- worktree 分支不会自动合并回主分支，也不创建 PR；逐文件 diff、提交历史等写能力尚未提供。
- 工作树内的需求执行会话与工作树 AI 提交会话的 cwd 在工作树目录（项目目录之外），DSH 会话分组只接受 cwd 与项目路径一致，因此这些会话显示在 DSH 侧栏「未分组」，不会归到项目分组下；可从需求详情/任务中心/主页按会话 id 打开。
- 工作树推送与手动推送使用快进推送语义，不 force、不自动解决冲突。
- 概览「工作区」面板的拉取只做 `--ff-only`；不做自动 merge，也没有浏览器内冲突解决，需要合并时用终端/IDE 处理。
- 手动提交固定 `git add -A`（提交全部未提交变更），不支持选择性暂存或逐文件提交。
- 周报是本地确定性汇总，不包含远端未拉取数据。
- 未提交变更评审只针对发起时的当前工作区，不与提交哈希关联；需要按提交归档评审时，请对提交再发起一次评审。
- 评审模板删掉关键要求可能导致评审失败或无产物；提交提示词模板删掉关键要求（如只调用一次 `project_commit_propose`）可能导致 AI 提交无法生成合规提交信息，需要时点「恢复默认」复原。
- 提交历史用 offset 分页，加载期间有新提交可能位移。
- AI 生成内容可能与实际 diff 不符，提交/评审前必须人工确认。
- 后台任务在 Host 进程内运行；页面关闭不要求任务继续，DSH 重启会把运行中任务标记失败。
- v1.0.1 起包名已经变更；从旧 link 版升级需要重新安装（见 2.5 与 4.10）。

### 4.12 反馈与更多文档

- 本 README 即插件唯一的用户文档；开发、测试与发布规范见 [AGENTS.md](AGENTS.md)。
- 版本变更以 git tag（`v*`）记录，仓库不再维护单独的变更日志。
- 问题反馈：在插件仓库提交 Issue，附以下信息（请先脱敏路径与 token）：
  - DSH 版本（`dsh --version`）与插件版本；
  - 操作系统与安装方式（registry / link / tarball）；
  - 复现步骤、预期结果与实际结果；
  - 浏览器 Console 与 Host 日志中的错误片段。

---

## 5. 项目结构

### 5.1 仓库目录树

```
.
├── index.js                  # Host 入口：re-export src/host/plugin.js 的 inject/apply
├── cordis.patch.yml          # DSH bundle patch：loader id devbench-manager → 包名
├── package.json              # 包身份、DSH 清单、scripts 的唯一来源
├── package-lock.json
├── eslint.config.js          # 语法规则 + 分层依赖规则
├── icon.svg                  # 插件图标
├── locale/                   # 插件页元数据（zh.json / en.json）
├── src/
│   ├── shared/protocol.js    # 跨端协议常量（路由前缀、请求头、数据目录名）
│   ├── host/                 # Host 半侧（Node.js，DSH 插件进程内）
│   │   ├── plugin.js         # 唯一装配点
│   │   ├── constants.js / errors.js
│   │   ├── http/             # JSON API：router、routes、body、security
│   │   ├── tools/            # 6 个 Agent 工具
│   │   ├── services/         # 用例编排
│   │   ├── domain/           # 领域规则
│   │   ├── storage/          # 配置/工作区/任务持久化
│   │   ├── shared/           # atomic、path-safety
│   │   ├── prompts/          # 提示词渲染与默认模板
│   │   ├── messages/         # Host 中文文案字典
│   │   ├── integrations/git.js
│   │   └── platform/open.js
│   └── client/               # Client 半侧（浏览器 bundle）
│       ├── entry.js          # __ModuleLoader__ 入口
│       ├── plugin.js         # inject、slot 注册
│       ├── runtime.js        # React 绑定、t()、NS/PANEL_ID
│       ├── core/             # api、async 竞态、ui-store、navigation、纯函数
│       ├── i18n/             # 中英文字典
│       ├── ui/               # 原子组件
│       └── views/            # 顶层视图 + project/ 三栏主从
├── test/
│   ├── host/                 # node:test + createHarness + 假 Agent + 临时 git 仓库夹具
│   └── client/               # 纯函数/契约/渲染 smoke
├── scripts/                  # build-client、check-messages、lib/、release/
├── .github/workflows/        # ci.yml、release.yml
├── dist/                     # 构建产物（gitignore）：client.js、release/、catalog/
├── README.md                 # 产品 + 用户手册 + 项目结构（随 npm 包发布）
├── AGENTS.md                 # 开发协作指南（不随 npm 包发布）
└── LICENSE
```

### 5.2 运行上下文与 HTTP API

DSH DevBench 是一个两端插件：Host 半侧（Node.js，DSH 插件进程内）提供 HTTP JSON API、Agent 工具、Git/文件系统操作、后台任务和持久化；Client 半侧（浏览器）通过 DSH 的 `__ModuleLoader__` / slots 机制注册侧边栏入口、面板、会话头部操作和全部界面。两侧只通过 HTTP 协议和 `src/shared/protocol.js` 通信，Client 不 import 任何 Host 模块。

```
┌──────────────────────── DSH Desktop / dsh web ────────────────────────┐
│                                                                       │
│  Cordis Loader                                                        │
│    └─ bundle patch: devbench-manager → dsh-devbench-plugin       │
│         └─ src/host/plugin.js  exports { inject, apply }              │
│              ├─ ctx.webServer.register({ kind: 'prefix',              │
│              │      path: '/dsh-devbench', handler })             │
│              ├─ ctx.tools.register(...) × 6  Agent 工具               │
│              ├─ ctx.effect(task recovery)                             │
│              └─ 按需获取 agents / agentDefaultModel / ...             │
│                                                                       │
│  Web server ── HTTP ──► http/router.js ─┬─ routes/*（59 条 JSON API） │
│                                         └─ security/body              │
│                                                                       │
│  Browser shell                                                        │
│    └─ __ModuleLoader__.load({ id, factory }) ← dist/client.js         │
│         └─ createPlugin() → ctx.slots.register(...)                   │
│              ├─ main: RequirementsPage                                │
│              ├─ sidebar.panellist: DevbenchIcon                      │
│              └─ conversation.session.header.actions:                  │
│                   SessionRequirementAction                            │
└───────────────────────────────────────────────────────────────────────┘
```

Host 声明的注入服务：`tools`、`webServer`、`workspaceRegistry`；运行时还会按需获取 `agents`、`agentDefaultModel`、`agentPresets`、`sessionController`。

HTTP API 统一前缀 `/dsh-devbench/api`，返回 `{ ok: true, value }` 或 `{ ok: false, error: { code, message } }`；请求必须带 `x-dsh-devbench: 1` 请求头，且 Host/Origin 必须是本机回环地址；请求体上限 8 MiB。

| 路由文件 | 主要接口 |
| --- | --- |
| `routes/config.js` | `GET /state`、`POST /config`、`POST /root/open`、`POST /root/reveal`、`POST /workspace/init` |
| `routes/dashboard.js` | `GET /dashboard`、`POST /weekly-report` |
| `routes/requirements.js` | `POST /requirement/{create,get,save,execute,delete,link-session,unlink-session,link-commit,unlink-commit,execute/task,worktree,worktree/remove,worktree/reveal}`、`GET /session-link`、`GET /requirement/search` |
| `routes/projects.js` | `POST /project/add`、`POST /project/git/init`、`POST /project/commit/preview\|confirm\|manual`、`POST /project/pull\|push`、`POST /project/review/start\|uncommitted`、`POST /project/task/cancel\|retry`、`POST /project/open`、`GET /project/overview\|commits\|commit/detail\|changes\|tasks\|review/content\|open-targets` |
| `routes/project-worktrees.js` | `GET /project/worktrees`、`GET /project/worktree/changes`、`POST /project/worktree/create\|prune`、`POST /project/worktree/commit/preview\|confirm`、`POST /project/worktree/push\|reveal\|remove` |
| `routes/files.js` | `GET /files`、`POST /files/write\|create\|delete\|open` |
| `routes/git.js` | `GET /git/status\|log`、`POST /git/init\|commit` |

共 59 条（16 GET + 43 POST）。`/state` 和 `/dashboard` 是聚合读模型，其余接口按资源划分。错误码是稳定契约（例如 `bad-root`、`worktree-dirty`、`worktree-in-use`、`worktree-requirement-running`、`worktree-commit-active`、`worktree-outside-root`、`push-remote-ambiguous`、`pull-no-upstream`、`push-no-remote`、`requirement-running`、`task-project-mismatch`、`stale-preview`、`no-uncommitted-changes`、`bad-open-target`、`bad-search-query`、`bad-search-scope`、`bad-search-limit`），客户端用 `ApiError.code` 分支并映射恢复动作。

`GET /requirement/search` 在当前工作区的需求文档中做大小写不敏感子串检索：`scope=title`（默认）匹配标题与需求 ID，`scope=full` 再匹配正文并返回命中片段；标题/ID 命中排在正文命中之前，同组按 `updatedAt` 倒序；响应给出 `match.field`（`title`/`id`/`body`）、`match.snippet`（仅正文命中，≤140 字符）、`total` 与 `hasMore`。`q` 为空返回空结果；`q` 超过 200 字符、非法 `scope` 或非法 `limit` 分别返回 400 `bad-search-query` / `bad-search-scope` / `bad-search-limit`；未配置需求根目录或工作区无需求目录返回空结果；只返回摘要与片段，不返回正文全文。

### 5.3 Host 半侧（`src/host`）分层与职责

| 路径 | 职责 | 规则 |
| --- | --- | --- |
| `plugin.js` | 唯一入口：注册 HTTP prefix、6 个 Agent 工具、重启后任务恢复 | 只做装配 |
| `constants.js` | Host 常量 + re-export `src/shared/protocol.js` | 无逻辑 |
| `errors.js` | `ApiError` / `apiError()` / `errorMessage()` | 无逻辑 |
| `shared/atomic.js` | 原子写（临时文件 + rename）、文件锁/键锁/工作区锁 | 不得依赖上层 |
| `shared/path-safety.js` | 路径校验、`lstatMaybe`、`isPathInside`、类型判断 | 不得依赖上层 |
| `messages/*` | 中文文案字典（base + extra + index 聚合） | 纯数据，由 `messages:check` 校验 |
| `prompts/*` | 需求执行/提交/评审提示词渲染与默认模板（提交模板可在设置中覆盖） | 只依赖 constants |
| `services/*` | 用例编排：状态聚合、项目解析、提交/评审任务、需求任务、后台 Agent、工作树、项目工作区 Git 操作、需求检索、主页/周报 | 可依赖 domain/storage/integrations |
| `tools/*` | Agent 工具定义（参数 schema、执行、错误 → `{ok:false}`） | 可依赖 services/domain；不得依赖 http |
| `domain/*` | 领域规则：需求文档、文件、评审文件、worktree 探测/创建/移除 | 不得依赖 services/http/tools |
| `http/*` | JSON API：路由表、路由处理、请求体限制、可信校验 | 不得依赖 tools/plugin |
| `storage/*` | 配置、任务、workspace 映射的读写与损坏检测 | 不得依赖 domain 及上层 |
| `integrations/git.js` | `git` 子进程封装（execFile，无 shell 拼接） | 不得依赖 domain 及上层 |
| `platform/open.js` | 系统打开路径 + 项目启动器（VS Code / 文件管理器 / iTerm）检测与打开 | 最底层适配 |

### 5.4 Client 半侧（`src/client`）分层与职责

| 路径 | 职责 |
| --- | --- |
| `entry.js` | `window.__ModuleLoader__.load({ id: __PLUGIN_ID__, factory })` |
| `plugin.js` | 声明 `inject`、注册 3 个 slot、注册中英文字典 |
| `runtime.js` | React 绑定（唯一 `require('react')` 的地方）、`t()`、错误文案、`NS`/`PANEL_ID` |
| `core/api.js` | fetch 封装：插件请求头、超时、`ApiError`、全部 API 函数 |
| `core/async.js` | 请求竞态工具：`createLatestRequest`、`createSingleFlight`、`createSerialQueue` |
| `core/ui-store.js` | 轻量外部 store：选中项、列表筛选/分页/滚动、视图历史 |
| `core/navigation.js` | 视图跳转、返回、离开拦截（未保存草稿） |
| `core/project-utils.js` | 任务/评审/提交的纯函数合并逻辑 |
| `core/task-request-gate.js` | 防止同一操作重复发起的请求门 |
| `i18n/*` | 中英文字典（common/tabs/detail/safety 合并到 index） |
| `ui/*` | 原子 UI：common（Banner/Modal/Breadcrumb/Styles）、dialogs、toast、icons、markdown、list-page、file-tree、commit-diff-browser（提交变更文件树 + 可滚动 diff）、session-row、commit-confirm-modal、样式 |
| `views/*` | 顶层视图：`requirements-page`（面板根）、`home`、`welcome`、`settings`、`link` |
| `views/project/*` | 项目三栏主从：`devbench`（壳）、`sidebar`、六个页签、`requirement-detail`、`session-action`、`workspace-changes`（概览 tab 工作区面板） |

### 5.5 依赖方向（ESLint 强制）

```
host:   plugin → http/tools → services → domain → storage/integrations/platform
                          ↘ shared / prompts / messages / constants / errors

client: entry → plugin → views → ui → core → runtime
                         ↘ src/shared/protocol.js
i18n 只含字典
```

`eslint.config.js`（flat config）为每一层配置了 `no-restricted-imports`，越界 import 会直接 lint 失败，并给出中文修改方向；正确做法是移动代码，不要用 `eslint-disable` 绕过：

| 层 | 约束 |
| --- | --- |
| `src/shared/**` | 只放跨端协议常量；不能依赖 host/client/Node/React |
| `src/client/**` | 只能共享 `src/shared` 协议常量，不能导入 host 实现或 `node:*` |
| `src/client/core/**` | 不能依赖 ui 或 views（依赖方向：views → ui → core） |
| `src/client/ui/**` | 不能依赖 views |
| `src/client/i18n/**` | 只应包含字典，不能依赖 core/ui/views |
| `src/host/shared/**` | 只能依赖 errors/messages/constants，不能依赖上层业务模块或更底层以外的模块 |
| `src/host/prompts/**` | 只能依赖 constants，不能依赖业务模块 |
| `src/host/messages/**` | 纯字典，不能依赖其它模块 |
| `src/host/storage/**`、`integrations/**` | 不能依赖 domain 及更上层（依赖方向：services → domain → storage） |
| `src/host/domain/**` | 不能依赖 http/services/tools |
| `src/host/services/**` | 不能依赖 http/tools，也不能被 plugin 直接绕过 |
| `src/host/tools/**` | 不能依赖 http，工具层由 plugin 注册 |
| `src/host/http/**` | 只能依赖下层模块，不能依赖 tools/plugin |

### 5.6 关键入口与加载时序

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 包入口：`export { inject, apply } from './src/host/plugin.js'` |
| `src/host/plugin.js` | `inject = ['tools', 'webServer', 'workspaceRegistry']`；`apply(ctx)` 注册 HTTP prefix `/dsh-devbench`、两组 Agent 工具、重启后任务恢复 |
| `cordis.patch.yml` | DSH bundle patch：`insert: { id: devbench-manager, name: dsh-devbench-plugin }`(loader id: devbench-manager) |
| `src/client/entry.js` | 浏览器入口：`window.__ModuleLoader__.load({ id: __PLUGIN_ID__, factory })` |
| `src/client/plugin.js` | `createPlugin()`：声明 `inject`、注册 3 个 slot（`main` / `sidebar.panellist` / `conversation.session.header.actions`）、注册中英文字典 |
| `dist/client.js` | 浏览器 bundle（构建产物，加载到 `__ModuleLoader__`） |
| `package.json` | `main`、`exports["./client"]`、`dsh.bundle.patch`、`dsh.client.*`、`engines` 的唯一来源 |

启动与加载时序：

1. DSH 启动时读取 profile 的 `dsh.profile.bundles`，加载安装包。
2. 包内 `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，其中 insert 行 `devbench-manager → dsh-devbench-plugin` 被应用。
3. Loader import 包入口 `index.js` → `src/host/plugin.js`，执行 `apply(ctx)`：注册 `/dsh-devbench` prefix 的 HTTP handler；注册 `requirement_read/update/list`、`project_commit_propose/review_write/git_show`；启动 `recoverInterruptedTasks()`（把重启前 `queued/running` 任务标记为 failed，`awaiting_confirmation` 保留）。
4. 浏览器加载 shell 时，client-modules 读取 `exports["./client"]`（`dist/client.js`）并注册 factory；`factory(require)` 只从基座取 `react`。
5. 插件被启用后 `createPlugin().apply(ctx)` 注册 slots：`main` → `RequirementsPage`（工作台主面板）；`sidebar.panellist` → 工作台图标；`conversation.session.header.actions` → 会话头部的「关联需求」。

任何 Host 改动都需要重启 DSH；Client 改动需要重新 `npm run build` 并刷新/重启（或依赖 DSH 的 HMR 重建流程）。

### 5.7 构建产物与包内容

| 产物 | 生成方式 | 说明 |
| --- | --- | --- |
| `dist/client.js` | `npm run build`（`scripts/build-client.mjs`） | esbuild 打包 `src/client/entry.js`：IIFE、`platform=browser`、`target=chrome100`、`react` 外置，并把 `package.json.name` 注入为 `__PLUGIN_ID__`；banner 写入包名与版本；**生成物，gitignore，不可手改** |
| `dist/release/*.tgz` + `manifest.json` | `npm run release:pack` | 打包前自动 build + preflight；清空目录后 `npm pack`，manifest 记录 sha256/sha512、git commit 与完整文件列表 |
| `dist/catalog/index.json` | `npm run release:catalog` | DSH 插件市场索引（format 1），供「发现 → 索引源」使用 |

npm 包内容由 `package.json.files` 白名单决定：`index.js`、`dist/client.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、`src/host`、`src/shared`、`README.md`、`LICENSE`；不包含 `test/`、`scripts/`、`src/client/`、`AGENTS.md` 等开发文件。`prepack` 会先 build + preflight，`prepublishOnly` 会再跑一次发布态 preflight。

### 5.8 代码地图速查

| 想找…… | 从这里开始 |
| --- | --- |
| 插件注册了什么 | `src/host/plugin.js`、`src/client/plugin.js` |
| 某条 API 怎么实现 | `src/host/http/routes/`（先看 `routes/index.js` 汇总） |
| 任务状态机 | `src/host/storage/tasks.js`、`src/host/services/background-agent.js` |
| 工作树逻辑 | `src/host/domain/worktrees.js`、`src/host/services/project-worktrees.js` |
| 概览工作区面板 / 手动提交/拉取/推送 | `src/host/services/project-git-ops.js`、`src/client/views/project/workspace-changes.js` |
| 提交提示词模板 | `src/host/constants.js`、`src/host/prompts/project.js`、`src/host/services/project-service.js`、`src/host/services/project-worktrees.js`、`src/client/views/settings.js` |
| 需求文档格式 | `src/host/domain/requirement-document.js` |
| 需求列表检索 | `src/host/services/requirement-search.js`、`src/client/views/project/requirements.js` |
| 前端页面骨架 | `src/client/views/requirements-page.js` → `src/client/views/project/devbench.js` |
| 设计系统与样式 | `src/client/ui/styles.js`、`src/client/ui/styles-project.js` |
| 提示词模板 | `src/host/constants.js`、`src/host/prompts/` |
| 发布链路 | `scripts/release/`、`.github/workflows/` |

---

## 6. 开发与发布

> 本章只保留命令概要；分层约束、测试组织、提交规范、分支策略与发布检查清单等详细规范见 [AGENTS.md](AGENTS.md)。

### 6.1 环境要求

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20.18.1（推荐 24.x，CI 与 DSH Desktop 均使用 24） | 插件本身无运行时依赖 |
| npm | ≥ 10 | 构建、测试、打包、发布 |
| DSH | `>=0.2.1-rc.3 <0.3.0-0` | 开发期用于 link 安装和真实启动验证 |
| Git | 任意现代版本 | Host 会调用 `git` 子进程；测试也会创建临时仓库 |

### 6.2 常用命令

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

### 6.3 本地开发与调试

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

### 6.4 发布链路

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

## 7. 数据与安全

- 数据位置、备份与卸载保留策略见 4.5；用户视角的权限、安全与隐私说明见 4.7。
- 插件不上传任何数据；AI 调用由 DSH 的模型配置决定（沿用当前会话的模型）。
- Git 提交/推送由用户明确触发；不会自动 push、不会创建 PR。

### 7.1 实现层安全模型

| 面 | 机制 |
| --- | --- |
| HTTP 访问 | 仅监听 DSH 注入的 webServer；`assertTrusted` 校验 Host/Origin 为本机回环；所有请求必须带 `x-dsh-devbench` 请求头；`/dsh-devbench` prefix 隔离 |
| 请求体 | `readJsonBody` 限制 8 MiB、必须是 JSON 对象、字段长度白名单 |
| 路径 | `path-safety` 拒绝符号链接穿越、`..`、非绝对 rootDir；需求/资料操作必须在 rootDir 内；worktree 必须在 worktreeRoot 内 |
| 子进程 | `execFile('git', [...])` 传参数组，不使用 shell 拼接；超时与输出上限；网络类操作 `GIT_TERMINAL_PROMPT=0` 快速失败并对输出凭据脱敏 |
| 并发 | 原子写（tmp + rename）+ 文件锁/工作区锁/任务锁；提交确认二次校验（HEAD、变更集、blob 哈希）防 TOCTOU |
| Agent | 后台任务工具 restricted；评审 Agent 只读；需求工具只能改正文与有限状态 |
| 数据 | 需求根目录与配置目录都不在代码仓库内；`.dsh-reviews` 写入项目 `.git/info/exclude` |
| 依赖脚本 | 插件自身无运行时依赖；浏览器只 require 基座 `react`，不加 `dsh.client.external` |

### 7.2 备份与清理

- **备份**：复制 `~/.dsh-devbench/` 和需求根目录即可；worktree 目录可以丢弃（分支在项目仓库里）。
- **卸载**：只移除插件包与 bundle 选择，不删除配置、需求文档、任务、Git 仓库与评审文件。
- **彻底清理**：手工删除 `~/.dsh-devbench/`、需求根目录与项目内 `.dsh-reviews/`；需求资料文件的删除是硬删除，不可撤销。

---

## 8. 已知限制（速览）

完整清单见 4.11；以下是发布与验收视角最常被关注的几条：

- 自动化测试覆盖 Host 与 Client，但真实 Desktop 的完整手工验收仍需在发布前按发布流程执行（见 [AGENTS.md](AGENTS.md)）。
- 窄屏（< 900px）未提供完整的列表/详情二级切换。
- 需求为软删除，暂无恢复入口；资料文件删除不可撤销。
- AI 生成的提交信息与评审内容可能与实际 diff 不符，必须人工确认后才能提交/落库。
- 后台任务在 Host 进程内运行，DSH 重启会把排队/执行中的任务标记为失败。
- 工作树分支不会自动合并回主分支，也不创建 PR。

---

## 9. 许可证

[MIT](LICENSE) © DSH DevBench Plugin contributors
