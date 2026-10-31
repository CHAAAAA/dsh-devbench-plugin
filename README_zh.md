# DSH DevBench

**dsh-devbench-plugin** 是 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）的项目与工程管理插件：以 DSH workspace 为项目来源，把需求、项目文档、Git 提交、AI 提交信息、代码评审、工作树、后台任务与周报聚合到一个侧边栏工作台里。

[English version](README.md)

| 项 | 值 |
| --- | --- |
| 包名 | `dsh-devbench-plugin` |
| 版本 | **1.0.3** |
| DSH 兼容 | `>=0.2.1-rc.3 <0.3.0-0` |
| Node.js | >= 20.18.1 |
| 许可证 | MIT |

## 功能

- **项目工作台**：三栏主从布局（项目树 · 列表 · 详情），包含概览、需求、文档、提交、工作树、评审与任务页签，并提供面包屑与视图历史。
- **需求管理**：按工作区保存 Markdown 需求（标题、状态、正文、资料文件、关联会话与关联提交）。需求列表支持「标题 / 全文」两档检索（全文命中显示正文片段），并支持草稿恢复、离开拦截与保存冲突处理。
- **项目文档**：每个项目都有一个「文档」页签，用于记录发布流程、常用提示词等简单文档。文档以 Markdown 文件保存在「需求根目录」下该项目目录的 `.documents/` 中，不会进入项目仓库。文件列表只显示标题，支持按标题与全文检索；编辑与需求一样使用 Markdown 编辑器并实时预览。
- **需求收藏**：在需求列表或详情页点击星标收藏需求，并可用「仅收藏」筛选列表。
- **需求执行**：从需求一键创建会话并发送模板化提示词；可为需求启用按需求 Git worktree（分支 `devbench/<需求ID>`）。
- **AI 提交**：后台 Agent 生成中文 Conventional Commit 提交信息，确认预览后提交；不会自动 push，提交提示词模板可在设置页修改。
- **Git 操作**：项目「概览」展示未提交变更，支持手动提交、拉取（`--ff-only`）与推送（自动建立 upstream）。
- **代码评审**：可对任意提交发起评审（完整提交消息、变更文件树与逐文件差异），也可评审当前未提交变更；评审文件写入 `.dsh-reviews/`。
- **工作树管理**：三态列表（已创建 / 目录缺失 / 已启用未创建），支持创建、查看改动、AI 提交、推送、用 VS Code / 终端 / 文件管理器打开、复制路径与分支、清理残留注册以及删除（保留分支）。
- **任务中心**：查看提交 / 评审 / 需求任务的状态，支持取消、重试与打开会话。
- **主页与周报**：跨项目的最近任务与未完成任务、本地生成的周报，以及当前 DSH profile 的 MCP 服务概览。
- **MCP 服务管理**：查看、添加、修改、启用/禁用或删除当前 DSH profile 的 MCP 条目。修改写入该 profile 的 `cordis.patch.yml` 并自动备份，疑似密钥以掩码显示。
- **会话关联**：在会话头部把当前会话关联到某个需求，或跳回需求。
- **Agent 工具**：`requirement_read/update/list`、`project_commit_propose/git_show/review_write` 共 6 个工具，让执行 Agent 读写需求、提交信息与评审。

## 安装

### DSH 插件页（推荐）

1. 打开 DSH 的「插件」页（部分版本位于「设置 → 插件」）。
2. 点「添加插件」。
3. 输入包名与精确版本：`dsh-devbench-plugin@1.0.3`。
4. 等待安装完成，点「立即启用」。
5. 如果提示需要重启，完全退出并重新打开 DSH（不要只关闭窗口）。

### CLI

```sh
dsh plugin --profile web add dsh-devbench-plugin@1.0.3
```

### 离线 tarball

用绝对路径安装发布的 tarball：

```sh
dsh plugin --profile web add /绝对路径/dsh-devbench-plugin-1.0.3.tgz
```

请保留 tarball 原文件：profile 依赖会记录它的 `file:` 绝对路径。

## 首次使用

1. 打开 **设置 → 需求根目录**，选择或新建用于保存需求与文档数据的目录。
2. 打开侧边栏的 **DevBench**，添加本地 Git 仓库作为项目，即可在对应页签中开始使用。

## 开发与协作

开发、测试与发布规范见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE) © DSH DevBench Plugin contributors
