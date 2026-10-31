/** Requirement detail / master-detail dictionaries (merged in i18n.js). Keys must exist in both languages. */
export const zh = {
  'project.sidebar.collapse': '收起项目栏',
  'project.sidebar.expand': '展开项目栏',
  'detail.list.title': '需求',
  'detail.list.count': '{count} 个',
  'detail.list.filterStatus': '状态筛选',
  'detail.list.filterAll': '全部状态',
  'detail.list.emptyFilter': '没有匹配的需求',
  'detail.list.activeTask': '执行中',
  'detail.empty.title': '选择左侧需求查看详情',
  'detail.empty.body': '也可以新建一个需求开始记录。',
  'detail.saveState.unsaved': '未保存',
  'detail.saveState.saving': '保存中…',
  'detail.saveState.saved': '已保存 {time}',
  'detail.saveHint': '⌘/Ctrl + S 保存',
  'detail.titleRequired': '需求标题不能为空',
  'detail.draftRecover.title': '发现未保存的草稿',
  'detail.draftRecover.body': '上次自动保存于 {time}，与服务器内容不同。',
  'detail.draftRecover.restore': '恢复草稿',
  'detail.draftRecover.discard': '丢弃草稿',
  'detail.draftRecover.restored': '已恢复草稿',
  'detail.draftRecover.discarded': '已丢弃草稿',
  'detail.discardDraft.title': '放弃未保存的修改？',
  'detail.discardDraft.body': '当前编辑内容尚未保存，关闭后将丢失。',
  'detail.status.saved': '状态已更新为「{status}」',
  'detail.status.undo': '撤销',
  'detail.status.confirm.title': '将状态改为「{status}」？',
  'detail.status.confirm.body': '状态会立即更新，之后仍可再次切换。',
  'detail.status.confirm.action': '确认修改',
  'detail.status.failed': '状态更新失败',
  'detail.conflict.title': '需求已被修改',
  'detail.conflict.body': '服务器上的内容在你编辑期间已更新。请选择如何处理本地修改。',
  'detail.conflict.reload': '重新加载（丢弃本地）',
  'detail.conflict.overwrite': '覆盖保存',
  'detail.conflict.cancel': '继续编辑',
  'detail.conflict.banner': '服务器内容已更新，本地修改尚未保存。',
  'detail.conflict.reloaded': '已重新加载服务器内容',
  'detail.conflict.overwritten': '已覆盖保存',
  'detail.delete.blockedActive': '该需求有正在执行的任务，暂时无法删除。',
  'detail.delete.busy': '删除中…',
  'detail.delete.impactTasks': '活动任务：{count}',
  'detail.delete.impactWorktree': '该需求启用了 worktree；删除需求不会移除 worktree 目录，分支 {branch} 会保留。',
  'detail.worktree.remove.blockedActive': '该需求有正在执行的任务，暂时无法移除 worktree。',
  'detail.worktree.remove.activeNote': '检测到活动任务，移除 worktree 可能影响正在执行的会话。',
  'detail.execute.openSession': '打开执行会话',
  'detail.execute.blockedActive': '该需求有正在执行的任务，请稍后再试。',
  'detail.execute.markRunningFailed': '执行已开始，但更新需求状态失败：{error}',
  'detail.files.unsaved': '未保存',
  'detail.files.saving': '保存中…',
  'detail.files.dirtyConfirm.title': '附件有未保存的修改',
  'detail.files.dirtyConfirm.body': '切换文件或离开将丢失当前修改。',
  'detail.files.discardAndLeave': '放弃修改并继续',
  'detail.files.keepEditing': '继续编辑',
  'detail.files.createBusy': '创建中…',
  'detail.files.deleteBusy': '删除中…',
  'project.requirements.deleteBlockedActive': '该需求有正在执行的任务，暂时无法删除。',
}

