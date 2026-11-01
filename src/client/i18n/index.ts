/** Generated Chinese/English dictionaries. Keys must remain aligned. */
// Generated from legacy client.js. Do not edit manually.
import { zh as zhTabs, en as enTabs } from './tabs.js'
import { zh as zhDetail, en as enDetail } from './detail.js'
import { zh as zhSafety, en as enSafety } from './safety.js'

export const zh = {
      'panel.title': '需求',
      'panel.refresh': '刷新',
      'panel.search': '搜索需求…',
      'panel.search.empty': '没有匹配的需求',
      'panel.expand': '展开显示（还有 {count} 个）',
      'panel.collapseAll': '全部折叠',
      'panel.expandAll': '全部展开',
      'panel.groupCollapse': '折叠该工作区',
      'panel.groupExpand': '展开该工作区',
      'panel.groupCollapsedHint': '该工作区需求已折叠',
      'panel.collapse': '收起',
      'detail.delete': '删除需求',
      'detail.deleted': '需求已从列表移除',
      'delete.requirement.running': '需求正在执行中，不能删除。',
      'project.requirements.delete': '删除需求',
      'project.requirements.deleting': '删除中…',
      'project.requirements.deleted': '需求已从列表移除，目录文件已保留',
      'delete.requirement.title': '删除需求',
      'delete.requirement.body': '将从需求列表中移除「{name}」。需求目录及其中所有文件会原样保留，不会被删除；此操作不会改动项目仓库。',
      'delete.requirement.sessions': '该需求关联了 {count} 个会话。需求文件夹会被保留，会话也不会被删除。',
      'panel.settings': '设置',
      'panel.close': '返回需求列表',
      'panel.unconfigured.title': '尚未设置需求根目录',
      'panel.unconfigured.body': '先选择一个本地目录作为需求根目录，插件会在其中按工作区存放 Markdown 需求文档，并可为它建立 Git 仓库。',
      'panel.unconfigured.action': '选择需求根目录',
      'panel.configured': '需求根目录',
      'panel.empty.workspace': '暂无需求',
      'panel.empty.all': '当前 DSH 还没有加入任何工作区',
      'panel.new': '新建需求',
      'panel.new.in.workspace': '在此工作区新建需求',
      'panel.welcome.title': '需求管理',
      'panel.welcome.body': '左侧选择工作区中的需求查看和编辑；也可以点击需求右上角的"执行"，在工作区中创建一个新会话并开始实现。',
      'panel.loading': '加载中…',
      'panel.error': '加载失败',
      'panel.retry': '重试',
      'panel.back': '返回',
      'status.new': '新建',
      'status.running': '执行中',
      'status.done': '已完成',
      'status.archived': '已归档',
      'status.cancelled': '已取消',
      'status.label': '状态',
      'detail.title': '标题',
      'detail.requirement': '需求正文',
      'detail.edit': '编辑',
      'detail.preview': '预览',
      'detail.save': '保存',
      'detail.saved': '已保存',
      'detail.saving': '保存中…',
      'detail.execute': '执行',
      'detail.execute.again': '再次执行',
      'detail.execute.hint': '在工作区中创建新会话并发送需求提示词',
      'detail.executing': '正在创建会话…',
      'detail.execute.needconfig': '请先设置需求根目录',
      'detail.sessions': '关联会话',
      'detail.sessions.empty': '还没有关联会话，点击"执行"开始。',
      'detail.session.open': '打开会话',
      'detail.session.unlink': '解除关联',
      'detail.session.running': '运行中',
      'detail.files': '资料文件',
      'detail.files.empty': '需求目录下还没有资料文件',
      'detail.files.newfile': '新建文件',
      'detail.files.newdir': '新建目录',
      'detail.files.upload': '在访达中打开',
      'detail.files.save': '保存文件',
      'detail.files.delete': '删除',
      'detail.files.name': '文件名（可含子目录，如 docs/deploy.md）',
      'detail.files.binary': '二进制文件，无法预览',
      'detail.files.open': '打开',
      'detail.git': 'Git 提交历史',
      'detail.git.empty': '暂无提交记录（需求根目录可能还不是 Git 仓库）',
      'detail.git.commit': '提交需求文档',
      'detail.git.nothing': '没有需要提交的变更',
      'detail.git.message': '提交说明',
      'detail.git.defaultMessage': 'chore(requirements): 更新需求文档',
      'detail.git.defaultMessageFor': 'chore(requirements): 更新需求 {id}',
      'detail.createdAt': '创建时间',
      'detail.updatedAt': '更新时间',
      'settings.title': '设置',
      'settings.root': '需求根目录',
      'settings.root.hint': '需求文档会按工作区保存在该目录下；建议为它单独建立 Git 仓库。',
      'settings.pick': '选择目录',
      'settings.root.open': '打开目录',
      'settings.save': '保存设置',
      'settings.saved': '设置已保存',
      'settings.template': '执行提示词模板',
      'settings.template.hint': '可用占位符：{workspaceTitle} {title} {id} {requirementPath} {folderPath} {body}',
      'settings.git': 'Git',
      'settings.git.initialized': '需求根目录已是 Git 仓库',
      'settings.git.notInitialized': '需求根目录还不是 Git 仓库',
      'settings.git.init': '初始化 Git 仓库',
      'settings.git.status': '工作区变更',
      'settings.git.clean': '没有未提交变更',
      'settings.git.changes': '个文件有变更',
      'settings.git.log': '最近提交',
      'settings.git.dirty': '有未提交变更',
      'settings.git.commit': '提交所有需求变更',
      'new.title': '新建需求',
      'new.name': '需求标题',
      'new.name.placeholder': '例如：新增需求管理插件',
      'new.body': '需求正文（可选，Markdown）',
      'new.body.placeholder': '可以之后再编辑；留空会生成一个初始模板。',
      'new.create': '创建',
      'new.creating': '创建中…',
      'link.title': '把当前会话关联到需求',
      'link.body': '选择当前会话要关联的需求；关联后可以在会话头部直接跳回需求编辑页。',
      'link.empty': '还没有可关联的需求',
      'link.cancel': '取消',
      'link.linked': '已关联',
      'link.action': '关联',
      'action.confirm': '确认',
      'action.cancel': '取消',
      'action.delete': '删除',
      'delete.confirm.title': '删除文件',
      'delete.confirm.body': '确定删除 {name} 吗？该操作不可恢复。',
      'archive.confirm.body': '归档后需求不再出现在"执行中"视图，但文档会保留。',
      'session.action.open': '打开需求',
      'session.action.link': '关联需求',
      'session.action.label': '需求',
      'common.offline': '无法连接插件 Host 端，请确认插件已启用并刷新页面。',
      'common.gitUnavailable': '未找到 git 命令',
    }

export const en = {
      'panel.title': 'Requirements',
      'panel.refresh': 'Refresh',
      'panel.search': 'Search requirements…',
      'panel.search.empty': 'No matching requirements',
      'panel.expand': 'Show remaining {count}',
      'panel.collapseAll': 'Collapse all',
      'panel.expandAll': 'Expand all',
      'panel.groupCollapse': 'Collapse workspace',
      'panel.groupExpand': 'Expand workspace',
      'panel.groupCollapsedHint': 'Requirements collapsed',
      'panel.collapse': 'Collapse',
      'detail.delete': 'Delete requirement',
      'detail.deleted': 'Requirement removed from list',
      'delete.requirement.running': 'The requirement is running and cannot be deleted.',
      'project.requirements.delete': 'Delete requirement',
      'project.requirements.deleting': 'Deleting...',
      'project.requirements.deleted': 'Requirement removed from the list; folder files were preserved',
      'delete.requirement.title': 'Delete requirement',
      'delete.requirement.body': 'Remove "{name}" from the requirement list. Its folder and all files stay untouched and will not be deleted; project repository commits are unchanged.',
      'delete.requirement.sessions': '{count} session(s) are linked to this requirement. The requirement folder and its sessions are preserved.',
      'panel.settings': 'Settings',
      'panel.close': 'Back to requirements',
      'panel.unconfigured.title': 'No requirements root configured',
      'panel.unconfigured.body': 'Choose a local directory as the requirements root. Markdown requirement documents are stored per workspace, and the directory can be its own Git repository.',
      'panel.unconfigured.action': 'Choose requirements root',
      'panel.configured': 'Requirements root',
      'panel.empty.workspace': 'No requirements',
      'panel.empty.all': 'No workspaces have been added to DSH yet',
      'panel.new': 'New requirement',
      'panel.new.in.workspace': 'New requirement in this workspace',
      'panel.welcome.title': 'Requirements',
      'panel.welcome.body': 'Pick a requirement on the left to view and edit it. Click "Execute" to start a new session in its workspace.',
      'panel.loading': 'Loading…',
      'panel.error': 'Failed to load',
      'panel.retry': 'Retry',
      'panel.back': 'Back',
      'status.new': 'New',
      'status.running': 'In progress',
      'status.done': 'Done',
      'status.archived': 'Archived',
      'status.cancelled': 'Cancelled',
      'status.label': 'Status',
      'detail.title': 'Title',
      'detail.requirement': 'Requirement',
      'detail.edit': 'Edit',
      'detail.preview': 'Preview',
      'detail.save': 'Save',
      'detail.saved': 'Saved',
      'detail.saving': 'Saving…',
      'detail.execute': 'Execute',
      'detail.execute.again': 'Execute again',
      'detail.execute.hint': 'Create a new session in the workspace and send the requirement prompt',
      'detail.executing': 'Creating session…',
      'detail.execute.needconfig': 'Configure the requirements root first',
      'detail.sessions': 'Linked sessions',
      'detail.sessions.empty': 'No linked session yet. Click "Execute" to start.',
      'detail.session.open': 'Open session',
      'detail.session.unlink': 'Unlink',
      'detail.session.running': 'Running',
      'detail.files': 'Attachments',
      'detail.files.empty': 'No attachment files yet',
      'detail.files.newfile': 'New file',
      'detail.files.newdir': 'New folder',
      'detail.files.upload': 'Reveal in file manager',
      'detail.files.save': 'Save file',
      'detail.files.delete': 'Delete',
      'detail.files.name': 'File name (subfolders allowed, e.g. docs/deploy.md)',
      'detail.files.binary': 'Binary file, cannot preview',
      'detail.files.open': 'Open',
      'detail.git': 'Git history',
      'detail.git.empty': 'No commits yet (the root may not be a Git repository)',
      'detail.git.commit': 'Commit requirement docs',
      'detail.git.nothing': 'Nothing to commit',
      'detail.git.message': 'Commit message',
      'detail.git.defaultMessage': 'chore(requirements): update requirement docs',
      'detail.git.defaultMessageFor': 'chore(requirements): update requirement {id}',
      'detail.createdAt': 'Created',
      'detail.updatedAt': 'Updated',
      'settings.title': 'Settings',
      'settings.root': 'Requirements root',
      'settings.root.hint': 'Requirement documents are stored per workspace below this directory. A dedicated Git repository is recommended.',
      'settings.pick': 'Choose directory',
      'settings.root.open': 'Open directory',
      'settings.save': 'Save settings',
      'settings.saved': 'Settings saved',
      'settings.template': 'Execution prompt template',
      'settings.template.hint': 'Placeholders: {workspaceTitle} {title} {id} {requirementPath} {folderPath} {body}',
      'settings.git': 'Git',
      'settings.git.initialized': 'The requirements root is a Git repository',
      'settings.git.notInitialized': 'The requirements root is not a Git repository',
      'settings.git.init': 'Initialize Git repository',
      'settings.git.status': 'Working tree',
      'settings.git.clean': 'No uncommitted changes',
      'settings.git.changes': 'files changed',
      'settings.git.log': 'Recent commits',
      'settings.git.dirty': 'Uncommitted changes',
      'settings.git.commit': 'Commit all requirement changes',
      'new.title': 'New requirement',
      'new.name': 'Title',
      'new.name.placeholder': 'e.g. Add requirements management plugin',
      'new.body': 'Body (optional, Markdown)',
      'new.body.placeholder': 'You can edit it later. Leave empty to start from a template.',
      'new.create': 'Create',
      'new.creating': 'Creating…',
      'link.title': 'Link current session to a requirement',
      'link.body': 'Pick the requirement this session belongs to. The session header will then link back to the requirement page.',
      'link.empty': 'No requirements available',
      'link.cancel': 'Cancel',
      'link.linked': 'Linked',
      'link.action': 'Link',
      'action.confirm': 'Confirm',
      'action.cancel': 'Cancel',
      'action.delete': 'Delete',
      'delete.confirm.title': 'Delete file',
      'delete.confirm.body': 'Delete {name}? This cannot be undone.',
      'archive.confirm.body': 'Archived requirements stay on disk but are hidden from the in-progress view.',
      'session.action.open': 'Open requirement',
      'session.action.link': 'Link requirement',
      'session.action.label': 'Requirement',
      'common.offline': 'Cannot reach the plugin Host half. Make sure the plugin is enabled and refresh the page.',
      'common.gitUnavailable': 'git command not found',
    }

    /* ------------------------------------------------------------------ */
    /* 样式                                                                */
    /* ------------------------------------------------------------------ */

