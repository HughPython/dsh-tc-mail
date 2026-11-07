/**
 * Agent-facing tools. Every tool calls the same `mail-service` used by the UI,
 * so the model and the panel can never disagree about what an operation means.
 *
 * Permanent deletion (`+delete`) is deliberately not exposed: it is
 * irreversible, so it stays a user-only action in the panel.
 */

export const MAIL_PROMPT = [
  '本机已挂载「我的邮箱」（腾讯 Agent Mail，左侧栏入口）。用户提到收发邮件、查看邮件、搜索邮件、删除邮件时，优先用 mail_* 工具而不是 shell 调用 agently-cli：',
  '- mail_list：按文件夹（inbox/sent/trash/spam）列出邮件摘要；',
  '- mail_read：按 message_id 读取正文与附件；',
  '- mail_search：按关键词搜索邮件；',
  '- mail_send：发送新邮件（收件人数组 + 主题 + 纯文本正文）；',
  '- mail_trash：把邮件移入垃圾箱（30 天内可恢复，需 confirm=true）。',
  '永久删除不可恢复，工具层未开放，请让用户在邮件面板中操作。发送前务必把收件人、主题、正文回读给用户确认。',
].join('\n')

const textRender = (formatter) => (_args, value) => [{ type: 'text', text: formatter(value) }]

function addressSchema() {
  return { type: 'array', items: { type: 'string' }, description: '邮箱地址数组' }
}

export function buildTools({ mail }) {
  return [
    {
      name: 'mail_list',
      description: '列出 Agent Mail 邮箱中的邮件摘要。dir 可选 inbox（收件箱）、sent（发件箱）、trash（垃圾箱）、spam（垃圾邮件）。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dir: { type: 'string', enum: ['inbox', 'sent', 'trash', 'spam'], description: '文件夹，默认 inbox' },
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
            nextCursor: { type: ['string', 'null'] },
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
          dir: { type: 'string', enum: ['inbox', 'sent', 'trash', 'spam'], description: '文件夹，默认 inbox' },
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
      name: 'mail_trash',
      description: '把邮件移入垃圾箱（软删除，30 天内可从垃圾箱恢复）。必须显式传 confirm=true，并先向用户说明。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'confirm'],
        properties: {
          id: { type: 'string', description: '邮件 ID（msg_ 前缀）' },
          confirm: { type: 'boolean', description: '必须为 true，表示用户已确认移动该邮件到垃圾箱' },
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: textRender((value) => `已移入垃圾箱：${((value && value.moved) || []).join(', ') || '无'}`),
      },
      async execute(args) {
        if (!args || args.confirm !== true) {
          throw new Error('mail_trash 需要 confirm=true，且必须先取得用户确认。')
        }
        return mail.trash({ ids: [args.id] })
      },
    },
  ]
}

export function registerTools({ ctx, mail }) {
  const disposers = buildTools({ mail }).map((tool) => ctx.tools.register(tool))
  return () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose()
    }
  }
}
