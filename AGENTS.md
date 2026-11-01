# AGENTS.md — 开发与协作指南

本文件只保留协作规则、架构约束与验证要求；产品功能和安装使用见 [README.md](./README.md)（中文，默认）与 [README_en.md](./README_en.md)（英文）。

## 1. 协作约定

1. 使用中文回复；先核对代码与脚本，仍不确定的需求、范围或行为向用户确认，不猜测。
2. 开始前检查 `git status` 与相关调用方，保留用户已有改动；只修改任务涉及的文件，不顺带重构。
3. 未经明确要求，不执行 `git commit`、`git push`、创建 tag 或实际发布。
4. 优先复用现有实现，以可读性为主；避免过度抽象、封装、拆分和新增依赖。
5. 完成后无需自动打开浏览器或进行视觉检查，用户明确要求时再执行。
6. 评审结论逐条编号，附文件位置、影响与建议，便于按编号反馈。
7. 交付时简述改动、验证结果和未验证项；任务中新建的测试用例验证后删除，保留仓库已有测试。

## 2. 项目与分层

**dsh-devbench-plugin（DSH DevBench）** 是以 DSH workspace 为项目来源的两端插件。Host 运行于 Node.js 插件进程，Client 通过 `__ModuleLoader__` 与 slots 接入浏览器。两端通过 HTTP 通信，共享 `src/shared/protocol.ts` 中的常量与 `src/shared/api-types.ts` 中的 DTO；版本与兼容范围以 `package.json` 为准。

```text
Host:   plugin → http/tools → services → domain → storage/integrations/platform
Client: entry → plugin → views → ui → core → runtime
```

- 包入口：源码 `src/index.ts`（re-export `src/host/plugin.ts` 的 `inject`/`apply`），`npm run build:host` 用 tsc 编译到 `dist/index.js`；`main` 与 `exports["."]` 指向 `dist/index.js`，`exports["./client"]` 指向 esbuild 打包出的 `dist/client.js`。发布包只含编译产物，不含 `src/`。
- 分层以 `eslint.config.ts` 为准（ESLint 经 `jiti` 加载该 TS 配置）；越界时移动代码，不用 `eslint-disable` 或放宽规则绕过。
- Client 不导入 Host 或 Node 模块；`src/shared` 只放跨端协议常量与纯类型，不依赖 Node、React 或业务实现。
- `messages`、`i18n` 只放字典；Host `shared` 放底层工具，`prompts` 放提示词模板；Client `ui` 不依赖 `views`，`core` 不依赖 UI。

| 改动 | 主要落点与联动 |
| --- | --- |
| Host 装配 / Agent 工具 | `src/host/plugin.ts` / `src/host/tools/`；包入口源码 `src/index.ts`，发布产物 `dist/index.js` |
| HTTP 接口 | `src/host/http/routes/` → `routes/index.ts` → `src/client/core/api.ts`，同步 `src/shared/api-types.ts` |
| 业务 / 存储 / Git | `src/host/services/`、`domain/`、`storage/`、`integrations/git.ts` |
| Client 入口 / 界面 | `src/client/entry.ts`、`plugin.ts`；页面在 `views/`，复用组件在 `ui/`，纯逻辑在 `core/` |
| 配置项 | `src/host/storage/config.ts`、`src/host/http/routes/config.ts`、`src/client/views/settings.ts`、README.md / README_en.md |
| 文案 | `src/host/messages/`、`src/client/i18n/`；插件页元数据在 `locale/{zh,en}.json` |
| 构建 / 发布检查 | `scripts/build-host.ts`、`scripts/build-client.ts`、`scripts/lib/preflight.ts`、`scripts/lib/pack.ts`、`scripts/release/` |

## 3. 核心约束

- **包与依赖**：包名 `dsh-devbench-plugin` 必须在 `package.json`、`cordis.patch.yml` 和构建注入的 module id 中一致；`main`/`exports` 只指向 `dist/` 编译产物；包名或版本调整同步 `package-lock.json`。不新增运行态 `dependencies`，浏览器 bundle 只 external `react`；基座模块接入先确认 `dsh.client.inject` 契约并跑 preflight。
- **稳定标识不得改**：统一引用现有常量，保持以下安装、路由与数据契约：
  - loader id、effect 名称与日志前缀：`devbench-manager` / `devbench-manager:*`。
  - 路由 `/dsh-devbench`、API `/dsh-devbench/api`、请求头 `x-dsh-devbench`。
  - 配置目录 `~/.dsh-devbench`、项目元数据目录 `.dsh-devbench`、环境变量 `DSH_DEVBENCH_CONFIG_DIR`。
  - 旧目录 `~/.dsh-requirements`、`.dsh-requirements`，旧变量 `DSH_REQUIREMENTS_CONFIG_DIR` 和旧分支 `dsh-req/*` 仅用于迁移与兼容，不得恢复为当前标识。