zh['detail.serverChanged'] = '\u670d\u52a1\u7aef\u5185\u5bb9\u5df2\u66f4\u65b0\uff0c\u672c\u5730\u8349\u7a3f\u5df2\u4fdd\u7559\u3002'
zh['detail.unsaved'] = '\u6709\u672a\u4fdd\u5b58\u7684\u4fee\u6539\uff0c\u786e\u5b9a\u653e\u5f03\u5417\uff1f'
zh['common.refreshFailed'] = '\u64cd\u4f5c\u5df2\u5b8c\u6210\uff0c\u4f46\u5237\u65b0\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u5237\u65b0\u3002'
en['detail.serverChanged'] = 'Server data changed; your local draft was kept.'
en['detail.unsaved'] = 'Discard unsaved changes?'
en['common.refreshFailed'] = 'Operation succeeded, but refresh failed. Refresh again to see the latest data.'

zh['project.title'] = 'DevBench'
zh['project.search'] = "搜索项目…"
zh['project.add'] = "添加项目"
zh['project.adding'] = "正在添加…"
zh['project.empty'] = "暂无项目"
zh['project.emptySearch'] = "没有匹配的项目"
zh['project.missingPath'] = "路径不存在"
zh['project.selectHint'] = "选择左侧项目"
zh['project.branch'] = "分支"
zh['project.noBranch'] = "无分支"
zh['project.gitUnavailable'] = "Git 不可用"
zh['project.gitNotInitialized'] = "尚未初始化 Git"
zh['project.initGit'] = "初始化 Git"
zh['project.initingGit'] = "正在初始化…"
zh['project.changes'] = "{count} 个变更"
zh['project.tab.overview'] = "概览"
zh['project.tab.requirements'] = "需求"
zh['project.tab.commits'] = "提交"
zh['project.tab.reviews'] = "评审"
zh['project.tab.tasks'] = "任务"
zh['project.stats.requirements'] = "需求数"
zh['project.stats.changes'] = "变更文件"
zh['project.stats.latestCommit'] = "最近提交"
zh['project.stats.latestReview'] = "最近评审"
zh['project.recentCommits'] = "最近提交"
zh['project.recentReviews'] = "最近评审"
zh['project.recentTasks'] = "最近任务"
zh['project.taskSummary'] = "任务摘要"
zh['project.none'] = "无"
zh['project.viewAll'] = "查看全部"
zh['project.ai.title'] = "AI 操作"
zh['project.ai.commit'] = "AI 提交"
zh['project.ai.commitBusy'] = "正在生成预览…"
zh['project.ai.reviewLatest'] = "评审最新提交"
zh['project.ai.reviewBusy'] = "正在发起评审…"
zh['project.ai.noCommit'] = "暂无可评审提交"
zh['project.ai.changesHint'] = "工作区有 {count} 个文件变更"
zh['project.ai.clean'] = "工作区没有未提交变更"
zh['project.ai.reviewHint'] = "最近提交 {short} · {subject}"
zh['project.activeTasks'] = "运行中任务"
zh['project.noActiveTasks'] = "暂无运行中任务"
zh['project.noReviews'] = "暂无评审"
zh['project.tasks.activeCount'] = "{count} 个任务进行中"
zh['project.commit.hash'] = "提交"
zh['project.commit.subject'] = "摘要"
zh['project.commit.author'] = "作者"
zh['project.commit.date'] = "时间"
zh['project.commit.reviewed'] = "已评审"
zh['project.commit.notReviewed'] = "未评审"
zh['project.commit.review'] = "评审此提交"
zh['project.commit.first'] = "首次提交"
zh['project.commit.merge'] = "合并提交"
zh['project.commit.empty'] = "暂无提交"
zh['project.review.empty'] = "暂无评审报告"
zh['project.review.loading'] = "加载中评审…"
zh['project.review.failed'] = "评审加载失败"
zh['project.review.modified'] = "修改时间"
zh['project.review.already'] = "已打开现有评审"
zh['project.review.missing'] = "未找到对应评审文件"
zh['project.review.selectHint'] = "选择评审查看内容"
zh['project.review.detail'] = "评审详情"
zh['project.review.file'] = "评审文件"
zh['project.task.empty'] = "暂无任务"
zh['project.task.openSession'] = "打开会话"
zh['project.task.cancel'] = "取消"
zh['project.task.retry'] = "重试"
zh['project.task.cancelling'] = "取消中…"
zh['project.task.retrying'] = "重试中…"
zh['project.task.noSession'] = "无会话"
zh['project.task.noCommit'] = "无关联提交"
zh['project.task.updated'] = "任务状态已更新"
zh['status.queued'] = "排队中"
zh['status.succeeded'] = "已完成"
zh['status.failed'] = "失败"
zh['status.awaiting_confirmation'] = "等待确认"
zh['task.kind.commit'] = "提交"
zh['task.kind.review'] = "评审"
zh['task.kind.requirement'] = "需求"
zh['project.task.recordFailed'] = "需求已开始执行，但任务记录失败"
zh['project.commit.confirm.title'] = "确认 AI 提交"
zh['project.commit.confirm.files'] = "变更文件"
zh['project.commit.confirm.message'] = "提交信息"
zh['project.commit.confirm.action'] = "确认提交"
zh['project.commit.confirming'] = "提交中…"
zh['project.commit.cancelling'] = "取消任务中…"
zh['project.commit.confirm.hint'] = "确认后将执行 git add 并提交。提交后不会自动创建评审任务，可在提交列表或右侧「发起评审」手动发起。"
zh['project.commit.previewCreated'] = "已创建提交预览任务"
zh['project.commit.success'] = "提交成功"
zh['project.task.cancelled'] = "任务已取消"
zh['project.review.started'] = "评审任务已创建"
zh['project.review.notFound'] = "未找到对应评审文件"
zh['project.requirements.empty'] = "当前项目暂无需求"
zh['project.requirements.unconfigured'] = "需求根目录未配置"
zh['project.requirements.settings'] = "前往设置"
zh['project.requirements.back'] = "返回需求列表"
zh['project.requirements.new'] = "新建需求"
zh['project.requirements.search'] = "搜索需求…"
zh['project.settings.back'] = "返回工作台"
zh['project.refreshFailed'] = "刷新失败"
zh['project.operationFailed'] = "操作失败"
zh['project.loadFailed'] = "加载项目失败"
zh['project.alreadyReviewed'] = "该提交已有评审"
zh['project.projectPath'] = "项目路径"
zh['project.refresh'] = "刷新"
zh['project.loadingTasks'] = "加载中任务…"
zh['project.loadingReviews'] = "加载中评审…"
zh['project.loadingCommits'] = "加载中提交…"
en['project.title'] = 'DevBench'
en['project.search'] = "Search projects..."
en['project.add'] = "Add project"
en['project.adding'] = "Adding..."
en['project.empty'] = "No projects"
en['project.emptySearch'] = "No matching projects"
en['project.missingPath'] = "Path does not exist"
en['project.selectHint'] = "Select a project on the left"
en['project.branch'] = "Branch"
en['project.noBranch'] = "No branch"
en['project.gitUnavailable'] = "Git unavailable"
en['project.gitNotInitialized'] = "Git is not initialized"
en['project.initGit'] = "Initialize Git"
en['project.initingGit'] = "Initializing..."
en['project.changes'] = "{count} changes"
en['project.tab.overview'] = "Overview"
en['project.tab.requirements'] = "Requirements"
en['project.tab.commits'] = "Commits"
en['project.tab.reviews'] = "Reviews"
en['project.tab.tasks'] = "Tasks"
en['project.stats.requirements'] = "Requirements"
en['project.stats.changes'] = "Changed files"
en['project.stats.latestCommit'] = "Latest commit"
en['project.stats.latestReview'] = "Latest review"
en['project.recentCommits'] = "Recent commits"
en['project.recentReviews'] = "Recent reviews"
en['project.recentTasks'] = "Recent tasks"
en['project.taskSummary'] = "Task summary"
en['project.none'] = "None"
en['project.viewAll'] = "View all"
en['project.ai.title'] = "AI actions"
en['project.ai.commit'] = "AI commit"
en['project.ai.commitBusy'] = "Generating preview..."
en['project.ai.reviewLatest'] = "Review latest commit"
en['project.ai.reviewBusy'] = "Starting review..."
en['project.ai.noCommit'] = "No commit to review"
en['project.ai.changesHint'] = "{count} changed file(s) in the working tree"
en['project.ai.clean'] = "No uncommitted changes"
en['project.ai.reviewHint'] = "Latest commit {short} · {subject}"
en['project.activeTasks'] = "Active tasks"
en['project.noActiveTasks'] = "No active tasks"
en['project.noReviews'] = "No reviews"
en['project.tasks.activeCount'] = "{count} active tasks"
en['project.commit.hash'] = "Commit"
en['project.commit.subject'] = "Subject"
en['project.commit.author'] = "Author"
en['project.commit.date'] = "Time"
en['project.commit.reviewed'] = "Reviewed"
en['project.commit.notReviewed'] = "Not reviewed"
en['project.commit.review'] = "Review this commit"
en['project.commit.first'] = "First commit"
en['project.commit.merge'] = "Merge commit"
en['project.commit.empty'] = "No commits"
en['project.review.empty'] = "No review reports"
en['project.review.loading'] = "Loading review..."
en['project.review.failed'] = "Failed to load review"
en['project.review.modified'] = "Modified"
en['project.review.already'] = "Opened existing review"
en['project.review.missing'] = "Review file not found"
en['project.review.selectHint'] = "Select a review to view its content"
en['project.review.detail'] = "Review detail"
en['project.review.file'] = "Review file"
en['project.task.empty'] = "No tasks"
en['project.task.openSession'] = "Open session"
en['project.task.cancel'] = "Cancel"
en['project.task.retry'] = "Retry"
en['project.task.cancelling'] = "Cancelling..."
en['project.task.retrying'] = "Retrying..."
en['project.task.noSession'] = "No session"
en['project.task.noCommit'] = "No linked commit"
en['project.task.updated'] = "Task status updated"
en['status.queued'] = "Queued"
en['status.succeeded'] = "Succeeded"
en['status.failed'] = "Failed"
en['status.awaiting_confirmation'] = "Awaiting confirmation"
en['task.kind.commit'] = "Commit"
en['task.kind.review'] = "Review"
en['task.kind.requirement'] = "Requirement"
en['project.task.recordFailed'] = "Requirement started but the task record failed"
en['project.commit.confirm.title'] = "Confirm AI commit"
en['project.commit.confirm.files'] = "Changed files"
en['project.commit.confirm.message'] = "Commit message"
en['project.commit.confirm.action'] = "Confirm commit"
en['project.commit.confirming'] = "Committing..."
en['project.commit.cancelling'] = "Cancelling task..."
en['project.commit.confirm.hint'] = "This will stage all changes and create the commit. No review task is created automatically; start one manually from the commit list or the right sidebar."
en['project.commit.previewCreated'] = "Commit preview task created"
en['project.commit.success'] = "Commit created"
en['project.task.cancelled'] = "Task cancelled"
en['project.review.started'] = "Review task created"
en['project.review.notFound'] = "Review file not found"
en['project.requirements.empty'] = "No requirements in this project"
en['project.requirements.unconfigured'] = "Requirements root is not configured"
en['project.requirements.settings'] = "Open settings"
en['project.requirements.back'] = "Back to requirements"
en['project.requirements.new'] = "New requirement"
en['project.requirements.search'] = "Search requirements..."
en['project.settings.back'] = "Back to workbench"
en['project.refreshFailed'] = "Refresh failed"
en['project.operationFailed'] = "Operation failed"
en['project.loadFailed'] = "Failed to load project"
en['project.alreadyReviewed'] = "This commit already has a review"
en['project.projectPath'] = "Project path"
en['project.refresh'] = "Refresh"
en['project.loadingTasks'] = "Loading tasks..."
en['project.loadingReviews'] = "Loading reviews..."
en['project.loadingCommits'] = "Loading commits..."

