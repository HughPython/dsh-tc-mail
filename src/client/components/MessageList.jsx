import { useMemo } from 'react'

import { displayName, formatRowTime } from '../format.js'
import { PaperclipIcon, ReplyIcon } from './Icons.jsx'

export function MessageList({
  items,
  dir,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onReply,
  loading,
  emptyLabel,
  t,
  hasMore,
  onLoadMore,
  loadingMore,
}) {
  const showTo = dir === 'sent'
  const ids = useMemo(() => items.map((item) => item.id), [items])
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id))
  const someSelected = ids.some((id) => selected.has(id))

  return (
    <div className="tc-list-wrap">
      <div className="tc-list-head">
        <label className="tc-check" style={{ justifyContent: 'center' }}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(node) => {
              if (node) node.indeterminate = !allSelected && someSelected
            }}
            onChange={() => onToggleAll(ids)}
            aria-label={t('selectAll')}
          />
        </label>
        <span>{showTo ? t('to') : t('from')}</span>
        <span>{t('subject')}</span>
        <span style={{ textAlign: 'right' }}>{t('time')}</span>
        <span />
      </div>

      <div className="tc-list-body">
        {items.map((item) => {
          const who = showTo ? (item.to && item.to[0] ? displayName(item.to[0]) : '') : displayName(item.from)
          return (
            <div
              key={item.id}
              className="tc-row"
              data-unread={!item.isRead}
              data-selected={selected.has(item.id)}
              onClick={() => onOpen(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onOpen(item.id)
                }
              }}
            >
              <label className="tc-check" style={{ justifyContent: 'center' }} onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => onToggle(item.id)}
                  aria-label={item.subject || item.id}
                />
              </label>

              <span className="tc-row-who">
                <i className={`tc-dot${item.isRead ? ' tc-dot--hidden' : ''}`} aria-hidden="true" />
                <span>{who || '—'}</span>
              </span>

              <span className="tc-row-main">
                <span className="tc-row-subject">
                  <strong>{item.subject || '(无主题)'}</strong>
                  {item.hasAttachments ? <PaperclipIcon /> : null}
                </span>
                <span className="tc-row-snippet">{item.snippet}</span>
              </span>

              <span className="tc-row-time">{formatRowTime(item.createdAt)}</span>

              <button
                type="button"
                className="tc-row-action"
                title={t('reply')}
                onClick={(event) => {
                  event.stopPropagation()
                  onReply(item.id)
                }}
              >
                <ReplyIcon />
              </button>
            </div>
          )
        })}

        {!items.length && !loading ? (
          <div className="tc-empty">
            <span style={{ fontSize: '1.6em', opacity: 0.5 }}>✉</span>
            <span>{emptyLabel || t('noMail')}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="tc-empty">
            <span className="tc-spinner" />
            <span>{t('loading')}</span>
          </div>
        ) : null}

        {hasMore && !loading ? (
          <div className="tc-loadmore">
            <button type="button" className="tc-btn" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? t('loading') : t('loadMore')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