export const en = {
  'project.sidebar.collapse': 'Collapse project sidebar',
  'project.sidebar.expand': 'Expand project sidebar',
  'detail.list.title': 'Requirements',
  'detail.list.count': '{count}',
  'detail.list.filterStatus': 'Filter by status',
  'detail.list.filterAll': 'All statuses',
  'detail.list.emptyFilter': 'No matching requirements',
  'detail.list.activeTask': 'Running',
  'detail.empty.title': 'Select a requirement to view its details',
  'detail.empty.body': 'Or create a new requirement to get started.',
  'detail.saveState.unsaved': 'Unsaved',
  'detail.saveState.saving': 'Saving...',
  'detail.saveState.saved': 'Saved {time}',
  'detail.saveHint': 'Cmd/Ctrl + S to save',
  'detail.titleRequired': 'The requirement title cannot be empty',
  'detail.draftRecover.title': 'Unsaved draft found',
  'detail.draftRecover.body': 'Auto-saved at {time} and different from the server content.',
  'detail.draftRecover.restore': 'Restore draft',
  'detail.draftRecover.discard': 'Discard draft',
  'detail.draftRecover.restored': 'Draft restored',
  'detail.draftRecover.discarded': 'Draft discarded',
  'detail.discardDraft.title': 'Discard unsaved changes?',
  'detail.discardDraft.body': 'The current edits are not saved and will be lost after closing.',
  'detail.status.saved': 'Status changed to {status}',
  'detail.status.undo': 'Undo',
  'detail.status.confirm.title': 'Change the status to {status}?',
  'detail.status.confirm.body': 'The status updates immediately and can be changed again later.',
  'detail.status.confirm.action': 'Change status',
  'detail.status.failed': 'Failed to update the status',
  'detail.conflict.title': 'The requirement was modified',
  'detail.conflict.body': 'The server content changed while you were editing. Choose how to handle your local changes.',
  'detail.conflict.reload': 'Reload (discard local)',
  'detail.conflict.overwrite': 'Overwrite and save',
  'detail.conflict.cancel': 'Keep editing',
  'detail.conflict.banner': 'The server content changed; your local edits are not saved yet.',
  'detail.conflict.reloaded': 'Reloaded the server content',
  'detail.conflict.overwritten': 'Saved and overwrote the server content',
  'detail.delete.blockedActive': 'This requirement has a running task and cannot be deleted right now.',
  'detail.delete.busy': 'Deleting...',
  'detail.delete.impactTasks': 'Active tasks: {count}',
  'detail.delete.impactWorktree': 'This requirement uses a worktree; deleting the requirement keeps the worktree directory and branch {branch}.',
  'detail.worktree.remove.blockedActive': 'This requirement has a running task; its worktree cannot be removed right now.',
  'detail.worktree.remove.activeNote': 'An active task was detected; removing the worktree may affect the running session.',
  'detail.execute.openSession': 'Open execution session',
  'detail.execute.blockedActive': 'This requirement has a running task. Try again later.',
  'detail.execute.markRunningFailed': 'Execution started, but updating the requirement status failed: {error}',
  'detail.files.unsaved': 'Unsaved',
  'detail.files.saving': 'Saving...',
  'detail.files.dirtyConfirm.title': 'The attachment has unsaved changes',
  'detail.files.dirtyConfirm.body': 'Switching files or leaving will discard the current changes.',
  'detail.files.discardAndLeave': 'Discard and continue',
  'detail.files.keepEditing': 'Keep editing',
  'detail.files.createBusy': 'Creating...',
  'detail.files.deleteBusy': 'Deleting...',
  'project.requirements.deleteBlockedActive': 'This requirement has a running task and cannot be deleted right now.',
}

