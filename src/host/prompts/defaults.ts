/** Default requirement Markdown scaffold. */
const parts = ["# ","\n\n## 背景\n\n\n## 需求内容\n\n\n## 验收标准\n\n"]
export function defaultRequirementBody(title) {
  return parts[0] + title + parts[1]
}

/** Default Git commit message. */
export const DEFAULT_COMMIT_MESSAGE = "chore(requirements): 更新需求文档"
