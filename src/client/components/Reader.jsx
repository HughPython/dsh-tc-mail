import { useMemo, useState } from 'react'

import { buildMailDocument, toPlainText } from '../sanitize.js'
import { formatFullTime, formatSize, displayName } from '../format.js'
import { BackIcon, DownloadIcon, ForwardIcon, ImageIcon, PaperclipIcon, ReplyIcon } from './Icons.jsx'

export function Reader({ message, showImages, onToggleImages, onBack, onReply, onForward, onDownload, t }) {
  const [downloading, setDownloading] = useState('')
  const isHtml = String(message.bodyFormat || '').toUpperCase() === 'HTML'

  const srcdoc = useMemo(
    () => (isHtml ? buildMailDocument({ html: message.body, showImages }) : ''),
    [isHtml, message.id, message.body, showImages],
  )

  const plain = useMemo(() => (isHtml ? '' : String(message.body || '')), [isHtml, message.body])

  const download = async (attachment) => {
    setDownloading(attachment.id)
    try {
      await onDownload({ messageId: message.id, attachmentId: attachment.id, filename: attachment.filename })
    } finally {
      setDownloading('')
    }
  }

  return (
    <div className="tc-reader">
      <div className="tc-reader-head">
        <button type="button" className="tc-btn tc-btn--ghost tc-btn--icon" onClick={onBack} aria-label={t('back')}>
          <BackIcon />
        </button>
        <div className="tc-reader-title">
          <h3 className="tc-reader-subject">{message.subject || '(无主题)'}</h3>
          <div className="tc-reader-meta">
            <span>
              {t('from')}：<b>{displayName(message.from)}</b>
              {message.from && message.from.email && message.from.email !== displayName(message.from)
                ? ` <${message.from.email}>`
                : ''}
            </span>
            {(message.to || []).length ? (
              <span>
                {t('to')}：<b>{(message.to || []).map((entry) => entry.email).join(', ')}</b>
              </span>
            ) : null}
            {(message.cc || []).length ? (
              <span>
                {t('cc')}：<b>{(message.cc || []).map((entry) => entry.email).join(', ')}</b>
              </span>
            ) : null}
            <span>{formatFullTime(message.createdAt)}</span>
          </div>
        </div>
        <div className="tc-reader-actions">
          {isHtml && !showImages ? (
            <button type="button" className="tc-btn tc-btn--ghost" onClick={onToggleImages} title={t('imagesBlocked')}>
              <ImageIcon />
              {t('showImages')}
            </button>
          ) : null}
          <button type="button" className="tc-btn" onClick={() => onReply(message)}>
            <ReplyIcon />
            {t('reply')}
          </button>
          <button type="button" className="tc-btn" onClick={() => onForward(message)}>
            <ForwardIcon />
            {t('forward')}
          </button>
        </div>
      </div>

      {(message.attachments || []).length ? (
        <div className="tc-attachments">
          {(message.attachments || []).map((attachment) => (
            <button
              key={attachment.id || attachment.filename}
              type="button"
              className="tc-attachment"
              onClick={() => (attachment.id ? download(attachment) : null)}
              disabled={!attachment.id || downloading === attachment.id}
              title={attachment.downloadUrl ? `下载链接：${attachment.downloadUrl}` : attachment.filename}
            >
              <PaperclipIcon />
              <span>{attachment.filename}</span>
              <span style={{ color: 'var(--tc-text-3)' }}>{formatSize(attachment.size)}</span>
              <DownloadIcon />
            </button>
          ))}
        </div>
      ) : null}

      <div className="tc-reader-body">
        {isHtml ? (
          <iframe
            className="tc-mail-frame"
            title={message.subject || 'mail body'}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            srcDoc={srcdoc}
          />
        ) : (
          <div className="tc-mail-plain">{plain || toPlainText(message.snippet)}</div>
        )}
      </div>
    </div>
  )
}