zh['markdown.mode.edit'] = '编辑'
zh['markdown.mode.split'] = '分栏'
zh['markdown.mode.preview'] = '预览'
zh['markdown.toolbar.heading1'] = '一级标题（# 标题）'
zh['markdown.toolbar.heading2'] = '二级标题（## 标题）'
zh['markdown.toolbar.heading3'] = '三级标题（### 标题）'
zh['markdown.toolbar.bold'] = '粗体（**文本**）'
zh['markdown.toolbar.italic'] = '斜体（*文本*）'
zh['markdown.toolbar.bullet'] = '无序列表（- 项目）'
zh['markdown.toolbar.ordered'] = '有序列表（1. 项目）'
zh['markdown.toolbar.quote'] = '引用（> 文本）'
zh['markdown.toolbar.code'] = '行内代码（`代码`）'
zh['markdown.toolbar.codeBlock'] = '代码块（``` 代码 ```）'
zh['markdown.toolbar.link'] = '链接（[文本](https://)）'
zh['markdown.toolbar.divider'] = '分割线（---）'
zh['markdown.toolbar.help'] = 'Markdown 语法提示'
zh['markdown.hint'] = '支持 Markdown：⌘/Ctrl+B 粗体、⌘/Ctrl+I 斜体、⌘/Ctrl+K 链接、⌘/Ctrl+S 保存。'
zh['markdown.preview.empty'] = '开始输入内容后在此实时预览。'
zh['markdown.linkPlaceholder'] = '链接文本'
zh['markdown.editor.aria'] = '需求正文 Markdown 编辑器'
zh['markdown.openPopup'] = '弹出编辑'
zh['markdown.popup.title'] = '编辑需求正文'
zh['markdown.popup.close'] = '关闭'
zh['markdown.popup.save'] = '保存并关闭'
zh['markdown.popup.fullscreen'] = '全屏编辑'
zh['markdown.popup.exitFullscreen'] = '退出全屏'
zh['markdown.help.title'] = 'Markdown 语法'
zh['markdown.help.intro'] = '支持以下常用 Markdown 语法；工具栏按钮可直接插入语法。'
zh['markdown.help.heading'] = '标题'
zh['markdown.help.bold'] = '粗体'
zh['markdown.help.italic'] = '斜体'
zh['markdown.help.code'] = '行内代码'
zh['markdown.help.codeBlock'] = '代码块'
zh['markdown.help.bullet'] = '无序列表'
zh['markdown.help.ordered'] = '有序列表'
zh['markdown.help.quote'] = '引用'
zh['markdown.help.link'] = '链接'
zh['markdown.help.divider'] = '分割线'
zh['detail.editor.done'] = '完成'
en['markdown.mode.edit'] = 'Edit'
en['markdown.mode.split'] = 'Split'
en['markdown.mode.preview'] = 'Preview'
en['markdown.toolbar.heading1'] = 'Heading 1 (# Heading)'
en['markdown.toolbar.heading2'] = 'Heading 2 (## Heading)'
en['markdown.toolbar.heading3'] = 'Heading 3 (### Heading)'
en['markdown.toolbar.bold'] = 'Bold (**text**)'
en['markdown.toolbar.italic'] = 'Italic (*text*)'
en['markdown.toolbar.bullet'] = 'Bullet list (- item)'
en['markdown.toolbar.ordered'] = 'Numbered list (1. item)'
en['markdown.toolbar.quote'] = 'Quote (> text)'
en['markdown.toolbar.code'] = 'Inline code (`code`)'
en['markdown.toolbar.codeBlock'] = 'Code block (``` code ```)'
en['markdown.toolbar.link'] = 'Link ([text](https://))'
en['markdown.toolbar.divider'] = 'Divider (---)'
en['markdown.toolbar.help'] = 'Markdown syntax help'
en['markdown.hint'] = 'Markdown supported: Cmd/Ctrl+B bold, Cmd/Ctrl+I italic, Cmd/Ctrl+K link, Cmd/Ctrl+S save.'
en['markdown.preview.empty'] = 'Start typing to see a live preview here.'
en['markdown.linkPlaceholder'] = 'Link text'
en['markdown.editor.aria'] = 'Requirement body Markdown editor'
en['markdown.openPopup'] = 'Open popup editor'
en['markdown.popup.title'] = 'Edit requirement body'
en['markdown.popup.close'] = 'Close'
en['markdown.popup.save'] = 'Save and close'
en['markdown.popup.fullscreen'] = 'Fullscreen editor'
en['markdown.popup.exitFullscreen'] = 'Exit fullscreen'
en['markdown.help.title'] = 'Markdown syntax'
en['markdown.help.intro'] = 'Common Markdown syntax is supported; toolbar buttons insert the syntax for you.'
en['markdown.help.heading'] = 'Heading'
en['markdown.help.bold'] = 'Bold'
en['markdown.help.italic'] = 'Italic'
en['markdown.help.code'] = 'Inline code'
en['markdown.help.codeBlock'] = 'Code block'
en['markdown.help.bullet'] = 'Bullet list'
en['markdown.help.ordered'] = 'Numbered list'
en['markdown.help.quote'] = 'Quote'
en['markdown.help.link'] = 'Link'
en['markdown.help.divider'] = 'Divider'
en['detail.editor.done'] = 'Done'
