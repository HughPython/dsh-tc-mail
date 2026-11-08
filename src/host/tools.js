/**
 * Agent-facing tools. Every tool calls the same `mail-service` used by the UI,
 * so the model and the panel can never disagree about what an operation means.
 *
 * Permanent deletion (`+delete`) is deliberately not exposed: it is
 * irreversible, so it stays a user-only action in the panel.
 */

export const MAIL_PROMPT = [
  '本机已挂载「我的邮箱」（腾讯 Agent Mail，Harness 左侧栏入口），这是用户在 Harness 里唯一的收发邮件通道。',
  '凡是用户要求「发邮件 / 回邮件 / 看看收件箱 / 找某封邮件」这类请求，默认就用 mail_* 工具，不要用 shell 调 agently-cli，也不需要额外的邮件 skill：',
  '- mail_health：查询当前授权的发件账号、今日发信额度与剩余配额（不确定用哪个地址发信时先调它）；',
  '- mail_list：列出收件箱或发件箱的邮件摘要；',
  '- mail_read：按 message_id 读取正文与附件；',
  '- mail_search：按关键词搜索邮件；',
  '- mail_send：用本机已授权的 Agent Mail 账号发送邮件（收件人数组 + 主题 + 纯文本正文）。',
  '发信前必须把收件人、主题、正文回读给用户确认；用户没指定发件账号时，直接用 mail_health 返回的那个邮箱地址。',
  '删除不可恢复，工具层未开放：用户要删邮件时，引导他们在邮件面板里勾选后删除。',
].join('\n')

const textRender = (formatter) => (_args, value) => [{ type: 'text', text: formatter(value) }]

function addressSchema() {
  return { type: 'array', items: { type: 'string' }, description: '邮箱地址数组' }
}

export function buildTools({ mail }) {
  return [
    {
      name: 'mail_list',
      description: '列出 Agent Mail 邮箱中的邮件摘要。dir 可选 inbox（收件箱）或 sent（发件箱）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', enum: ['inbox', 'sent'], description: '文件夹，默认 inbox' },
          limit: { type: 'number', description: '返回条数，1-50，默认 10' },
          unread_only: { type: 'boolean', description: '仅返回未读邮件' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            items: { type: 'array' },
            hasMore: { type: 'boolean' },
            nextCursor: { type: 'string', description: '下一页游标，末页时为空' },
          },
        },
        render: textRender((value) => {
          const items = (value && value.items) || []
          if (!items.length) return '没有符合条件的邮件。'
          const lines = items.map((item, index) => {
            const flag = item.isRead ? '  ' : '● '
            const from = (item.from && (item.from.name || item.from.email)) || '未知发件人'
            return `${index + 1}. ${flag}${item.subject || '(无主题)'} — ${from} — ${item.createdAt || ''} — ${item.id}`
          })
          lines.push(value && value.hasMore ? '（还有更多，可传 cursor 继续翻页）' : '（已到末页）')
          return lines.join('\n')
        }),
      },
      async execute(args) {
        return mail.list({
          dir: (args && args.dir) || 'inbox',
          limit: Number(args && args.limit) || 10,
          unreadOnly: Boolean(args && args.unread_only),
        })
      },
    },
    {
      name: 'mail_read',
      description: '读取一封邮件的完整正文、收发件人与附件列表。需要 message_id（可从 mail_list 或 mail_search 获得）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', description: '邮件 ID（msg_ 前缀）' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: textRender((value) => {
          if (!value) return '未找到该邮件。'
          const from = (value.from && (value.from.name || value.from.email)) || ''
          const to = (value.to || []).map((entry) => entry.email).join(', ')
          const attachments = (value.attachments || []).map((entry) => entry.filename).join(', ')
          const body = String(value.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          return [
            `主题：${value.subject || '(无主题)'}`,
            `发件人：${from}`,
            `收件人：${to}`,
            `时间：${value.createdAt || ''}`,
            `格式：${value.bodyFormat}`,
            attachments ? `附件：${attachments}` : '',
            '',
            body.slice(0, 4000),
          ]
            .filter(Boolean)
            .join('\n')
        }),
      },
      async execute(args) {
        return mail.read(args && args.id)
      },
    },
    {
      name: 'mail_search',
      description: '按关键词搜索邮箱中的邮件（默认在主题与正文中搜索）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['q'],
        properties: {
          q: { type: 'string', description: '搜索关键词或短语' },
          dir: { type: 'string', enum: ['inbox', 'sent'], description: '文件夹，默认 inbox' },
          limit: { type: 'number', description: '返回条数，1-50，默认 10' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: textRender((value) => {
          const items = (value && value.items) || []
          if (!items.length) return '没有匹配的邮件。'
          return items
            .map((item, index) => `${index + 1}. ${item.subject || '(无主题)'} — ${(item.from && item.from.email) || ''} — ${item.createdAt || ''} — ${item.id}`)
            .join('\n')
        }),
      },
      async execute(args) {
        return mail.search({
          q: args && args.q,
          dir: (args && args.dir) || 'inbox',
          limit: Number(args && args.limit) || 10,
        })
      },
    },
    {
      name: 'mail_send',
      description: '发送一封新邮件。发信前请把收件人、主题与正文回读给用户确认。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['to', 'subject', 'body'],
        properties: {
          to: addressSchema(),
          subject: { type: 'string', description: '邮件主题' },
          body: { type: 'string', description: '纯文本正文' },
          cc: addressSchema(),
          bcc: addressSchema(),
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: textRender((value) => `已提交发送：${(value && value.subject) || ''} → ${((value && value.recipients) || []).join(', ')}`),
      },
      async execute(args) {
        return mail.send({
          to: (args && args.to) || [],
          cc: (args && args.cc) || [],
          bcc: (args && args.bcc) || [],
          subject: (args && args.subject) || '',
          body: (args && args.body) || '',
          bodyFormat: 'plain',
        })
      },
    },
    {
      name: 'mail_health',
      description: '查询当前 Agent Mail 的授权状态、发件邮箱地址与今日发信额度。发信前不确定用哪个地址时调用。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: textRender((value) => {
          if (!value || !value.ready) return `尚未就绪：${(value && value.reason) || '未知原因'}`
          const account = value.account || {}
          const quota = account.quota || '—'
          const used = Number.isFinite(value.sentToday) ? value.sentToday : '—'
          return `发件账号：${account.email || '未知'}（今日已发 ${used}/${quota}）`
        }),
      },
      async execute() {
        const health = await mail.health()
        return {
          ready: health.ready,
          reason: health.reason,
          email: health.account && health.account.email,
          quota: health.account && health.account.quota,
          sentToday: health.sentToday,
        }
      },
    },
  ]
}

export const TOOL_NAMES = ['mail_health', 'mail_list', 'mail_read', 'mail_search', 'mail_send']

export function registerTools({ ctx, mail }) {
  const tools = buildTools({ mail })
  const disposers = tools.map((tool) => ctx.tools.register(tool))
  return {
    names: tools.map((tool) => tool.name),
    dispose() {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') dispose()
      }
    },
  }
}
