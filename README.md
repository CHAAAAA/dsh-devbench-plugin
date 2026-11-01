# DSH DevBench

**dsh-devbench-plugin** is a project and engineering management plugin for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH). Using DSH workspaces as its project source, it brings requirements, project documents, Git commits, AI-generated commit messages, code reviews, worktrees, background tasks, and weekly reports together into one sidebar workbench.

[Chinese version](README_zh.md)

| Item | Value |
| --- | --- |
| Package | `dsh-devbench-plugin` |
| Version | **1.0.4** |
| DSH compatibility | `>=0.2.1-rc.3 <0.3.0-0` |
| Node.js | >= 20.18.1 |
| License | MIT |

## Features

- **Project workbench**: a three-pane master-detail layout (project tree, list, detail) with Overview, Requirements, Documents, Commits, Worktrees, Reviews, and Tasks tabs, plus breadcrumbs and view history.
- **Requirements**: Markdown requirements per workspace with title, status, body, attachment files, related sessions, and related commits. The list supports title and full-text search (full-text matches show a body snippet), draft recovery, an unsaved-changes guard, and save conflict handling.
- **Project documents**: every project has a **Documents** tab for simple notes such as release procedures or reusable prompts. Documents are stored as Markdown files in the `.documents/` directory of the project's directory inside the requirements root directory, so they never enter the project repository. The list shows titles only and supports title and full-text search; editing uses the same Markdown editor with live preview as requirements.
- **Requirement favorites**: star a requirement from the list or the detail view and turn on **Favorites only** to filter the list.
- **Requirement execution**: create a session from a requirement with a templated prompt; optionally run each requirement in its own Git worktree (branch `devbench/<requirement ID>`).
- **AI commits**: a background agent drafts a Conventional Commit message (Chinese by default); review the preview before committing. Nothing is pushed automatically, and the commit prompt template is configurable in Settings.
- **Git operations**: the project Overview lists uncommitted changes and supports manual commits, pull (`--ff-only`), and push (with upstream setup).
- **Code reviews**: review any commit (full commit message, changed-file tree, and per-file diff) or the current uncommitted changes; review files are written to `.dsh-reviews/`.
- **Worktrees**: a three-state list (created / directory missing / enabled but not created) with create, view changes, AI commit, push, open in VS Code, terminal, or file manager, copy path and branch, clean up stale registrations, and delete (keeping the branch).
- **Task center**: status, cancel, retry, and open session for commit, review, and requirement tasks.
- **Home and weekly reports**: recent and unfinished tasks across projects, a locally generated weekly report, and an overview of the MCP services in the current DSH profile.
- **MCP service management**: view, add, edit, enable or disable, and remove MCP entries of the current DSH profile. Writes go to that profile's `cordis.patch.yml` with an automatic backup, and suspected secrets are masked.
- **Session linking**: link the current session to a requirement from the session header, or jump back to it.
- **Agent tools**: six tools (`requirement_read/update/list`, `project_commit_propose/git_show/review_write`) that let agents read and write requirements, commit messages, and reviews.

## Installation

### DSH plugin page (recommended)

1. Open the DSH **Plugins** page (in some versions it is under **Settings → Plugins**).
2. Click **Add plugin**.
3. Enter the package name and exact version: `dsh-devbench-plugin@1.0.4`.
4. Wait for the installation to finish, then click **Enable**.
5. If prompted to restart, fully quit and reopen DSH (do not just close the window).

### CLI

```sh
dsh plugin --profile web add dsh-devbench-plugin@1.0.4
```

### Offline tarball

Install a release tarball by its absolute path:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-devbench-plugin-1.0.4.tgz
```

Keep the tarball file: the profile dependency records its `file:` absolute path.

## First use

1. Open **Settings → Requirements root directory** and select or create the directory that stores requirement and document data.
2. Open **DevBench** in the sidebar, add a local Git repository as a project, and start working in its tabs.

## Development and collaboration

The source code is TypeScript. Development requires Node.js >= 20.18.1 and `npm ci` (which builds `dist/` automatically). After changing host code, run `npm run build` and restart DSH; after changing client code, run `npm run build` and refresh the browser.

Development, testing, and release conventions are documented in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © DSH DevBench Plugin contributors
