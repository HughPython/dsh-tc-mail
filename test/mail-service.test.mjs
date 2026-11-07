import assert from 'node:assert/strict'
import test from 'node:test'

import { __test__ } from '../src/host/mail-service.js'

const { normalizeSummary, normalizeDetail, normalizeAttachments, safeFileName } = __test__

test('normalizeSummary keeps the fields the UI needs and tolerates a string dir', () => {
  const summary = normalizeSummary({
    message_id: 'msg_1',
    subject: ' Hi ',
    snippet: 'body',
    from: { name: 'Alice', email: 'alice@example.com' },
    to: [{ email: 'bob@example.com' }],
    created_at: '2026-01-02T03:04:05Z',
    is_read: false,
    has_attachments: true,
    dir: { dir_id: 1, dir_name: 'inbox' },
  })
  assert.equal(summary.id, 'msg_1')
  assert.equal(summary.subject, 'Hi')
  assert.equal(summary.from.email, 'alice@example.com')
  assert.deepEqual(summary.to, [{ email: 'bob@example.com', name: '' }])
  assert.equal(summary.isRead, false)
  assert.equal(summary.hasAttachments, true)
  assert.equal(summary.dir, 'inbox')
})

test('normalizeSummary rejects rows without an id', () => {
  assert.equal(normalizeSummary({ subject: 'x' }), null)
  assert.equal(normalizeSummary(null), null)
})

test('normalizeSummary treats a missing is_read as read', () => {
  const summary = normalizeSummary({ message_id: 'msg_2' })
  assert.equal(summary.isRead, true)
})

test('normalizeDetail flattens the body contract', () => {
  const detail = normalizeDetail({
    message_id: 'msg_3',
    subject: 's',
    body: '<p>hi</p>',
    body_format: 'html',
    attachments: [{ attachment_id: 'att_1', filename: 'a.pdf', content_type: 'application/pdf', size: '2048' }],
    cc: ['carol@example.com'],
  })
  assert.equal(detail.bodyFormat, 'HTML')
  assert.equal(detail.attachments[0].id, 'att_1')
  assert.equal(detail.attachments[0].size, 2048)
  assert.deepEqual(detail.cc, [{ email: 'carol@example.com', name: '' }])
})

test('normalizeAttachments names unnamed entries', () => {
  const list = normalizeAttachments([{ attachment_id: 'att_9' }, {}])
  assert.equal(list[0].filename, '附件 1')
  assert.equal(list[1].id, '')
})

test('safeFileName strips path separators and control characters', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'etc_passwd')
  assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j')
  assert.equal(safeFileName(''), 'attachment')
  assert.ok(safeFileName('x'.repeat(400)).length <= 120)
})