zh['project.ai.commitActive'] = '\u63d0\u4ea4\u4efb\u52a1\u8fdb\u884c\u4e2d'
en['project.ai.commitActive'] = 'Commit task in progress'

/* REQ-20261026-002: home page, worktree, settings templates, commit pagination. */
zh['home.title'] = '主页'
en['home.title'] = 'Home'
zh['home.subtitle'] = '最近任务、未完成任务与一周工作汇总'
en['home.subtitle'] = 'Recent tasks, unfinished work and a weekly summary'
zh['home.refresh'] = '刷新'
en['home.refresh'] = 'Refresh'
zh['home.loading'] = '加载主页…'
en['home.loading'] = 'Loading home...'
zh['home.error'] = '主页加载失败'
en['home.error'] = 'Failed to load home'
zh['home.empty'] = '还没有项目，先在左侧添加项目'
en['home.empty'] = 'No projects yet. Add one from the left.'
zh['home.stats.projects'] = '项目'
en['home.stats.projects'] = 'Projects'
zh['home.stats.requirements'] = '需求'
en['home.stats.requirements'] = 'Requirements'
zh['home.stats.activeTasks'] = '未完成任务'
en['home.stats.activeTasks'] = 'Unfinished tasks'
zh['home.stats.runningRequirements'] = '执行中需求'
en['home.stats.runningRequirements'] = 'Running requirements'
zh['home.recentTasks'] = '最近任务'
en['home.recentTasks'] = 'Recent tasks'
zh['home.activeTasks'] = '未完成任务'
en['home.activeTasks'] = 'Unfinished tasks'
zh['home.runningRequirements'] = '执行中的需求'
en['home.runningRequirements'] = 'Running requirements'
zh['home.noRecentTasks'] = '暂无任务'
en['home.noRecentTasks'] = 'No tasks yet'
zh['home.noActiveTasks'] = '没有未完成任务'
en['home.noActiveTasks'] = 'No unfinished tasks'
zh['home.noRunningRequirements'] = '没有执行中的需求'
en['home.noRunningRequirements'] = 'No running requirements'
zh['home.weekly'] = '本周周报'
en['home.weekly'] = 'Weekly report'
zh['home.weekly.hint'] = '汇总最近 {days} 天的提交、评审、任务和需求变动，生成 Markdown 周报。'
en['home.weekly.hint'] = 'Summarize commits, reviews, tasks and requirement changes from the last {days} days as a Markdown report.'
zh['home.weekly.generate'] = '生成周报'
en['home.weekly.generate'] = 'Generate report'
zh['home.weekly.regenerate'] = '重新生成'
en['home.weekly.regenerate'] = 'Regenerate'
zh['home.weekly.generating'] = '生成中…'
en['home.weekly.generating'] = 'Generating...'
zh['home.weekly.empty'] = '点击“生成周报”汇总最近一周的工作。'
en['home.weekly.empty'] = 'Click "Generate report" to summarize the last week.'
zh['home.weekly.summary'] = '{commits} 个提交 · {reviews} 份评审 · {tasks} 个任务 · {requirements} 个需求'
en['home.weekly.summary'] = '{commits} commits · {reviews} reviews · {tasks} tasks · {requirements} requirement changes'
zh['home.weekly.generatedAt'] = '生成于 {time}'
en['home.weekly.generatedAt'] = 'Generated at {time}'
zh['home.weekly.range'] = '{start} ~ {end}'
en['home.weekly.range'] = '{start} ~ {end}'
zh['home.weekly.copy'] = '复制 Markdown'
en['home.weekly.copy'] = 'Copy Markdown'
zh['home.weekly.copied'] = '已复制'
en['home.weekly.copied'] = 'Copied'
zh['home.openProject'] = '打开项目'
en['home.openProject'] = 'Open project'
zh['home.openSession'] = '打开会话'
en['home.openSession'] = 'Open session'
zh['home.sessionMissing'] = '会话不存在，无法打开'
en['home.sessionMissing'] = 'Session does not exist'
zh['home.projectLabel'] = '项目'
en['home.projectLabel'] = 'Project'
zh['home.weekLabel'] = '本周统计'
en['home.weekLabel'] = 'This week'
zh['home.panel.projects'] = '项目概览'
en['home.panel.projects'] = 'Projects'
zh['home.taskCount'] = '{count} 个任务'
en['home.taskCount'] = '{count} tasks'
zh['home.requirementsCount'] = '{count} 个需求'
en['home.requirementsCount'] = '{count} requirements'
zh['detail.worktree'] = 'Worktree（工作区隔离）'
en['detail.worktree'] = 'Worktree (isolated workspace)'
zh['detail.worktree.enable'] = '在 worktree 中执行'
en['detail.worktree.enable'] = 'Run in a worktree'
zh['detail.worktree.hint'] = '启用后，执行需求会在独立 worktree 目录中创建会话，改动不污染项目主工作区；分支名为 devbench/<需求ID>，可合并回主分支。'
en['detail.worktree.hint'] = 'When enabled, executing the requirement opens a session in a dedicated worktree; changes stay out of the main working tree. The branch is devbench/<requirement id> and can be merged back.'
zh['detail.worktree.notCreated'] = '尚未创建，下次执行时自动创建'
en['detail.worktree.notCreated'] = 'Not created yet; it will be created on the next execution'
zh['detail.worktree.created'] = '已创建'
en['detail.worktree.created'] = 'Created'
zh['detail.worktree.path'] = '目录'
en['detail.worktree.path'] = 'Directory'
zh['detail.worktree.branch'] = '分支'
en['detail.worktree.branch'] = 'Branch'
zh['detail.worktree.base'] = '来源分支'
en['detail.worktree.base'] = 'Base branch'
zh['detail.worktree.reveal'] = '打开目录'
en['detail.worktree.reveal'] = 'Reveal directory'
zh['detail.worktree.remove'] = '移除 worktree'
en['detail.worktree.remove'] = 'Remove worktree'
zh['detail.worktree.removing'] = '移除中…'
en['detail.worktree.removing'] = 'Removing...'
zh['detail.worktree.remove.title'] = '移除 worktree'
en['detail.worktree.remove.title'] = 'Remove worktree'
zh['detail.worktree.remove.body'] = '将移除 {path}。分支 {branch} 会保留，已提交内容不会丢失；存在未提交变更时无法移除。'
en['detail.worktree.remove.body'] = 'This removes {path}. Branch {branch} is kept and committed work is not lost; removal fails while uncommitted changes exist.'
zh['detail.worktree.removed'] = 'worktree 已移除'
en['detail.worktree.removed'] = 'Worktree removed'
zh['detail.worktree.enabled'] = '已启用 worktree'
en['detail.worktree.enabled'] = 'Worktree enabled'
zh['detail.worktree.disabled'] = '已关闭 worktree'
en['detail.worktree.disabled'] = 'Worktree disabled'
zh['detail.worktree.toggleBusy'] = '处理中…'
en['detail.worktree.toggleBusy'] = 'Working...'
zh['new.worktree'] = '启用 worktree（执行时自动创建隔离目录）'
en['new.worktree'] = 'Enable worktree (create an isolated directory on execution)'
zh['project.requirements.worktree'] = 'Worktree'
en['project.requirements.worktree'] = 'Worktree'
zh['settings.worktree'] = 'Worktree'
en['settings.worktree'] = 'Worktree'
zh['settings.worktree.root'] = 'Worktree 根目录'
en['settings.worktree.root'] = 'Worktree root'
zh['settings.worktree.root.hint'] = '每个需求的 worktree 会创建在该目录下；留空使用默认目录 {path}。'
en['settings.worktree.root.hint'] = 'Requirement worktrees are created under this directory; leave empty to use {path}.'
zh['settings.worktree.default'] = '默认目录'
en['settings.worktree.default'] = 'Default'
zh['settings.worktree.pick'] = '选择目录'
en['settings.worktree.pick'] = 'Choose directory'
zh['settings.reviewTemplate'] = '评审提示词模板'
en['settings.reviewTemplate'] = 'Review prompt template'
zh['settings.reviewTemplate.hint'] = '可用占位符：{projectTitle} {projectPath} {taskId} {commitHash} {commitShort} {commitSubject}；必须包含 {taskId}。'
en['settings.reviewTemplate.hint'] = 'Placeholders: {projectTitle} {projectPath} {taskId} {commitHash} {commitShort} {commitSubject}; {taskId} is required.'
zh['settings.reviewTemplate.reset'] = '恢复默认'
en['settings.reviewTemplate.reset'] = 'Reset to default'
zh['settings.template.reset'] = '恢复默认'
en['settings.template.reset'] = 'Reset to default'
zh['project.commits.loadMore'] = '加载更多（已显示 {count} 个）'
en['project.commits.loadMore'] = 'Load more ({count} shown)'
zh['project.commits.loadingMore'] = '加载中…'
en['project.commits.loadingMore'] = 'Loading...'
zh['project.commits.error'] = '提交加载失败'
en['project.commits.error'] = 'Failed to load commits'
zh['project.commits.retry'] = '重试'
en['project.commits.retry'] = 'Retry'
zh['project.commits.shownAll'] = '已显示全部提交'
en['project.commits.shownAll'] = 'All commits shown'

