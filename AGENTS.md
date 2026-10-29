# AGENTS.md — 开发与协作指南

本文件只保留协作规则、架构约束与验证要求；产品功能和安装使用见 [README.md](./README.md)。

## 1. 协作约定

1. 使用中文回复；先核对代码与脚本，仍不确定的需求、范围或行为向用户确认，不猜测。
2. 开始前检查 `git status` 与相关调用方，保留用户已有改动；只修改任务涉及的文件，不顺带重构。
3. 未经明确要求，不执行 `git commit`、`git push`、创建 tag 或实际发布。
4. 优先复用现有实现，以可读性为主；避免过度抽象、封装、拆分和新增依赖。
5. 完成后无需自动打开浏览器或进行视觉检查，用户明确要求时再执行。
6. 评审结论逐条编号，附文件位置、影响与建议，便于按编号反馈。
7. 交付时简述改动、验证结果和未验证项；任务中新建的测试用例验证后删除，保留仓库已有测试。

## 2. 项目与分层

**dsh-devbench-plugin（DSH DevBench）** 是以 DSH workspace 为项目来源的两端插件。Host 运行于 Node.js 插件进程，Client 通过 `__ModuleLoader__` 与 slots 接入浏览器。两端通过 HTTP 通信，只共享 `src/shared/protocol.js`；版本与兼容范围以 `package.json` 为准。

```text
Host:   plugin → http/tools → services → domain → storage/integrations/platform
Client: entry → plugin → views → ui → core → runtime
```

- 分层以 `eslint.config.js` 为准；越界时移动代码，不用 `eslint-disable` 或放宽规则绕过。
- Client 不导入 Host 或 Node 模块；`src/shared` 只放跨端常量，不依赖 Node、React 或业务模块。
- `messages`、`i18n` 只放字典；Host `shared` 放底层工具，`prompts` 放提示词模板；Client `ui` 不依赖 `views`，`core` 不依赖 UI。

| 改动 | 主要落点与联动 |
| --- | --- |
| Host 装配 / Agent 工具 | `src/host/plugin.js` / `src/host/tools/`；包入口为 `index.js` |
| HTTP 接口 | `src/host/http/routes/` → `routes/index.js` → `src/client/core/api.js` |
| 业务 / 存储 / Git | `src/host/services/`、`domain/`、`storage/`、`integrations/git.js` |
| Client 入口 / 界面 | `src/client/entry.js`、`plugin.js`；页面在 `views/`，复用组件在 `ui/`，纯逻辑在 `core/` |
| 配置项 | `src/host/storage/config.js`、`src/host/http/routes/config.js`、`src/client/views/settings.js`、README |
| 文案 | `src/host/messages/`、`src/client/i18n/`；插件页元数据在 `locale/{zh,en}.json` |
| 构建 / 发布检查 | `scripts/build-client.mjs`、`scripts/lib/preflight.mjs`、`scripts/lib/pack.mjs`、`scripts/release/` |

## 3. 核心约束

- **包与依赖**：包名 `dsh-devbench-plugin` 必须在 `package.json`、`cordis.patch.yml` 和构建注入的 module id 中一致；包名或版本调整同步 `package-lock.json`。不新增运行态 `dependencies`，浏览器 bundle 只 external `react`；基座模块接入先确认 `dsh.client.inject` 契约并跑 preflight。
- **稳定标识不得改**：统一引用现有常量，保持以下安装、路由与数据契约：
  - loader id、effect 名称与日志前缀：`devbench-manager` / `devbench-manager:*`。
  - 路由 `/dsh-devbench`、API `/dsh-devbench/api`、请求头 `x-dsh-devbench`。
  - 配置目录 `~/.dsh-devbench`、项目元数据目录 `.dsh-devbench`、环境变量 `DSH_DEVBENCH_CONFIG_DIR`。
  - 旧目录 `~/.dsh-requirements`、`.dsh-requirements`，旧变量 `DSH_REQUIREMENTS_CONFIG_DIR` 和旧分支 `dsh-req/*` 仅用于迁移与兼容，不得恢复为当前标识。
- **生成物不手改**：`dist/client.js` 用 `npm run build` 生成；`src/host/messages/index.js` 用 `npm run messages:check -- --write` 生成；`dist/` 不提交。
- **HTTP 与错误码**：API 必须经过 `assertTrusted`：请求头值为 `1`，Host 为回环地址；Origin 存在时也必须为回环地址且 host/port 与 Host 一致。错误使用 `apiError(status, kebab-case-code, message)`，不改变已发布错误码及语义。
- **路径与子进程**：路径校验复用 `src/host/shared/path-safety.js`，保持绝对根目录、realpath 与符号链接边界校验，拒绝路径穿越。Host 子进程用 `execFile(cmd, args)`，禁止拼接 shell；Git 复用 `integrations/git.js`，设置超时，网络操作设 `GIT_TERMINAL_PROMPT=0`，错误输出脱敏。
- **持久化**：复用 `src/host/shared/atomic.js` 的原子写入与现有锁，保留损坏检测、冲突处理和任务恢复逻辑；锁只保证单进程内串行，不作为跨进程互斥。
- **文案同步**：Host 使用 `messages.KEY`；Client 中英文字典同步修改；`locale/*.json` 的 `meta.title/description` 必须非空。

## 4. 开发与验证