- **生成物不手改**：`dist/client.js`（`build:client` 经 esbuild 打包）与 `dist/host/**`、`dist/shared/**`（`build:host` 经 tsc 编译）由 `npm run build` 生成；`src/host/messages/index.ts` 由 `npm run messages:check -- --write` 生成；`dist/` 不提交。
- **源码类型**：`src/`、`scripts/`、`test/` 只保留 `.ts`，不新增 `.js`/`.mjs`/`.cjs`；ESLint 配置为 `eslint.config.ts`（经 `jiti` 加载），TS 按 Host、Client 与测试分别检查，构建配置为 `tsconfig.build.json`。
- **HTTP 与错误码**：API 必须经过 `assertTrusted`：请求头值为 `1`，Host 为回环地址；Origin 存在时也必须为回环地址且 host/port 与 Host 一致。错误使用 `apiError(status, kebab-case-code, message)`，不改变已发布错误码及语义。
- **路径与子进程**：路径校验复用 `src/host/shared/path-safety.ts`，保持绝对根目录、realpath 与符号链接边界校验，拒绝路径穿越。Host 子进程用 `execFile(cmd, args)`，禁止拼接 shell；Git 复用 `integrations/git.ts`，设置超时，网络操作设 `GIT_TERMINAL_PROMPT=0`，错误输出脱敏。
- **持久化**：复用 `src/host/shared/atomic.ts` 的原子写入与现有锁，保留损坏检测、冲突处理和任务恢复逻辑；锁只保证单进程内串行，不作为跨进程互斥。
- **文案同步**：Host 使用 `messages.KEY`；Client 中英文字典同步修改；`locale/*.json` 的 `meta.title/description` 必须非空。

## 4. TypeScript 约定

- **模块体系**：`tsconfig.json` 的 `module`/`moduleResolution` 为 `NodeNext`，源码保持 ESM。源码中的 `import` 说明符写编译后的 `.js` 路径（如 `from './host/plugin.js'`），实际文件是 `.ts`；tsc 与 tsx 都按此解析，不要写 `.ts` 说明符。脚本与测试引用源码时同样使用 `.js` 说明符。
- **编译边界**：`tsconfig.build.json` 继承 `tsconfig.json` 并设 `rootDir=src`、`outDir=dist`、`noEmitOnError=true`，只编译 `src/index.ts`、`src/host/**/*.ts`、`src/shared/**/*.ts`，由 `scripts/build-host.ts` 先清理旧产物再调用 tsc；Client 不参与 tsc，由 `scripts/build-client.ts` 用 esbuild 把 `src/client/entry.ts` 打包为 `dist/client.js`。
- **类型检查**：`npm run typecheck` 依次检查 `tsconfig.json`（Host、shared、脚本及 ESLint 配置，仅 Node 类型）、`tsconfig.client.json`（Client 与 shared，仅 DOM 类型）和 `tsconfig.test.json`（测试需要的 Node 与 DOM 类型）。测试的混合环境不能替代两端独立检查；类型问题不靠 lint 兜底。
- **Node 兼容性**：`@types/node` 对齐最低支持的 Node 大版本；CI 同时检查最低支持版本与主要使用版本，发布任务保持单一版本。提高 `engines.node` 下限属于兼容范围变更。
- **宽松迁移期**：`tsconfig.json` 当前为 `strict: false`、`noImplicitAny: false`、`useUnknownInCatchVariables: false`，属迁移期过渡状态，不是长期目标。新增或修改的导出函数应标注参数与返回值，避免引入新的 `any` 扩散与无意义断言；改动的代码不依赖宽松开关，随迁移推进逐步收紧（先 `noImplicitAny`，再 `strict`）。
- **类型边界**：React 绑定保留官方 Hook 签名；Host 与 Client Context 只声明插件实际使用且已核对的宿主契约。HTTP DTO 在 shared 中统一定义，Host 输出与 Client 调用使用同一类型；DTO 不能替代请求、路径与持久化数据的运行时校验。
- **禁止项**：禁止 `@ts-nocheck`；不要用 `eslint-disable` 绕过类型或分层问题。浏览器全局（`__PLUGIN_ID__`、`__ModuleLoader__`）在 `src/client/env.d.ts` 声明，新增全局需同步该文件。
- **运行方式**：脚本（`scripts/**`）与测试（`test/**`）全部是 `.ts`，用 `tsx` 直接执行（`npm run build:client`、`npm run messages:check`、`npm run release:*`、`node --import tsx --test ...`）；发布包只含 `dist/` 编译产物，不含任何 `.ts`。