/* REQ-20261026-004: project worktree tab, doc-commit removal, sidebar click fix. */
zh['project.tab.worktrees'] = '工作树'
en['project.tab.worktrees'] = 'Worktrees'
zh['status.missing'] = '已缺失'
en['status.missing'] = 'Missing'
zh['project.worktrees.title'] = '工作树'
en['project.worktrees.title'] = 'Worktrees'
zh['project.worktrees.count'] = '{count} 个工作树'
en['project.worktrees.count'] = '{count} worktrees'
zh['project.worktrees.root'] = '根目录'
en['project.worktrees.root'] = 'Root'
zh['project.worktrees.remote'] = '远端'
en['project.worktrees.remote'] = 'Remote'
zh['project.worktrees.noRemote'] = '未配置远端'
en['project.worktrees.noRemote'] = 'No remote configured'
zh['project.worktrees.empty'] = '该项目还没有插件创建的工作树；在需求详情启用 worktree 并执行需求后会自动创建。'
en['project.worktrees.empty'] = 'No plugin-created worktrees yet. Enable worktree on a requirement and execute it to create one.'
zh['project.worktrees.notGit'] = '项目尚未初始化为 Git 仓库，无法管理工作树。'
en['project.worktrees.notGit'] = 'The project is not a Git repository yet, so worktrees are unavailable.'
zh['project.worktrees.missingDir'] = '目录不存在'
en['project.worktrees.missingDir'] = 'Directory missing'
zh['project.worktrees.branch'] = '分支'
en['project.worktrees.branch'] = 'Branch'
zh['project.worktrees.lastCommit'] = '最近提交'
en['project.worktrees.lastCommit'] = 'Latest commit'
zh['project.worktrees.noCommit'] = '暂无提交'
en['project.worktrees.noCommit'] = 'No commits yet'
zh['project.worktrees.dirty'] = '{count} 个未提交变更'
en['project.worktrees.dirty'] = '{count} uncommitted change(s)'
zh['project.worktrees.clean'] = '无未提交变更'
en['project.worktrees.clean'] = 'Clean'
zh['project.worktrees.ahead'] = '领先 {count}'
en['project.worktrees.ahead'] = '{count} ahead'
zh['project.worktrees.behind'] = '落后 {count}'
en['project.worktrees.behind'] = '{count} behind'
zh['project.worktrees.upstream'] = '上游 {remote}/{branch}'
en['project.worktrees.upstream'] = 'Upstream {remote}/{branch}'
zh['project.worktrees.changes'] = '查看改动'
en['project.worktrees.changes'] = 'View changes'
zh['project.worktrees.hideChanges'] = '收起改动'
en['project.worktrees.hideChanges'] = 'Hide changes'
zh['project.worktrees.changesEmpty'] = '没有未提交的改动'
en['project.worktrees.changesEmpty'] = 'No uncommitted changes'
zh['project.worktrees.files'] = '变更文件'
en['project.worktrees.files'] = 'Changed files'
zh['project.worktrees.diff'] = '差异'
en['project.worktrees.diff'] = 'Diff'
zh['project.worktrees.truncated'] = '差异内容过长，已截断显示。'
en['project.worktrees.truncated'] = 'The diff is too long and was truncated.'
zh['project.worktrees.commit'] = '提交'
en['project.worktrees.commit'] = 'Commit'
zh['project.worktrees.commitBusy'] = '正在生成提交预览…'
en['project.worktrees.commitBusy'] = 'Generating commit preview...'
zh['project.worktrees.noChanges'] = '没有未提交变更，无需提交'
en['project.worktrees.noChanges'] = 'Nothing to commit'
zh['project.worktrees.push'] = '推送'
en['project.worktrees.push'] = 'Push'
zh['project.worktrees.pushBusy'] = '推送中…'
en['project.worktrees.pushBusy'] = 'Pushing...'
zh['project.worktrees.pushNoRemote'] = '未配置远端，请先为项目添加 remote 再推送'
en['project.worktrees.pushNoRemote'] = 'No remote configured; add a remote before pushing'
zh['project.worktrees.pushed'] = '已推送到 {remote}/{branch}'
en['project.worktrees.pushed'] = 'Pushed to {remote}/{branch}'
zh['project.worktrees.pushedUpToDate'] = '远程已是最新，无需推送'
en['project.worktrees.pushedUpToDate'] = 'Remote is already up to date'
zh['project.worktrees.reveal'] = '打开目录'
en['project.worktrees.reveal'] = 'Reveal'
zh['project.worktrees.revealed'] = '已在文件管理器中打开工作树目录'
en['project.worktrees.revealed'] = 'Opened the worktree directory in the file manager'
zh['project.worktrees.remove'] = '删除工作树'
en['project.worktrees.remove'] = 'Delete worktree'
zh['project.worktrees.removeBusy'] = '删除中…'
en['project.worktrees.removeBusy'] = 'Deleting...'
zh['project.worktrees.removeTitle'] = '删除工作树'
en['project.worktrees.removeTitle'] = 'Delete worktree'
zh['project.worktrees.removeBody'] = '将删除工作树目录 {path}。分支 {branch} 会保留，已提交内容不会丢失；存在未提交变更时无法删除。需求文档中的 worktree 开关保持不变，下次执行时会重新创建目录。'
en['project.worktrees.removeBody'] = 'This deletes the worktree directory {path}. Branch {branch} is kept and committed work is not lost; deletion fails while uncommitted changes exist. The worktree switch on the requirement stays enabled, so the directory is recreated on the next execution.'
zh['project.worktrees.removed'] = '工作树目录已删除，分支已保留'
en['project.worktrees.removed'] = 'Worktree directory deleted; its branch is kept'
zh['project.worktrees.commitSuccess'] = '工作树提交成功：{short}'
en['project.worktrees.commitSuccess'] = 'Worktree commit created: {short}'
zh['project.commit.confirm.worktreeHint'] = '将在工作树分支 {branch} 中提交，提交后不会自动创建评审任务。'
en['project.commit.confirm.worktreeHint'] = 'This commits on worktree branch {branch}; no review task will be created.'

/* REQ-20261027-004: worktree states, on-demand creation, cleanup and quick actions. */
zh['project.worktrees.ready'] = '已创建'
en['project.worktrees.ready'] = 'Created'
zh['project.worktrees.notCreated'] = '已启用，未创建'
en['project.worktrees.notCreated'] = 'Enabled, not created'
zh['project.worktrees.state'] = '状态'
en['project.worktrees.state'] = 'State'
zh['project.worktrees.create'] = '立即创建'
en['project.worktrees.create'] = 'Create now'
zh['project.worktrees.creating'] = '创建中…'
en['project.worktrees.creating'] = 'Creating...'
zh['project.worktrees.created'] = '工作树已创建'
en['project.worktrees.created'] = 'Worktree created'
zh['project.worktrees.absentHint'] = '该需求已启用 worktree，但目录尚未创建。可在此直接创建，也可以在需求页执行需求时自动创建。'
en['project.worktrees.absentHint'] = 'This requirement uses a worktree but its directory does not exist yet. Create it here, or execute the requirement to create it automatically.'
zh['project.worktrees.goEnable'] = '去需求页启用'
en['project.worktrees.goEnable'] = 'Enable in requirements'
zh['project.worktrees.prune'] = '清理残留'
en['project.worktrees.prune'] = 'Clean up'
zh['project.worktrees.pruneSingle'] = '清理残留注册'
en['project.worktrees.pruneSingle'] = 'Clean up registration'
zh['project.worktrees.pruneAll'] = '清理全部残留'
en['project.worktrees.pruneAll'] = 'Clean up all missing'
zh['project.worktrees.pruneTitle'] = '清理残留工作树'
en['project.worktrees.pruneTitle'] = 'Clean up stale worktree'
zh['project.worktrees.pruneBody'] = '工作树目录 {path} 已不存在。将删除它的 git worktree 注册记录；分支 {branch} 会保留，已提交内容不会丢失。'
en['project.worktrees.pruneBody'] = 'The worktree directory {path} is gone. Its git worktree registration is removed; branch {branch} is kept and committed work is not lost.'
zh['project.worktrees.pruneAllTitle'] = '清理全部残留工作树'
en['project.worktrees.pruneAllTitle'] = 'Clean up all stale worktrees'
zh['project.worktrees.pruneAllBody'] = '将清理 {count} 个目录已不存在的 worktree 注册记录；devbench 分支会保留。'
en['project.worktrees.pruneAllBody'] = 'Remove {count} stale worktree registration(s) whose directories are gone; devbench branches are kept.'
zh['project.worktrees.pruning'] = '清理中…'
en['project.worktrees.pruning'] = 'Cleaning...'
zh['project.worktrees.pruned'] = '已清理 {count} 个残留 worktree'
en['project.worktrees.pruned'] = 'Cleaned up {count} stale worktree(s)'
zh['project.worktrees.missingCount'] = '{count} 个目录缺失'
en['project.worktrees.missingCount'] = '{count} missing'
zh['project.worktrees.absentCount'] = '{count} 个未创建'
en['project.worktrees.absentCount'] = '{count} not created'
zh['project.worktrees.emptyNoRequirement'] = '该项目还没有启用 worktree 的需求；在需求详情勾选「启用 worktree」后会在这里出现。'
en['project.worktrees.emptyNoRequirement'] = 'No requirement in this project uses worktrees yet. Enable worktree on a requirement to see it here.'
zh['project.worktrees.remotes'] = '远端：{list}'
en['project.worktrees.remotes'] = 'Remotes: {list}'
zh['project.worktrees.remoteAmbiguous'] = '存在多个远端但没有 origin，无法自动选择推送目标'
en['project.worktrees.remoteAmbiguous'] = 'Multiple remotes exist but none is origin, so the push target is ambiguous'
zh['project.worktrees.statusUnknown'] = '状态不可用'
en['project.worktrees.statusUnknown'] = 'Status unavailable'
zh['project.worktrees.copyPath'] = '复制路径'
en['project.worktrees.copyPath'] = 'Copy path'
zh['project.worktrees.copyBranch'] = '复制分支'
en['project.worktrees.copyBranch'] = 'Copy branch'
zh['project.worktrees.copied'] = '已复制到剪贴板'
en['project.worktrees.copied'] = 'Copied to clipboard'
zh['project.worktrees.copyUnavailable'] = '当前环境不支持剪贴板'
en['project.worktrees.copyUnavailable'] = 'Clipboard is unavailable in this environment'
zh['project.worktrees.openRequirement'] = '打开需求'
en['project.worktrees.openRequirement'] = 'Open requirement'
zh['project.worktrees.openIn'] = '{target}'
en['project.worktrees.openIn'] = '{target}'
zh['project.worktrees.viewPreview'] = '查看提交预览'
en['project.worktrees.viewPreview'] = 'View commit preview'
zh['project.worktrees.repreview'] = '重新预览'
en['project.worktrees.repreview'] = 'Preview again'