| 命令 | 用途与时机 |
| --- | --- |
| `npm ci` | 安装开发依赖，自动执行 build；新开发 worktree 也需要安装 |
| `npm run build` | 修改 Client 或共享协议后执行，生成 `dist/client.js` |
| `npm run lint` | 校验语法与分层；`lint:fix` 自动修复后仍需复查 |
| `npm run messages:check` | 校验 Host 文案 key 与生成索引 |
| `npm test` | 自动先 build，再运行 Host / Client 的 `node:test` 用例 |
| `node --test test/host/<name>.test.js` | 定向运行 Host 测试；单独跑 Client 测试前先 build |
| `npm run check` | lint → messages → build → tests；提交前必跑 |

- 按改动范围验证；纯文档改动检查差异、链接与命令准确性即可。代码改动运行相关检查，失败未解决时不得声称通过。
- 修 bug 先用临时测试复现失败，再修复并验证通过。Host 复用 `test/host/helpers.js` 的 `createHarness()` 与 `request()`，覆盖主链路及错误码；Git 夹具见 `project-helpers.js`，后台 Agent 夹具见 `fake-agents.js`。
- Client 渲染参考 `test/client/render-smoke.test.mjs`；纯函数、字典对齐和 bundle 契约参考 `client.test.mjs`。
- 测试不访问网络或真实 `~/.dsh`、`~/.dsh-devbench`。使用 `mkdtemp` 与 `DSH_DEVBENCH_CONFIG_DIR` 隔离，Git 夹具显式设置 `user.name/user.email`，结束时关闭 harness、清理临时目录。
- 禁止固定 sleep 等待任务；复用 `waitForTaskStatus`、`waitForBackgroundTask`、`waitForRequirementTask`、`waitForTaskRecovery` 或有超时的条件轮询。测试文件并发执行，不共享可变状态；同进程共享环境变量时，先关闭前一个 harness。
- 不绕过项目脚本手工替代构建或发布门禁；修改脚本后运行对应命令验证，不提交临时产物、本机绝对路径或凭据。

## 5. 文档与提交

- 只维护 `README.md`（产品与使用）和 `AGENTS.md`（协作与开发）；不新增 `docs/`、CHANGELOG、设计文档、验证记录等第三份文档，也不引用已删除的文档。
- 用户可见行为变化必须同步 README，包括功能、设置、数据位置、错误提示和安装方式。README 随 npm 包发布，AGENTS.md 不打包。
- 本文件只记录长期有效的规则；合并重复内容，避免维护文件数量、完整目录树与脚本实现细节。
- 用户要求提交时，使用中文 Conventional Commits：`<type>(<scope>): <简短摘要>`，并添加 `Co-authored-by: Codex <codex@pku.edu.cn>`。一个提交只做一件事；PR 说明改动、原因、验证与兼容影响。
- 用户要求新建分支时，从 `main` 创建 `feat/<topic>`、`fix/<topic>`、`docs/<topic>`、`refactor/<topic>` 或 `release/<version>`；遵循用户指定的分支名。

## 6. 发布

使用项目脚本，按以下顺序执行；实际发布及推送 tag 须有用户明确要求：

```sh
npm run check
npm run release:preflight
npm run release:pack
npm run release:smoke
npm run release:publish    # 默认 dry-run；-- --yes 才实际发布并创建本地 tag
npm run release:catalog    # 发布成功后生成索引；未发布预览用 -- --local
```

- `preflight` 校验包身份、DSH 清单、bundle 契约与 tarball 内容。正式发布前执行 `npm run release:preflight -- --publish --registry-check`：`--publish` 检查 git 干净、tag 未占用和 npm 登录，`--registry-check` 查询版本占用。失败阻断，警告需确认；`verify:publish` 是其别名。
- `pack` 会清空 `dist/release/`，生成 tarball 和 `manifest.json`；`publish` 的 dry-run 同样会重新构建、清空输出目录并打包。包内不得混入 `test/`、`scripts/`、`.github/`、`src/client/`。
- `smoke` 在临时 `DSH_HOME` 中安装、校验并卸载；可指定 `-- --cli <path>`、`-- --tarball <path>`，不操作真实 profile。
- `publish -- --yes` 会发布到 npm、核对 integrity 并创建本地 `v<version>` tag（`--no-tag` 可跳过）；稳定版用 `latest`，预发布用 `next`。版本不可复用，历史由 tag / GitHub Release 记录。
- `.github/workflows/ci.yml` 执行检查与打包；推送 `v*` tag 会触发 `release.yml` 实际发布到 npm，需要 `NPM_TOKEN` 与 `npm-publish` environment。**本地发布与 CI 发布不要对同一版本重复执行**。

## 7. 易错点

- **生效方式**：Host 或插件清单变更需重启 DSH；Client 变更先 build 再刷新；共享协议同时影响两端，需 build 并重启。
- **本地 link**：操作 Desktop profile 前完全退出 DSH，使用 Desktop 自带 CLI；包名或 checkout 路径变化后重新安装 link，具体步骤见 README。
- **工作树**：默认在 `~/.dsh-devbench/worktrees/`，可由配置覆盖；按 `devbench/<需求ID>`（兼容 `dsh-req/*`）和 Git 注册路径识别，不依赖目录名或 `../` 相对关系。开发 worktree 不共享 `node_modules/` 与 `dist/`。
- **加载与打包失败**：先检查 `exports["./client"]`、bundle 是否最新、module id 与包名是否一致，再查看 preflight 输出及 `dist/release/manifest.json`。
