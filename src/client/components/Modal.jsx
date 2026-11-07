import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { CloseIcon } from './Icons.jsx'
import { useThemeStyle } from '../theme-context.js'

/** Dialog shell: portal out of the panel, focus the card, close on Escape. */
export function Modal({ title, subtitle, onClose, children, footer, small = false, labelledBy = 'tc-modal-title', themeStyle }) {
  const cardRef = useRef(null)
  const inherited = useThemeStyle()
  const style = themeStyle || inherited

  useEffect(() => {
    const previous = document.activeElement
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    if (cardRef.current) cardRef.current.focus()
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      className="tc-theme tc-overlay"
      style={style}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`tc-modal${small ? ' tc-modal--sm' : ''}`}
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        <div className="tc-modal-head">
          <h2 className="tc-modal-title" id={labelledBy}>
            {title}
          </h2>
          <button type="button" className="tc-btn tc-btn--ghost tc-btn--icon" onClick={onClose} aria-label="close">
            <CloseIcon />
          </button>
        </div>
        <div className="tc-modal-body">
          {subtitle ? (
            <p className="tc-help" style={{ marginTop: 0 }}>
              {subtitle}
            </p>
          ) : null}
          {children}
        </div>
        {footer ? <div className="tc-modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