/* REQ-20261026-009: client-side list pagination (10 rows per page + load more). */
zh['list.loadMore'] = '加载更多（已显示 {count} 个）'
en['list.loadMore'] = 'Load more ({count} shown)'
zh['list.shownAll'] = '已显示全部（共 {total} 个）'
en['list.shownAll'] = 'All {total} shown'

/* v0.10 workbench shell: breadcrumb, preview notice and dialog plumbing. */
zh['common.close'] = '关闭'
en['common.close'] = 'Close'
zh['nav.back'] = '返回'
en['nav.back'] = 'Back'
zh['breadcrumb.workbench'] = 'DevBench'
en['breadcrumb.workbench'] = 'DevBench'
zh['breadcrumb.project'] = '项目'
en['breadcrumb.project'] = 'Project'
zh['breadcrumb.settings'] = '设置'
en['breadcrumb.settings'] = 'Settings'
zh['breadcrumb.link'] = '关联需求'
en['breadcrumb.link'] = 'Link requirement'
zh['breadcrumb.requirement'] = '需求'
en['breadcrumb.requirement'] = 'Requirement'
zh['breadcrumb.commit'] = '提交'
en['breadcrumb.commit'] = 'Commit'
zh['breadcrumb.worktree'] = '工作树'
en['breadcrumb.worktree'] = 'Worktree'
zh['breadcrumb.review'] = '评审'
en['breadcrumb.review'] = 'Review'
zh['breadcrumb.task'] = '任务'
en['breadcrumb.task'] = 'Task'
zh['project.commit.notice'] = 'AI 提交预览已就绪'
en['project.commit.notice'] = 'AI commit preview is ready'
zh['project.commit.notice.action'] = '查看预览'
en['project.commit.notice.action'] = 'Review'
zh['project.commit.later'] = '稍后处理'
en['project.commit.later'] = 'Later'
zh['project.commit.cancelTask'] = '取消任务'
en['project.commit.cancelTask'] = 'Cancel task'
zh['project.commit.cancelConfirm.title'] = '取消 AI 提交任务？'
en['project.commit.cancelConfirm.title'] = 'Cancel the AI commit task?'
zh['project.commit.cancelConfirm.body'] = '取消后将丢弃 AI 生成的提交信息，需要重新发起预览。'
en['project.commit.cancelConfirm.body'] = 'Cancelling discards the generated commit message; the preview must be started again.'
zh['project.commit.messageHint'] = '提交信息需包含中文，最多 2000 字符。⌘/Ctrl + Enter 确认提交'
en['project.commit.messageHint'] = 'The message must contain Chinese characters and be at most 2000 characters. Cmd/Ctrl + Enter to confirm.'
zh['project.commit.charCount'] = '{count} / 2000'
en['project.commit.charCount'] = '{count} / 2000'
zh['project.commit.target'] = '目标'
en['project.commit.target'] = 'Target'
zh['project.commit.project'] = '项目'
en['project.commit.project'] = 'Project'
zh['project.commit.confirm.recheck'] = '确认时会重新校验 HEAD 与工作区；预览后如有改动会要求重新预览。'
en['project.commit.confirm.recheck'] = 'HEAD and the worktree are re-checked on confirm; changes after preview require a new preview.'
zh['project.commit.filesCount'] = '变更文件 {count}'
en['project.commit.filesCount'] = '{count} changed files'
zh['project.commit.autoNoticeHint'] = '任务会保持「等待确认」，可稍后从概览或任务页再次打开。'
en['project.commit.autoNoticeHint'] = 'The task stays awaiting confirmation; reopen it later from the overview or tasks tab.'
zh['dialog.unsaved.title'] = '有未保存的修改'
en['dialog.unsaved.title'] = 'Unsaved changes'
zh['dialog.unsaved.body'] = '离开当前编辑页会丢失未保存的内容。'
en['dialog.unsaved.body'] = 'Leaving this editor discards the unsaved content.'
zh['dialog.unsaved.save'] = '保存并离开'
en['dialog.unsaved.save'] = 'Save and leave'
zh['dialog.unsaved.discard'] = '放弃修改'
en['dialog.unsaved.discard'] = 'Discard changes'
zh['dialog.unsaved.stay'] = '继续编辑'
zh['project.task.cancelConfirm.title'] = '取消任务？'
en['project.task.cancelConfirm.title'] = 'Cancel this task?'
zh['project.task.cancelConfirm.body'] = '将取消任务「{name}」；已生成但未确认的内容会作废，可能无法恢复。'
en['project.task.cancelConfirm.body'] = 'This cancels "{name}"; unconfirmed generated content is discarded and may not be recoverable.'
zh['project.task.cancelConfirm.action'] = '取消任务'
en['project.task.cancelConfirm.action'] = 'Cancel task'

en['dialog.unsaved.stay'] = 'Keep editing'

Object.assign(zh, zhTabs, zhDetail, zhSafety)
Object.assign(en, enTabs, enDetail, enSafety)

zh['panel.title'] = zh['project.title']
en['panel.title'] = en['project.title']

/* REQ-20261027-001: project launchers, requirement-commit links, commit file diffs. */
zh['project.open.vscode'] = '在 VS Code 中打开项目'
en['project.open.vscode'] = 'Open project in VS Code'
zh['project.open.system'] = '在文件管理器中打开项目'
en['project.open.system'] = 'Reveal project in file manager'
zh['project.open.iterm'] = '在 iTerm 中打开项目'
en['project.open.iterm'] = 'Open project in iTerm'

zh['detail.commits'] = '关联提交'
en['detail.commits'] = 'Linked commits'
zh['detail.commits.hint'] = '关联的提交会显示在提交页签中，点击可跳转查看文件与差异。'
en['detail.commits.hint'] = 'Linked commits appear in the Commits tab; open one to inspect its files and diff.'
zh['detail.commits.link'] = '关联提交'
en['detail.commits.link'] = 'Link commit'
zh['detail.commits.linkHint'] = '从最近提交中选择一个关联到当前需求'
en['detail.commits.linkHint'] = 'Choose one of the recent commits to link to this requirement'
zh['detail.commits.empty'] = '还没有关联提交。'
en['detail.commits.empty'] = 'No commits linked yet.'
zh['detail.commits.open'] = '在提交页签中查看'
en['detail.commits.open'] = 'Open in Commits tab'
zh['detail.commits.unlink'] = '取消关联提交'
en['detail.commits.unlink'] = 'Unlink commit'
zh['detail.commits.linked'] = '已关联提交'
en['detail.commits.linked'] = 'Commit linked'
zh['detail.commits.unlinked'] = '已取消关联提交'
en['detail.commits.unlinked'] = 'Commit unlinked'
zh['detail.commits.linkedShort'] = '已关联'
en['detail.commits.linkedShort'] = 'Linked'
zh['detail.commits.pickerTitle'] = '关联提交到需求'
en['detail.commits.pickerTitle'] = 'Link a commit to the requirement'
zh['detail.commits.pickerHint'] = '选择一个最近的提交；已关联的提交会显示为「已关联」。'
en['detail.commits.pickerHint'] = 'Pick a recent commit; already linked commits are marked as linked.'
zh['detail.commits.noCommits'] = '项目还没有可关联的提交。'
en['detail.commits.noCommits'] = 'The project has no commits to link.'

zh['tabs.commits.files'] = '变更文件与差异'
en['tabs.commits.files'] = 'Changed files and diffs'
zh['tabs.commits.filesCount'] = '{count} 个文件'
en['tabs.commits.filesCount'] = '{count} files'
zh['tabs.commits.noFiles'] = '该提交没有可显示的文件变更。'
en['tabs.commits.noFiles'] = 'This commit has no file changes to show.'
zh['tabs.commits.binaryFile'] = '二进制文件，不显示差异。'
en['tabs.commits.binaryFile'] = 'Binary file; diff is not shown.'
zh['tabs.commits.diffTruncated'] = '差异内容过大，已截断显示。'
en['tabs.commits.diffTruncated'] = 'The diff is too large and has been truncated.'
zh['tabs.commits.loading'] = '加载中提交详情…'
en['tabs.commits.loading'] = 'Loading commit details...'
zh['tabs.commits.openSession'] = '打开评审会话'
en['tabs.commits.openSession'] = 'Open review session'
zh['tabs.commits.associateRequirement'] = '关联到需求'
en['tabs.commits.associateRequirement'] = 'Link to requirement'
zh['tabs.commits.associatedRequirements'] = '关联需求'
en['tabs.commits.associatedRequirements'] = 'Linked requirements'
zh['tabs.commits.noRequirement'] = '还没有需求关联到该提交。'
en['tabs.commits.noRequirement'] = 'No requirement is linked to this commit.'
zh['tabs.commits.selectRequirement'] = '选择要关联的需求'
en['tabs.commits.selectRequirement'] = 'Select a requirement to link'
zh['tabs.commits.requirementLinked'] = '已关联'
en['tabs.commits.requirementLinked'] = 'Linked'
zh['tabs.commits.requirementUnlinked'] = '已取消关联需求'
en['tabs.commits.requirementUnlinked'] = 'Requirement unlinked'
zh['tabs.commits.openRequirement'] = '打开需求'
en['tabs.commits.openRequirement'] = 'Open requirement'
zh['tabs.commits.unlinkRequirement'] = '取消关联需求'
en['tabs.commits.unlinkRequirement'] = 'Unlink requirement'

/* REQ-20261027-002: commit detail file tree + independently scrollable diff pane. */
zh['tabs.commits.diffTree'] = '变更文件树'
en['tabs.commits.diffTree'] = 'Changed file tree'
zh['tabs.commits.emptyDiff'] = '该文件没有可显示的文本差异。'
en['tabs.commits.emptyDiff'] = 'This file has no textual diff to show.'

/* REQ-20261027-003: 评审未提交 */
zh['project.ai.reviewUncommitted'] = '评审未提交'
en['project.ai.reviewUncommitted'] = 'Review uncommitted'
zh['project.ai.reviewUncommittedBusy'] = '正在发起评审…'
en['project.ai.reviewUncommittedBusy'] = 'Starting review...'
zh['project.ai.reviewUncommittedActive'] = '未提交评审进行中'
en['project.ai.reviewUncommittedActive'] = 'Uncommitted review in progress'
zh['project.ai.reviewUncommittedHint'] = '评审当前工作区 {count} 个未提交变更文件'
en['project.ai.reviewUncommittedHint'] = 'Review {count} uncommitted changed file(s) in the working tree'
zh['project.review.uncommittedTarget'] = '未提交变更'
en['project.review.uncommittedTarget'] = 'Uncommitted changes'
zh['project.review.uncommittedStarted'] = '未提交变更评审任务已创建'
en['project.review.uncommittedStarted'] = 'Uncommitted review task created'
zh['tabs.tasks.field.target'] = '评审目标'
en['tabs.tasks.field.target'] = 'Review target'

/* REQ-20261027-004 / REQ-20261028-003: working-tree panel (moved from the
   commits tab to the overview tab), manual commit, pull and push. */
