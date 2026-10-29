export function taskIdFromPrompt(message) {
  const text = message && message.content && message.content[0] ? message.content[0].text : ''
  const match = /TASK-\d{8}-\d{3,}/.exec(text || '')
  return match === null ? '' : match[0]
}

export function promptText(message) {
  return message && message.content && message.content[0] ? message.content[0].text || '' : ''
}

export function createFakeAgentServices(options = {}) {
  const services = {}
  const createCalls = []
  const handles = []
  const disposeCalls = []
  const cancelCalls = []
  const followupMessages = []
  const restrictCalls = []
  const mountCalls = []
  const schemas = options.schemas || [
    { name: 'read' },
    { name: 'bash' },
    { name: 'write' },
    { name: 'project_commit_propose' },
  ]
  if (options.withDefaultModel !== false) {
    services.agentDefaultModel = {
      async currentSelection() {
        if (typeof options.currentSelection === 'function') return options.currentSelection()
        return { provider: 'fake-provider', model: 'fake-model', reasoningEffort: 'low' }
      },
    }
  }
  if (options.withPresets !== false) {
    services.agentPresets = {
      async resolve() { return options.presetId || 'fake-preset' },
      async mount(agentCtx, presetId) { mountCalls.push(presetId) },
    }
  }
  services.agents = {
    async create(payload) {
      createCalls.push(payload)
      if (options.agentCreateError) throw options.agentCreateError
      let resolveIdle = function () {}
      const idle = new Promise(function (resolve) { resolveIdle = resolve })
      const handle = {
        agent: {
          async followup(message) {
            followupMessages.push(message)
            if (typeof options.onFollowup === 'function') {
              await options.onFollowup({ payload, message, handle, services })
            }
          },
          async whenIdle() {
            if (options.waitForCancel === true) await idle
            if (typeof options.onIdle === 'function') await options.onIdle({ payload, handle })
          },
          async cancel(args) {
            cancelCalls.push({ args, payload, handle })
            resolveIdle()
            if (typeof options.onCancel === 'function') await options.onCancel({ args, payload, handle })
          },
        },
        async dispose() {
          disposeCalls.push(payload.sessionId)
        },
      }
      const agentCtx = {
        tools: {
          async schemas(agent) {
            if (typeof options.toolSchemas === 'function') return options.toolSchemas(agent)
            return schemas
          },
          async restrict(rule) {
            restrictCalls.push(rule)
          },
        },
      }
      if (typeof payload.setup === 'function') await payload.setup(agentCtx, {})
      handles.push(handle)
      return handle
    },
  }
  return {
    services,
    createCalls,
    handles,
    disposeCalls,
    cancelCalls,
    followupMessages,
    restrictCalls,
    mountCalls,
  }
}

export function createProjectAgentServices(getHarness, options = {}) {
  const calls = { reviews: [], commitProposals: [] }
  const fake = createFakeAgentServices({
    waitForCancel: options.waitForCancel === true,
    onFollowup: async function (context) {
      const harness = getHarness()
      const taskId = taskIdFromPrompt(context.message)
      const prompt = promptText(context.message)
      const exec = { agent: { session: { id: context.payload.sessionId } } }
      if (prompt.includes('project_commit_propose')) {
        const message = options.commitMessage || '\u63d0\u4ea4\u6d4b\u8bd5'
        const result = await harness.tools.get('project_commit_propose').execute({
          task_id: taskId,
          message,
        }, exec)
        calls.commitProposals.push({ taskId, message, result })
        if (result.ok !== true) throw new Error(result.message)
        return
      }
      const shown = await harness.tools.get('project_git_show').execute({ task_id: taskId }, exec)
      calls.reviews.push({ taskId, shown })
      if (shown.ok !== true) throw new Error(shown.message)
      if (typeof options.afterGitShow === 'function') await options.afterGitShow({ taskId, shown })
      const summary = options.reviewSummary || 'automated review'
      const content = options.reviewContent || '# Review\n\nLooks good.\n'
      const written = await harness.tools.get('project_review_write').execute({
        task_id: taskId,
        summary,
        content,
      }, exec)
      if (written.ok !== true) throw new Error(written.message)
    },
  })
  fake.calls = calls
  return fake
}