## 5. 开发与验证

| 命令 | 用途与时机 |
| --- | --- |
| `npm ci` | 安装开发依赖，自动执行 build；新开发 worktree 也需要安装 |
| `npm run build` | `build:host` + `build:client`，生成 `dist/index.js`、`dist/host/**`、`dist/shared/**` 与 `dist/client.js` |
| `npm run build:host` | `tsx scripts/build-host.ts`：先清空 `dist/index.js`、`dist/host`、`dist/shared`，再执行 `tsc -p tsconfig.build.json`，类型错误即失败 |
| `npm run build:client` | `tsx scripts/build-client.ts`，只打包浏览器 bundle |
| `npm run typecheck` | 分别检查 Host、Client 和测试的类型环境，覆盖 `src/`、`test/`、`scripts/` 与 ESLint 配置 |
| `npm run lint` | 校验语法与分层；`lint:fix` 自动修复后仍需复查 |
| `npm run messages:check` | 校验 Host 文案 key 与生成索引；`-- --write` 重新生成 `src/host/messages/index.ts` |
| `npm test` | 自动先 `build`，再用 `node --import tsx --test` 运行 Host / Client 的 `node:test` 用例 |
| `node --import tsx --test test/host/<name>.test.ts` | 定向运行 Host 测试；单独跑 Client 测试前先 build |
| `npm run check` | `lint` → `typecheck` → `messages:check` → `test`；提交前必跑 |

- **生效方式**：宿主 TS 改动必须 `npm run build` 后重启 DSH；Client 改动 `npm run build` 后刷新浏览器；共享协议同时影响两端，需 build 并重启。
- 按改动范围验证；纯文档改动检查差异、链接与命令准确性即可。代码改动运行相关检查，失败未解决时不得声称通过。
- 修 bug 先用临时测试复现失败，再修复并验证通过。Host 复用 `test/host/helpers.ts` 的 `createHarness()` 与 `request()`，覆盖主链路及错误码；Git 夹具见 `project-helpers.ts`，后台 Agent 夹具见 `fake-agents.ts`。
- Client 渲染使用 React、ReactDOM 与 happy-dom，复用 `test/client/helpers.ts`，通过 DOM 事件与 HTTP fixture 驱动，不读取或设置 Hook 索引；这些库仅为开发依赖。纯函数、字典对齐和 bundle 契约参考 `client.test.ts`（会读取 `dist/client.js`，需先 build），不要用源码字符串断言代替行为验证。
- 测试不访问网络或真实 `~/.dsh`、`~/.dsh-devbench`。使用 `mkdtemp` 与 `DSH_DEVBENCH_CONFIG_DIR` 隔离，Git 夹具显式设置 `user.name/user.email`，结束时关闭 harness、清理临时目录。
- 禁止固定 sleep 等待任务；复用 `waitForTaskStatus`、`waitForBackgroundTask`、`waitForRequirementTask`、`waitForTaskRecovery` 或有超时的条件轮询。测试文件并发执行，不共享可变状态；同进程共享环境变量时，先关闭前一个 harness。
- 不绕过项目脚本手工替代构建或发布门禁；修改脚本后运行对应命令验证，不提交临时产物、本机绝对路径或凭据。

## 6. 文档与提交

- 只维护 `README.md`（产品与使用，默认中文）、`README_en.md`（README 英文版）和 `AGENTS.md`（协作与开发）；不新增 `docs/`、CHANGELOG、设计文档、验证记录等第三份文档，也不引用已删除的文档。
- 用户可见行为变化必须同步更新 `README.md` 与 `README_en.md`，包括功能、设置、数据位置、错误提示和安装方式；两文件内容保持一一对应。两份 README 均随 npm 包发布，AGENTS.md 不打包。
- 版本号升级时同步更新所有文档中的版本表述：README 版本表、安装命令（`@<version>`）与 tarball 文件名示例等，避免文档版本与 `package.json.version` 不一致；`package.json.version` 是唯一版本来源。
- 本文件只记录长期有效的规则；合并重复内容，避免维护文件数量、完整目录树与脚本实现细节。
- 用户要求提交时，使用中文 Conventional Commits：`<type>(<scope>): <简短摘要>`，并添加 `Co-authored-by: Codex <codex@pku.edu.cn>`。一个提交只做一件事；PR 说明改动、原因、验证与兼容影响。
- 用户要求新建分支时，从 `main` 创建 `feat/<topic>`、`fix/<topic>`、`docs/<topic>`、`refactor/<topic>` 或 `release/<version>`；遵循用户指定的分支名。