zh['tabs.overview.workspace'] = '工作区'
en['tabs.overview.workspace'] = 'Working tree'
zh['tabs.overview.workspace.clean'] = '工作区干净'
en['tabs.overview.workspace.clean'] = 'Working tree clean'
zh['tabs.overview.workspace.changes'] = '{count} 个未提交文件'
en['tabs.overview.workspace.changes'] = '{count} uncommitted file(s)'
zh['tabs.overview.workspace.statusUnknown'] = '状态不可用'
en['tabs.overview.workspace.statusUnknown'] = 'Status unavailable'
zh['tabs.overview.workspace.detached'] = 'HEAD 游离，无法提交或同步'
en['tabs.overview.workspace.detached'] = 'Detached HEAD: commit and sync are unavailable'
zh['tabs.overview.workspace.noRemote'] = '未配置远端'
en['tabs.overview.workspace.noRemote'] = 'No remote configured'
zh['tabs.overview.workspace.remoteAmbiguous'] = '多个远端且无 origin'
en['tabs.overview.workspace.remoteAmbiguous'] = 'Multiple remotes and no origin'
zh['tabs.overview.workspace.upstream'] = '上游 {remote}/{branch}'
en['tabs.overview.workspace.upstream'] = 'Upstream {remote}/{branch}'
zh['tabs.overview.workspace.noUpstream'] = '未设置上游分支'
en['tabs.overview.workspace.noUpstream'] = 'No upstream branch'
zh['tabs.overview.workspace.ahead'] = '领先 {count}'
en['tabs.overview.workspace.ahead'] = '{count} ahead'
zh['tabs.overview.workspace.behind'] = '落后 {count}'
en['tabs.overview.workspace.behind'] = '{count} behind'
zh['tabs.overview.workspace.files'] = '变更文件（{count}）'
en['tabs.overview.workspace.files'] = 'Changed files ({count})'
zh['tabs.overview.workspace.showDiff'] = '查看差异'
en['tabs.overview.workspace.showDiff'] = 'Show diff'
zh['tabs.overview.workspace.hideDiff'] = '收起差异'
en['tabs.overview.workspace.hideDiff'] = 'Hide diff'
zh['tabs.overview.workspace.truncated'] = '差异内容过大，已截断显示。'
en['tabs.overview.workspace.truncated'] = 'The diff is too large and has been truncated.'
zh['tabs.overview.pull'] = '拉取'
en['tabs.overview.pull'] = 'Pull'
zh['tabs.overview.pulling'] = '拉取中…'
en['tabs.overview.pulling'] = 'Pulling...'
zh['tabs.overview.push'] = '推送'
en['tabs.overview.push'] = 'Push'
zh['tabs.overview.pushing'] = '推送中…'
en['tabs.overview.pushing'] = 'Pushing...'
zh['tabs.overview.manualCommit'] = '提交'
en['tabs.overview.manualCommit'] = 'Commit'
zh['tabs.overview.manualCommitting'] = '提交中…'
en['tabs.overview.manualCommitting'] = 'Committing...'
zh['tabs.overview.commitTitle'] = '提交工作区变更'
en['tabs.overview.commitTitle'] = 'Commit working tree changes'
zh['tabs.overview.commitHint'] = '将暂存全部变更（git add -A），提交信息最多 2000 字符。'
en['tabs.overview.commitHint'] = 'Stages all changes (git add -A); the message is limited to 2000 characters.'
zh['tabs.overview.commitPlaceholder'] = '填写提交信息（中英文均可）'
en['tabs.overview.commitPlaceholder'] = 'Commit message (Chinese or English)'
zh['tabs.overview.commitEmpty'] = '提交信息不能为空'
en['tabs.overview.commitEmpty'] = 'The commit message cannot be empty.'
zh['tabs.overview.commitCancel'] = '取消'
en['tabs.overview.commitCancel'] = 'Cancel'
zh['tabs.overview.commitConfirm'] = '确认提交'
en['tabs.overview.commitConfirm'] = 'Commit'
zh['tabs.overview.commitFiles'] = '将提交 {count} 个文件'
en['tabs.overview.commitFiles'] = 'Commit {count} file(s)'
zh['tabs.overview.commitSuccess'] = '已提交：{short}'
en['tabs.overview.commitSuccess'] = 'Committed {short}'
zh['tabs.overview.pullConfirmTitle'] = '拉取远端更新'
en['tabs.overview.pullConfirmTitle'] = 'Pull remote updates'
zh['tabs.overview.pullConfirmBody'] = '将对 {branch} 执行 git pull --ff-only（上游 {upstream}）；无法快进时不会自动合并。'
en['tabs.overview.pullConfirmBody'] = 'Run git pull --ff-only on {branch} (upstream {upstream}). No automatic merge happens when fast-forward is not possible.'
zh['tabs.overview.pushConfirmTitle'] = '推送到远端'
en['tabs.overview.pushConfirmTitle'] = 'Push to remote'
zh['tabs.overview.pushConfirmBody'] = '将推送分支 {branch} 到 {remote}。'
en['tabs.overview.pushConfirmBody'] = 'Push branch {branch} to {remote}.'
zh['tabs.overview.pullSuccess'] = '拉取完成'
en['tabs.overview.pullSuccess'] = 'Pull completed'
zh['tabs.overview.pullUpToDate'] = '已是最新，无需拉取'
en['tabs.overview.pullUpToDate'] = 'Already up to date'
zh['tabs.overview.pushSuccess'] = '已推送 {branch} 到 {remote}'
en['tabs.overview.pushSuccess'] = 'Pushed {branch} to {remote}'
zh['tabs.overview.pushUpToDate'] = '已是最新，无需推送'
en['tabs.overview.pushUpToDate'] = 'Already up to date'
zh['tabs.overview.workspaceRefresh'] = '刷新工作区状态'
en['tabs.overview.workspaceRefresh'] = 'Refresh working tree status'
zh['tabs.overview.workspaceCollapse'] = '收起工作区详情'
en['tabs.overview.workspaceCollapse'] = 'Collapse working tree details'
zh['tabs.overview.workspaceExpand'] = '展开工作区详情'
en['tabs.overview.workspaceExpand'] = 'Expand working tree details'
zh['tabs.overview.workspaceLoading'] = '读取工作区状态…'
en['tabs.overview.workspaceLoading'] = 'Reading working tree status...'
zh['tabs.overview.workspaceLoadFailed'] = '工作区状态读取失败'
en['tabs.overview.workspaceLoadFailed'] = 'Failed to read working tree status'

/* REQ-20261028-001: requirement list title/full-text search scope. */
zh['project.requirements.search.scope'] = '检索范围'
en['project.requirements.search.scope'] = 'Search scope'
zh['project.requirements.search.title'] = '标题'
en['project.requirements.search.title'] = 'Title'
zh['project.requirements.search.full'] = '全文'
en['project.requirements.search.full'] = 'Full text'
zh['project.requirements.search.loading'] = '检索中…'
en['project.requirements.search.loading'] = 'Searching...'
zh['project.requirements.search.failed'] = '全文检索失败'
en['project.requirements.search.failed'] = 'Full-text search failed'
zh['project.requirements.search.hasMore'] = '匹配较多，仅显示前 {count} 条'
en['project.requirements.search.hasMore'] = 'Many matches; showing the first {count}'
zh['project.requirements.search.retry'] = '重试'
en['project.requirements.search.retry'] = 'Retry'

/* REQ-20261028-003: configurable AI commit prompt template. */
zh['settings.commitTemplate'] = '提交提示词模板'
en['settings.commitTemplate'] = 'Commit prompt template'
zh['settings.commitTemplate.hint'] = '可用占位符：{taskId} {projectPath} {worktreeInfo} {changedFiles} {diffText}；必须包含 {taskId}、{changedFiles} 和 {diffText}。'
en['settings.commitTemplate.hint'] = 'Placeholders: {taskId} {projectPath} {worktreeInfo} {changedFiles} {diffText}; {taskId}, {changedFiles} and {diffText} are required.'
zh['settings.commitTemplate.reset'] = '恢复默认'
en['settings.commitTemplate.reset'] = 'Reset to default'

