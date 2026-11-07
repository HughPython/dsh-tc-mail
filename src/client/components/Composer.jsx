import { useRef, useState } from 'react'

import { Modal } from './Modal.jsx'
import { PaperclipIcon, CloseIcon } from './Icons.jsx'

const MAX_ATTACHMENT = 20 * 1024 * 1024

function splitAddresses(value) {
  return String(value || '')
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.includes('@'))
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export function Composer({ mode, message, t, onClose, onSubmit, onUpload, busy }) {
  const isNew = mode === 'new'
  const isReply = mode === 'reply'
  const isForward = mode === 'forward'

  const [to, setTo] = useState(() => (isReply ? (message && message.from && message.from.email) || '' : ''))
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState(() => {
    if (isNew) return ''
    if (!message) return ''
    const base = message.subject || ''
    if (isReply) return /^re:/i.test(base) ? base : `Re: ${base}`
    if (isForward) return /^fwd?:/i.test(base) ? base : `Fwd: ${base}`
    return base
  })
  const [body, setBody] = useState('')
  const [replyAll, setReplyAll] = useState(false)
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const title = isNew ? t('compose') : isReply ? t('reply') : t('forward')

  const pickFiles = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setError('')
    setUploading(true)
    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT) {
          setError(`${t('tooLarge')}：${file.name}`)
          continue
        }
        const dataUrl = await readAsDataUrl(file)
        const uploaded = await onUpload(file.name, dataUrl)
        setAttachments((current) => [...current, uploaded])
      }
    } catch (uploadError) {
      setError(`${t('fileFailed')}：${(uploadError && uploadError.message) || uploadError}`)
    } finally {
      setUploading(false)
    }
  }

  const submit = async () => {
    setError('')
    const recipients = splitAddresses(to)
    if (!isReply && !recipients.length) {
      setError(t('toPlaceholder'))
      return
    }
    if (isNew && !subject.trim()) {
      setError(t('subjectPlaceholder'))
      return
    }
    if (!body.trim()) {
      setError(t('bodyPlaceholder'))
      return
    }

    const payload = isNew
      ? {
          to: recipients,
          cc: splitAddresses(cc),
          bcc: splitAddresses(bcc),
          subject: subject.trim(),
          body,
          bodyFormat: 'plain',
          attachments,
        }
      : isReply
        ? {
            id: message.id,
            body,
            replyAll,
            cc: splitAddresses(cc),
            attachments,
          }
        : {
            id: message.id,
            to: recipients,
            cc: splitAddresses(cc),
            bcc: splitAddresses(bcc),
            body,
            includeAttachments,
            attachments,
          }

    await onSubmit(payload)
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <span className="tc-spacer">{t('savedDraft')}</span>
          <button type="button" className="tc-btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="tc-btn tc-btn--primary" onClick={submit} disabled={busy || uploading}>
            {busy ? t('sending') : t('send')}
          </button>
        </>
      }
    >
      {error ? (
        <p className="tc-help" style={{ color: 'var(--tc-danger)', marginTop: 0 }}>
          {error}
        </p>
      ) : null}

      {!isReply ? (
        <div className="tc-field">
          <label htmlFor="tc-to">{t('to')}</label>
          <input
            id="tc-to"
            type="text"
            value={to}
            placeholder={t('toPlaceholder')}
            onChange={(event) => setTo(event.target.value)}
            autoComplete="off"
          />
        </div>
      ) : (
        <p className="tc-help" style={{ marginTop: 0 }}>
          {t('to')}：{(message && message.from && (message.from.name || message.from.email)) || ''}
          {t('quoteHint')}
        </p>
      )}

      <div className="tc-field-row">
        <div className="tc-field">
          <label htmlFor="tc-cc">{t('cc')}</label>
          <input id="tc-cc" type="text" value={cc} placeholder={t('ccPlaceholder')} onChange={(event) => setCc(event.target.value)} />
        </div>
        {!isReply ? (
          <div className="tc-field">
            <label htmlFor="tc-bcc">{t('bcc')}</label>
            <input id="tc-bcc" type="text" value={bcc} placeholder={t('bccPlaceholder')} onChange={(event) => setBcc(event.target.value)} />
          </div>
        ) : null}
      </div>

      {isNew ? (
        <div className="tc-field">
          <label htmlFor="tc-subject">{t('subject')}</label>
          <input
            id="tc-subject"
            type="text"
            value={subject}
            placeholder={t('subjectPlaceholder')}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
      ) : (
        <div className="tc-field">
          <label>{t('subject')}</label>
          <div className="tc-help" style={{ fontSize: '0.9em' }}>
            {subject}
          </div>
        </div>
      )}

      <div className="tc-field">
        <label htmlFor="tc-body">{t('body')}</label>
        <textarea
          id="tc-body"
          rows={10}
          value={body}
          placeholder={isReply ? t('replyPlaceholder') : t('bodyPlaceholder')}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      {isReply || isForward ? (
        <div style={{ display: 'flex', gap: 18, marginBottom: 12 }}>
          {isReply ? (
            <label className="tc-check">
              <input type="checkbox" checked={replyAll} onChange={(event) => setReplyAll(event.target.checked)} />
              {t('replyAll')}
            </label>
          ) : null}
          {isForward ? (
            <label className="tc-check">
              <input
                type="checkbox"
                checked={includeAttachments}
                onChange={(event) => setIncludeAttachments(event.target.checked)}
              />
              {t('attachments')}
            </label>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="tc-btn" onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}>
          <PaperclipIcon />
          {uploading ? '…' : t('attach')}
        </button>
        <input ref={fileRef} type="file" multiple className="tc-hidden" onChange={pickFiles} />
        {attachments.map((file) => (
          <span key={file.uploadId} className="tc-attachment">
            <span title={file.name}>{file.name}</span>
            <button
              type="button"
              className="tc-row-action"
              style={{ opacity: 1, width: 18, height: 18 }}
              onClick={() => setAttachments((current) => current.filter((entry) => entry.uploadId !== file.uploadId))}
              aria-label="remove"
            >
              <CloseIcon size={12} />
            </button>
          </span>
        ))}
      </div>
    </Modal>
  )
}
