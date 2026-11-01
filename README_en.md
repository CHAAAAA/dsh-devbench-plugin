# DSH DevBench

**dsh-devbench-plugin** is a project and engineering management plugin for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH). Using DSH workspaces as its project source, it brings requirements, project documents, Git commits, AI-generated commit messages, code reviews, worktrees, background tasks, and weekly reports together into one sidebar workbench.

[中文版](README.md)

| Item | Value |
| --- | --- |
| Package | `dsh-devbench-plugin` |
| Version | **1.0.6** |
| DSH compatibility | `>=0.2.1-rc.3 <0.3.0-0` |
| Node.js | >= 24.9.0 |
| License | MIT |

## Features

- **Project workbench**: a three-pane master-detail layout (project tree, list, detail) with Overview, Requirements, Documents, Commits, Worktrees, Reviews, and Tasks tabs, plus breadcrumbs and view history.
- **Requirements**: Markdown requirements per workspace with title, status, body, attachment files, related sessions, and related commits. The list supports title and full-text search (full-text matches show a body snippet), draft recovery, an unsaved-changes guard, and save conflict handling.
- **Project documents**: every project has a **Documents** tab for simple notes such as release procedures or reusable prompts. Documents are stored as Markdown files in the `.documents/` directory of the project's directory inside the requirements root directory, so they never enter the project repository. The list shows titles only and supports title and full-text search; editing uses the same Markdown editor with live preview as requirements.
- **Requirement favorites**: star a requirement from the list or the detail view and turn on **Favorites only** to filter the list.
- **Requirement execution**: create a session from a requirement with a templated prompt, then automatically link and open it on success; show an error if creation fails. Optionally run each requirement in its own Git worktree (branch `devbench/<requirement ID>`).
- **AI commits**: a background agent drafts a Conventional Commit message (Chinese by default); review the preview before committing. Nothing is pushed automatically, and the commit prompt template is configurable in Settings.
- **Git operations**: the project Overview lists uncommitted changes and supports manual commits, pull (`--ff-only`), and push (with upstream setup).
- **Code reviews**: review any commit (full commit message, changed-file tree, and per-file diff) or the current uncommitted changes; review files are written to `.dsh-reviews/`.
- **Worktrees**: a three-state list (created / directory missing / enabled but not created) with create, view changes, AI commit, push, open in VS Code, terminal, or file manager, copy path and branch, clean up stale registrations, and delete (keeping the branch).
- **Task center**: status, cancel, retry, and open session for commit, review, and requirement tasks. Invalid task fields report tasks as unavailable while preserving the original file; missing or `null` optional fields in older records remain supported.
- **Home and weekly reports**: recent and unfinished tasks across projects, a locally generated weekly report, and an overview of the MCP services in the current DSH profile.
- **Version check and upgrade**: when the plugin starts, it checks the latest version on npm. A newer release adds an upgrade button in the top-right corner of the plugin page; clicking it installs the latest version through the current DSH profile's package manager, and a DSH restart activates it. The **About plugin** panel on the home page shows the current version, latest version, upgrade status, and project URL.
- **MCP service management**: view, add, edit, enable or disable, and remove MCP entries of the current DSH profile. Writes go to that profile's `cordis.patch.yml` with an automatic backup, and suspected secrets are masked.
- **Session linking**: link the current session to a requirement from the session header, or jump back to it.
- **Agent tools**: six tools (`requirement_read/update/list`, `project_commit_propose/git_show/review_write`) that let agents read and write requirements, commit messages, and reviews.

## Installation

### DSH plugin page (recommended)

1. Open the DSH **Plugins** page (in some versions it is under **Settings → Plugins**).
2. Click **Add plugin**.
3. Enter the package name and exact version: `dsh-devbench-plugin@1.0.6`.
4. Wait for the installation to finish, then click **Enable**.
5. If prompted to restart, fully quit and reopen DSH (do not just close the window).

### CLI

```sh
dsh plugin --profile web add dsh-devbench-plugin@1.0.6
```

### Offline tarball

Install a release tarball by its absolute path:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-devbench-plugin-1.0.6.tgz
```

Keep the tarball file: the profile dependency records its `file:` absolute path.

## Version and upgrades

- When the plugin starts (and whenever the plugin page is opened) it asks npm for the latest `dsh-devbench-plugin` version. The answer is cached for 30 minutes, and the **About plugin** panel on the home page offers a manual **Check for updates** action.
- When a newer version exists, the top-right corner of the plugin page shows an **Upgrade to vX** button. After confirmation the launcher-provided package manager runs `add <name>@<version> --save-exact` in the current DSH profile directory without unloading the running plugin; restart DSH afterwards to activate the new version.
- A local development copy installed with `link:` cannot upgrade itself (the button is disabled and names the development mode). Install from npm instead to use this feature.
- When automatic upgrading is unavailable (for example the host exposes no profile directory or package manager), the upgrade button is disabled and the UI explains why. Upgrading only changes the current DSH profile's dependencies and leaves other profiles untouched.

## First use

1. Open **Settings → Requirements root directory** and select or create the directory that stores requirement and document data.
2. Open **DevBench** in the sidebar, add a local Git repository as a project, and start working in its tabs.

## Development and collaboration

The source code is TypeScript. Development requires Node.js >= 24.9.0 and `npm ci` (which builds `dist/` automatically). After changing host code, run `npm run build` and restart DSH; after changing client code, run `npm run build` and refresh the browser.

Development, testing, and release conventions are documented in [AGENTS.md](AGENTS.md).

HTTP requests and responses share DTO types, and the client retains the host React library's official Hook types. UI tests use React, ReactDOM, and happy-dom with DOM events and mocked API responses; test dependencies are excluded from release artifacts.

`npm run typecheck` checks Host, Client, and test environments separately; CI covers Node.js 24.9.0 and 24. To prepare a local release, run `npm run check`, `npm run release:pack -- --skip-build`, `npm run release:smoke`, and `npm run release:publish` in order. The last command validates and previews the existing tested tarball by default; only an explicit `-- --yes` enables publishing checks and uploads it. Repack and verify again after changing the artifact.

Alternatively, push a `v<version>` tag matching the package version to publish through CI. Choose either local or CI publishing: do not push a release tag after publishing the same version locally.

## License

[MIT](LICENSE) © DSH DevBench Plugin contributors