/* REQ-20261029-002: MCP server management page and home overview entry. */
zh['mcp.title'] = 'MCP 服务'
en['mcp.title'] = 'MCP servers'
zh['mcp.subtitle'] = '管理当前 DSH profile 中的 {module}；修改会写入该 profile 的 cordis.patch.yml。'
en['mcp.subtitle'] = 'Manage {module} entries of the active DSH profile; edits are written to its cordis.patch.yml.'
zh['mcp.profile'] = 'Profile {name}'
en['mcp.profile'] = 'Profile {name}'
zh['mcp.refresh'] = '刷新'
en['mcp.refresh'] = 'Refresh'
zh['mcp.add'] = '添加 MCP 服务'
en['mcp.add'] = 'Add MCP server'
zh['mcp.loading'] = '加载 MCP 服务…'
en['mcp.loading'] = 'Loading MCP servers...'
zh['mcp.loadFailed'] = 'MCP 服务加载失败'
en['mcp.loadFailed'] = 'Failed to load MCP servers'
zh['mcp.retry'] = '重试'
en['mcp.retry'] = 'Retry'
zh['mcp.unavailable'] = '当前 DSH 环境不提供 profile 信息，无法管理 MCP 服务。'
en['mcp.unavailable'] = 'This DSH environment does not expose profile information, so MCP servers cannot be managed.'
zh['mcp.readonly'] = '当前 profile 配置为只读，无法添加、编辑或删除 MCP 服务。'
en['mcp.readonly'] = 'The active profile configuration is read-only; MCP servers cannot be added, edited or removed.'
zh['mcp.hotReloadOff'] = '未启用 DSH 热重载：新增/删除/启停会在重启 DSH 后生效；编辑通过配置编辑器即时生效。'
en['mcp.hotReloadOff'] = 'DSH hot reload is disabled: add/delete/enable changes apply after DSH restarts; edits apply immediately through the configuration editor.'
zh['mcp.empty'] = '当前 profile 还没有 MCP 服务，点击「添加 MCP 服务」新建一个。'
en['mcp.empty'] = 'This profile has no MCP servers yet. Use "Add MCP server" to create one.'
zh['mcp.restartHint'] = '重启 DSH 后生效'
en['mcp.restartHint'] = 'restart DSH to apply'
zh['mcp.phase.active'] = '已启用'
en['mcp.phase.active'] = 'Enabled'
zh['mcp.phase.disabled'] = '已禁用'
en['mcp.phase.disabled'] = 'Disabled'
zh['mcp.phase.failed'] = '加载失败'
en['mcp.phase.failed'] = 'Failed'
zh['mcp.phase.pending'] = '未启动'
en['mcp.phase.pending'] = 'Not started'
zh['mcp.phase.inactive'] = '未启动'
en['mcp.phase.inactive'] = 'Inactive'
zh['mcp.phase.unknown'] = '未知状态'
en['mcp.phase.unknown'] = 'Unknown'
zh['mcp.transport.stdio'] = 'stdio'
en['mcp.transport.stdio'] = 'stdio'
zh['mcp.transport.http'] = 'streamable-http'
en['mcp.transport.http'] = 'streamable-http'
zh['mcp.transport.unknown'] = '未知传输'
en['mcp.transport.unknown'] = 'Unknown transport'
zh['mcp.tools'] = '{count} 个工具'
en['mcp.tools'] = '{count} tools'
zh['mcp.source.profile'] = 'profile 配置'
en['mcp.source.profile'] = 'Profile patch'
zh['mcp.source.bundle'] = 'bundle 内置'
en['mcp.source.bundle'] = 'Bundled'
zh['mcp.readOnly.inactive'] = '该服务当前未启动，启用后才能编辑。'
zh['mcp.readOnly.failed'] = '该服务加载失败，修复配置或重新启用后才能编辑。'
zh['mcp.readOnly.pending'] = '该服务尚未完成启动，请稍后再试。'
en['mcp.readOnly.inactive'] = 'This server is inactive; enable it before editing.'
en['mcp.readOnly.failed'] = 'This server failed to load; fix its config or re-enable it before editing.'
en['mcp.readOnly.pending'] = 'This server is still starting; try again shortly.'
zh['mcp.readOnly.unsupported'] = '当前 DSH 环境不支持修改该服务。'
en['mcp.readOnly.unsupported'] = 'This DSH environment cannot modify the server.'
zh['mcp.readOnly.overlay'] = '该服务被更高优先级的配置覆盖，无法直接修改。'
en['mcp.readOnly.overlay'] = 'A higher-priority configuration overrides this server, so it cannot be edited directly.'
zh['mcp.action.view'] = '查看'
en['mcp.action.view'] = 'Details'
zh['mcp.action.hide'] = '收起'
en['mcp.action.hide'] = 'Hide'
zh['mcp.action.edit'] = '编辑'
en['mcp.action.edit'] = 'Edit'
zh['mcp.action.delete'] = '删除'
en['mcp.action.delete'] = 'Delete'
zh['mcp.action.disable'] = '禁用'
en['mcp.action.disable'] = 'Disable'
zh['mcp.action.enable'] = '启用'
en['mcp.action.enable'] = 'Enable'
zh['mcp.action.disabledHint'] = '当前无法操作该服务'
en['mcp.action.disabledHint'] = 'This server cannot be changed right now'
zh['mcp.action.disableOnlyHint'] = '该服务不能删除；点击后将切换为禁用/启用状态。'
en['mcp.action.disableOnlyHint'] = 'This server cannot be removed; the action toggles disabled/enabled instead.'
zh['mcp.detail.id'] = 'ID'
en['mcp.detail.id'] = 'ID'
zh['mcp.detail.source'] = '来源'
en['mcp.detail.source'] = 'Source'
zh['mcp.detail.patch'] = 'Patch 文件'
en['mcp.detail.patch'] = 'Patch file'
zh['mcp.detail.readOnly'] = '只读原因'
en['mcp.detail.readOnly'] = 'Read-only reason'
zh['mcp.detail.error'] = '错误'
en['mcp.detail.error'] = 'Error'
zh['mcp.detail.config'] = '原始配置（密钥已掩码）'
en['mcp.detail.config'] = 'Raw config (secrets masked)'
zh['mcp.delete.title'] = '删除 MCP 服务'
en['mcp.delete.title'] = 'Delete MCP server'
zh['mcp.delete.bodyProfile'] = '将从 {path} 中删除 MCP 服务「{name}」；此操作会写入 profile 配置并通过 DSH 重载生效。'
en['mcp.delete.bodyProfile'] = 'Removes MCP server "{name}" from {path}. The change is written to the profile and applied through DSH reload.'
zh['mcp.delete.bodyBundle'] = 'MCP 服务「{name}」由 DSH bundle 提供，无法从配置文件中删除；确认后只会将它禁用。'
en['mcp.delete.bodyBundle'] = 'MCP server "{name}" is provided by the DSH bundle and cannot be removed from the config; confirming only disables it.'
zh['mcp.toast.created'] = 'MCP 服务已添加'
en['mcp.toast.created'] = 'MCP server added'
zh['mcp.toast.updated'] = 'MCP 服务已更新'
en['mcp.toast.updated'] = 'MCP server updated'
zh['mcp.toast.deleted'] = 'MCP 服务已删除'
en['mcp.toast.deleted'] = 'MCP server deleted'
zh['mcp.toast.disabled'] = 'MCP 服务已禁用'
en['mcp.toast.disabled'] = 'MCP server disabled'
zh['mcp.toast.enabled'] = 'MCP 服务已启用'
en['mcp.toast.enabled'] = 'MCP server enabled'
zh['mcp.error.name'] = '服务名必须是 1-32 位字母、数字、下划线或连字符。'
en['mcp.error.name'] = 'The server name must be 1-32 letters, digits, underscores or hyphens.'
zh['mcp.error.command'] = 'stdio 传输必须填写启动命令。'
en['mcp.error.command'] = 'stdio transport requires a command.'
zh['mcp.error.url'] = 'streamable-http 传输必须填写合法的 http(s) URL。'
en['mcp.error.url'] = 'streamable-http transport requires a valid http(s) URL.'
zh['mcp.error.env'] = '环境变量格式不正确，请使用 KEY=VALUE 逐行填写。'
en['mcp.error.env'] = 'Invalid environment variables; use one KEY=VALUE per line.'
zh['mcp.error.headers'] = '请求头格式不正确，请使用 KEY=VALUE 逐行填写。'
en['mcp.error.headers'] = 'Invalid headers; use one KEY=VALUE per line.'
zh['mcp.error.timeout'] = '调用超时必须是正整数毫秒数。'
en['mcp.error.timeout'] = 'The call timeout must be a positive whole number of milliseconds.'
zh['mcp.error.keyValue'] = '格式不正确，请使用 KEY=VALUE 逐行填写。'
en['mcp.error.keyValue'] = 'Invalid format; use one KEY=VALUE per line.'
zh['mcp.error.save'] = '保存 MCP 服务失败'
en['mcp.error.save'] = 'Failed to save the MCP server'
zh['mcp.error.delete'] = '删除 MCP 服务失败'
en['mcp.error.delete'] = 'Failed to delete the MCP server'
zh['mcp.error.toggle'] = '切换 MCP 服务状态失败'
en['mcp.error.toggle'] = 'Failed to toggle the MCP server'
zh['mcp.form.createTitle'] = '添加 MCP 服务'
en['mcp.form.createTitle'] = 'Add MCP server'
zh['mcp.form.editTitle'] = '编辑 MCP 服务'
en['mcp.form.editTitle'] = 'Edit MCP server'
zh['mcp.form.id'] = 'ID：{id}'
en['mcp.form.id'] = 'ID: {id}'
zh['mcp.form.name'] = '服务名'
en['mcp.form.name'] = 'Server name'
zh['mcp.form.nameHint'] = '仅支持字母、数字、下划线和连字符，最长 32 个字符。'
en['mcp.form.nameHint'] = 'Letters, digits, underscores and hyphens only, at most 32 characters.'
zh['mcp.form.transport'] = '传输方式'
en['mcp.form.transport'] = 'Transport'
zh['mcp.form.command'] = '命令'
en['mcp.form.command'] = 'Command'
zh['mcp.form.args'] = '参数（每行一个）'
en['mcp.form.args'] = 'Arguments (one per line)'
zh['mcp.form.argsHint'] = '每行一个参数，作为独立参数传给命令。'
en['mcp.form.argsHint'] = 'One argument per line; each line is passed to the command separately.'
zh['mcp.form.cwd'] = '工作目录'
en['mcp.form.cwd'] = 'Working directory'
zh['mcp.form.cwdPlaceholder'] = '留空使用当前工作目录'
en['mcp.form.cwdPlaceholder'] = 'Leave empty to use the current working directory'
zh['mcp.form.env'] = '环境变量（每行 KEY=VALUE）'
en['mcp.form.env'] = 'Environment (KEY=VALUE per line)'
zh['mcp.form.envHint'] = '敏感值会显示为掩码 {mask}；保持掩码原样提交即可沿用已保存的密钥。'
en['mcp.form.envHint'] = 'Secret values are shown as {mask}; submit the mask unchanged to keep the saved secret.'
zh['mcp.form.url'] = 'URL'
en['mcp.form.url'] = 'URL'
zh['mcp.form.urlHint'] = 'MCP 流式 HTTP 端点，例如 https://example.com/mcp。'
en['mcp.form.urlHint'] = 'MCP streamable HTTP endpoint, for example https://example.com/mcp.'
zh['mcp.form.headers'] = '请求头（每行 KEY=VALUE）'
en['mcp.form.headers'] = 'Headers (KEY=VALUE per line)'
zh['mcp.form.headersHint'] = '敏感值会显示为掩码 {mask}；保持掩码原样提交即可沿用已保存的密钥。'
en['mcp.form.headersHint'] = 'Secret values are shown as {mask}; submit the mask unchanged to keep the saved secret.'
zh['mcp.form.advanced'] = '高级选项'
en['mcp.form.advanced'] = 'Advanced'
zh['mcp.form.failOnStartupError'] = '启动失败时阻止 DSH 启动'
en['mcp.form.failOnStartupError'] = 'Block DSH startup when this server fails'
zh['mcp.form.timeout'] = '调用超时（毫秒）'
en['mcp.form.timeout'] = 'Call timeout (ms)'
zh['mcp.form.timeoutHint'] = '留空使用 DSH 默认值。'
zh['mcp.form.expressionHint'] = '值以 !!js 开头表示 Loader 表达式：编辑已有表达式可原样保留，新增服务时不支持。'
en['mcp.form.timeoutHint'] = 'Leave empty to use the DSH default.'
en['mcp.form.expressionHint'] = 'A value starting with !!js is a Loader expression: existing expressions can be kept as-is; creating a server does not accept them.'
zh['mcp.form.save'] = '保存'
en['mcp.form.save'] = 'Save'
zh['mcp.form.saving'] = '保存中…'
en['mcp.form.saving'] = 'Saving...'
zh['mcp.form.cancel'] = '取消'
en['mcp.form.cancel'] = 'Cancel'

zh['home.mcp'] = 'MCP 服务'
en['home.mcp'] = 'MCP servers'
zh['home.mcp.entry'] = 'MCP 服务'
en['home.mcp.entry'] = 'MCP servers'
zh['home.mcp.loading'] = '加载中…'
en['home.mcp.loading'] = 'Loading...'
zh['home.mcp.error'] = 'MCP 服务读取失败，可稍后重试。'
en['home.mcp.error'] = 'Failed to load MCP servers; try again later.'
zh['home.mcp.unavailable'] = '当前 DSH 环境不支持 MCP 服务管理。'
en['home.mcp.unavailable'] = 'This DSH environment does not support MCP server management.'
zh['home.mcp.empty'] = '当前 profile 还没有 MCP 服务。'
en['home.mcp.empty'] = 'This profile has no MCP servers yet.'
zh['home.mcp.summary'] = '已启用 {enabled} / 共 {total}'
en['home.mcp.summary'] = '{enabled} enabled / {total} total'
zh['home.mcp.manage'] = '管理 MCP'
en['home.mcp.manage'] = 'Manage MCP'

zh['breadcrumb.mcp'] = 'MCP 服务'
en['breadcrumb.mcp'] = 'MCP servers'
zh['mcp.disable.title'] = '禁用 MCP 服务'
en['mcp.disable.title'] = 'Disable MCP server'
zh['mcp.detail.tools'] = '工具数'
en['mcp.detail.tools'] = 'Tools'
zh['mcp.source.unknown'] = '未知来源'
en['mcp.source.unknown'] = 'Unknown source'
zh['mcp.disable.body'] = 'MCP 服务「{name}」无法从配置文件中删除；确认后只会切换它的启用状态。'
en['mcp.disable.body'] = 'MCP server "{name}" cannot be removed from the config; confirming only toggles whether it is enabled.'