## 7. 发布

使用项目脚本，按以下顺序执行；实际发布及推送 tag 须有用户明确要求：

```sh
npm run check
npm run release:pack -- --skip-build
npm run release:smoke
npm run release:publish    # 校验现有产物并预览；-- --yes 才实际发布并创建本地 tag
npm run release:catalog    # 发布成功后生成索引；未发布预览用 -- --local
```

- `preflight` 校验包身份、DSH 清单、bundle 契约、`dist/` 构建产物（存在且比源码新）与 tarball 内容；会拒绝 `.ts` 源文件与 `src/` 进入包。正式发布前执行 `npm run release:preflight -- --publish --registry-check`：`--publish` 检查 git 干净、tag 未占用和 npm 登录，`--registry-check` 查询版本占用。失败阻断，警告需确认；`verify:publish` 是其别名。
- `pack` 会清空 `dist/release/`，生成 tarball 和 `manifest.json`，逐项校验编译产物是否完整入包；默认先构建，`check` 成功后可用 `--skip-build` 复用产物。包内文件固定为 `dist/index.js`、`dist/client.js`、`dist/host/**`、`dist/shared/**`、`cordis.patch.yml`、`locale/*.json`、`icon.svg`、README 与 LICENSE；不得混入 `src/`、`test/`、`scripts/`、`.github/` 与任何 `.ts`。
- `publish`（包括 dry-run）只消费现有 tarball 和 manifest，核对包名、版本、Git HEAD 与原始字节校验和，不重建或覆盖产物。实际发布时自动执行 git、tag、npm 登录及版本占用门禁；产物不匹配时重新 pack 并重新 smoke。
- 直接使用 npm 时，`prepack`（`build` + `preflight`）与 `prepublishOnly`（`preflight --publish`）由 npm 自动触发。项目发布脚本会显式执行相同门禁后对既有 tarball 使用 `--ignore-scripts`，防止生命周期重新构建；不要在脚本外手工跳过门禁。
- `smoke` 在临时 `DSH_HOME` 中安装、校验并卸载；可指定 `-- --cli <path>`、`-- --tarball <path>`，不操作真实 profile。
- `publish -- --yes` 会发布到 npm、核对 integrity 并创建本地 `v<version>` tag（`--no-tag` 可跳过）；稳定版用 `latest`，预发布用 `next`。版本不可复用，历史由 tag / GitHub Release 记录。`--allow-existing-version` 仅用于 CI 部分失败后的续跑：版本已发布且 registry 上的 tarball 校验和与本地产物一致时跳过上传、继续后续步骤，不一致则阻断。
- `.github/workflows/ci.yml` 通过 `npm run check` 执行检查，再复用构建产物打包；推送 `v*` tag 会触发 `release.yml`，使用同一发布脚本并传入 `--yes --no-tag --allow-existing-tag --allow-existing-version --provenance`，需要 `NPM_TOKEN` 与 `npm-publish` environment。**本地发布与 CI 发布二选一；本地已发布的版本不要再推送 tag 触发重复发布**。

## 8. 易错点

- **构建产物**：改完宿主或共享协议却未 `npm run build`，`dist/index.js`、`dist/host/**`、`dist/shared/**` 仍是旧产物，DSH 加载的就是旧代码；发布前 preflight 会因产物缺失或陈旧失败。
- **本地 link**：操作 Desktop profile 前完全退出 DSH，使用 Desktop 自带 CLI；包名或 checkout 路径变化后重新安装 link，并用 `plugin --profile desktop list` 确认依赖为 `link:` 记录。
- **工作树**：默认在 `~/.dsh-devbench/worktrees/`，可由配置覆盖；按 `devbench/<需求ID>`（兼容 `dsh-req/*`）和 Git 注册路径识别，不依赖目录名或 `../` 相对关系。开发 worktree 不共享 `node_modules/` 与 `dist/`，需要 `npm ci`（自动 build）后才能运行脚本、测试与构建。
- **加载与打包失败**：先检查 `main` / `exports["."]` 是否指向 `dist/index.js`、`exports["./client"]` 是否指向最新的 `dist/client.js`、是否执行过 `npm run build`、module id 与包名是否一致，再查看 preflight 输出及 `dist/release/manifest.json`。