/* REQ-20261031-004: project documents tab and requirement favorites. */
zh['project.tab.documents'] = '文档'
en['project.tab.documents'] = 'Documents'
zh['project.documents.title'] = '文档'
en['project.documents.title'] = 'Documents'
zh['project.documents.new'] = '新建文档'
en['project.documents.new'] = 'New document'
zh['project.documents.search'] = '搜索文档…'
en['project.documents.search'] = 'Search documents…'
zh['project.documents.search.scope'] = '检索范围'
en['project.documents.search.scope'] = 'Search scope'
zh['project.documents.search.title'] = '标题'
en['project.documents.search.title'] = 'Title'
zh['project.documents.search.full'] = '全文'
en['project.documents.search.full'] = 'Full text'
zh['project.documents.search.loading'] = '检索中…'
en['project.documents.search.loading'] = 'Searching...'
zh['project.documents.search.failed'] = '全文检索失败'
en['project.documents.search.failed'] = 'Full-text search failed'
zh['project.documents.search.retry'] = '重试'
en['project.documents.search.retry'] = 'Retry'
zh['project.documents.search.hasMore'] = '匹配较多，仅显示前 {count} 条'
en['project.documents.search.hasMore'] = 'Many matches; showing the first {count}'
zh['project.documents.empty'] = '暂无文档'
en['project.documents.empty'] = 'No documents yet'
zh['project.documents.emptyFilter'] = '没有匹配的文档'
en['project.documents.emptyFilter'] = 'No matching documents'
zh['project.documents.unconfigured'] = '需求根目录未配置'
en['project.documents.unconfigured'] = 'Requirements root is not configured'
zh['project.documents.settings'] = '前往设置'
en['project.documents.settings'] = 'Open settings'
zh['project.documents.empty.title'] = '选择左侧文档查看内容'
en['project.documents.empty.title'] = 'Select a document to view its content'
zh['project.documents.empty.body'] = '也可以新建一个文档开始记录。'
en['project.documents.empty.body'] = 'Or create a new document to get started.'
zh['project.documents.noBody'] = '暂无正文，点击「编辑」开始记录。'
en['project.documents.noBody'] = 'No content yet. Click Edit to start writing.'
zh['project.documents.loadFailed'] = '文档加载失败'
en['project.documents.loadFailed'] = 'Failed to load the document'
zh['project.documents.edit'] = '编辑'
en['project.documents.edit'] = 'Edit'
zh['project.documents.delete'] = '删除文档'
en['project.documents.delete'] = 'Delete document'
zh['project.documents.save'] = '保存'
en['project.documents.save'] = 'Save'
zh['project.documents.saving'] = '保存中…'
en['project.documents.saving'] = 'Saving...'
zh['project.documents.saved'] = '已保存'
en['project.documents.saved'] = 'Saved'
zh['project.documents.saveHint'] = '⌘/Ctrl + S 保存（不会退出编辑）'
en['project.documents.saveHint'] = 'Cmd/Ctrl + S saves without leaving the editor'
zh['project.documents.titleRequired'] = '文档标题不能为空'
en['project.documents.titleRequired'] = 'The document title cannot be empty'
zh['project.documents.editor.aria'] = '文档正文 Markdown 编辑器'
en['project.documents.editor.aria'] = 'Document body Markdown editor'
zh['project.documents.createdAt'] = '创建时间'
en['project.documents.createdAt'] = 'Created'
zh['project.documents.updatedAt'] = '更新时间'
en['project.documents.updatedAt'] = 'Updated'
zh['project.documents.delete.title'] = '删除文档'
en['project.documents.delete.title'] = 'Delete document'
zh['project.documents.delete.body'] = '确定删除「{name}」吗？该操作不可恢复。'
en['project.documents.delete.body'] = 'Delete "{name}"? This cannot be undone.'
zh['project.documents.delete.busy'] = '删除中…'
en['project.documents.delete.busy'] = 'Deleting...'
zh['project.documents.deleted'] = '文档已删除'
en['project.documents.deleted'] = 'Document deleted'
zh['project.documents.created'] = '文档已创建'
en['project.documents.created'] = 'Document created'
zh['project.documents.new.title'] = '新建文档'
en['project.documents.new.title'] = 'New document'
zh['project.documents.new.name'] = '文档标题'
en['project.documents.new.name'] = 'Title'
zh['project.documents.new.name.placeholder'] = '例如：发布流程'
en['project.documents.new.name.placeholder'] = 'e.g. Release process'
zh['project.documents.new.body'] = '初始正文（可选，Markdown）'
en['project.documents.new.body'] = 'Initial body (optional, Markdown)'
zh['project.documents.new.body.placeholder'] = '可以之后再编辑；留空会创建一个空文档。'
en['project.documents.new.body.placeholder'] = 'You can edit it later. Leave empty to create an empty document.'
zh['project.documents.new.create'] = '创建'
en['project.documents.new.create'] = 'Create'
zh['project.documents.new.creating'] = '创建中…'
en['project.documents.new.creating'] = 'Creating...'
zh['project.documents.conflict.banner'] = '服务器上的文档已更新，本地草稿已保留。'
en['project.documents.conflict.banner'] = 'The document changed on the server; your local draft was kept.'
zh['project.documents.conflict.reload'] = '重新加载'
en['project.documents.conflict.reload'] = 'Reload'
zh['project.documents.conflict.overwrite'] = '覆盖保存'
en['project.documents.conflict.overwrite'] = 'Overwrite and save'
zh['project.documents.conflict.reloaded'] = '已重新加载服务器内容，本地草稿已保留'
en['project.documents.conflict.reloaded'] = 'Reloaded the server content; your local draft was kept'
zh['project.documents.conflict.overwritten'] = '已覆盖保存'
en['project.documents.conflict.overwritten'] = 'Saved and overwrote the server content'
zh['project.requirements.favorite'] = '收藏'
en['project.requirements.favorite'] = 'Favorite'
zh['project.requirements.unfavorite'] = '取消收藏'
en['project.requirements.unfavorite'] = 'Unfavorite'
zh['project.requirements.favoriteOnly'] = '仅收藏'
en['project.requirements.favoriteOnly'] = 'Favorites only'
zh['project.requirements.favoriteFailed'] = '更新收藏状态失败'
en['project.requirements.favoriteFailed'] = 'Failed to update the favorite state'

/* REQ-20261101-001: plugin version display and one-click self-upgrade. */
zh['update.about.title'] = '关于插件'
en['update.about.title'] = 'About plugin'
zh['update.about.hint'] = '查看当前版本与 npm 上的最新版本；升级会修改当前 DSH profile 的依赖，完成后需要重启 DSH。'
en['update.about.hint'] = 'Compare the running version with the latest npm release; upgrading changes the current DSH profile and needs a DSH restart.'
zh['update.about.current'] = '当前版本'
en['update.about.current'] = 'Current version'
zh['update.about.latest'] = '最新版本'
en['update.about.latest'] = 'Latest version'
zh['update.about.installed'] = '已安装版本'
en['update.about.installed'] = 'Installed version'
zh['update.about.kind'] = '安装方式'
en['update.about.kind'] = 'Install type'
zh['update.about.kind.package'] = 'npm 安装'
en['update.about.kind.package'] = 'npm package'
zh['update.about.kind.link'] = '本地开发（link）'
en['update.about.kind.link'] = 'Local development (link)'
zh['update.about.kind.unknown'] = '未知'
en['update.about.kind.unknown'] = 'Unknown'
zh['update.about.status'] = '升级状态'
en['update.about.status'] = 'Upgrade status'
zh['update.about.repo'] = '项目地址'
en['update.about.repo'] = 'Project page'
zh['update.status.latest'] = '已是最新版本'
en['update.status.latest'] = 'Up to date'
zh['update.status.available'] = '发现新版本 v{version}'
en['update.status.available'] = 'New version v{version} available'
zh['update.status.checking'] = '正在检查更新…'
en['update.status.checking'] = 'Checking for updates...'
zh['update.status.error'] = '检查更新失败'
en['update.status.error'] = 'Update check failed'
zh['update.status.restart'] = '已安装 v{version}，重启 DSH 生效'
en['update.status.restart'] = 'Installed v{version}; restart DSH to apply'
zh['update.status.dev'] = '本地开发模式，禁用一键升级'
en['update.status.dev'] = 'Local development mode; one-click upgrade disabled'
zh['update.status.devHint'] = '当前为本地 link 安装（开发模式），不支持一键升级；请改为从 npm 安装后再使用升级'
en['update.status.devHint'] = 'Installed via a local link in development mode, so one-click upgrade is disabled; install from npm to use it'
zh['update.status.unknown'] = '版本信息暂不可用'
en['update.status.unknown'] = 'Version information unavailable'
zh['update.badge.available'] = '升级到 v{version}'
en['update.badge.available'] = 'Upgrade to v{version}'
zh['update.badge.checking'] = '检查更新中…'
en['update.badge.checking'] = 'Checking for updates...'
zh['update.badge.upgrading'] = '升级中…'
en['update.badge.upgrading'] = 'Upgrading...'
zh['update.badge.restart'] = '重启 DSH 生效'
en['update.badge.restart'] = 'Restart DSH to apply'
zh['update.action.upgrade'] = '立即升级'
en['update.action.upgrade'] = 'Upgrade now'
zh['update.action.check'] = '检查更新'
en['update.action.check'] = 'Check for updates'
zh['update.action.retry'] = '重试'
en['update.action.retry'] = 'Retry'
zh['update.confirm.title'] = '升级插件'
en['update.confirm.title'] = 'Upgrade plugin'
zh['update.confirm.body'] = '将把 {packageName} 从 v{current} 升级到 v{latest}，会修改当前 DSH profile 的依赖，完成后需要重启 DSH 才会生效。'
en['update.confirm.body'] = 'This upgrades {packageName} from v{current} to v{latest} in the current DSH profile; restart DSH afterwards for it to take effect.'
zh['update.confirm.detail'] = 'npm 安装可能需要几分钟，升级期间请勿关闭 DSH。'
en['update.confirm.detail'] = 'npm install can take a few minutes; keep DSH open while it runs.'
zh['update.confirm.ok'] = '开始升级'
en['update.confirm.ok'] = 'Start upgrade'
zh['update.confirm.cancel'] = '取消'
en['update.confirm.cancel'] = 'Cancel'
zh['update.success'] = '已安装 v{version}，重启 DSH 生效'
en['update.success'] = 'Installed v{version}; restart DSH to apply'
zh['update.failed'] = '升级失败'
en['update.failed'] = 'Upgrade failed'
zh['update.blocked.checking'] = '正在检查更新，请稍候'
en['update.blocked.checking'] = 'A check is running; try again shortly'
zh['update.blocked.environment'] = '当前 DSH 环境未提供 profile 信息，无法自动升级'
en['update.blocked.environment'] = 'This DSH environment does not expose profile info, so the upgrade cannot run automatically'
zh['update.blocked.unavailable'] = '当前不可升级，请检查安装方式或网络'
en['update.blocked.unavailable'] = 'Upgrade is unavailable; check the install type or the network'
