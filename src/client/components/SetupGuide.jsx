import { useState } from 'react'

import { CopyIcon, MailIcon } from './Icons.jsx'

function CodeBlock({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard may be unavailable */
    }
  }
  return (
    <div className="tc-code">
      <code>{text}</code>
      <button type="button" className="tc-btn tc-btn--ghost tc-btn--icon" onClick={copy} title="copy" aria-label="copy">
        {copied ? <span style={{ fontSize: '0.8em' }}>✓</span> : <CopyIcon />}
      </button>
    </div>
  )
}

export function SetupGuide({ kind, login, onAuthorize, t }) {
  if (kind === 'cli_missing') {
    return (
      <div className="tc-guide">
        <MailIcon size={28} />
        <h3>{t('cliMissingTitle')}</h3>
        <p>{t('cliMissingBody')}</p>
        <CodeBlock text="npm install -g @tencent-qqmail/agently-cli" />
        <CodeBlock text="agently-cli auth login" />
        <p className="tc-help">
          文档：<a href="https://agent.qq.com/doc/cli-setup.md" target="_blank" rel="noopener noreferrer">agent.qq.com/doc/cli-setup.md</a>
        </p>
      </div>
    )
  }

  const waiting = login && login.status === 'waiting'
  const failed = login && login.status === 'failed'
  const done = login && login.status === 'done'

  return (
    <div className="tc-guide">
      <MailIcon size={28} />
      <h3>{t('unauthorizedTitle')}</h3>
      <p>{t('unauthorizedBody')}</p>

      {waiting ? (
        <>
          <span className="tc-spinner" />
          <p>{t('authorizeRunning')}</p>
          {login.url ? (
            <p>
              <a href={login.url} target="_blank" rel="noopener noreferrer">
                {login.url}
              </a>
            </p>
          ) : null}
        </>
      ) : null}

      {done ? <p>{t('authorizeDone')}</p> : null}

      {!waiting && !done ? (
        <button type="button" className="tc-btn tc-btn--primary" onClick={onAuthorize}>
          {t('authorize')}
        </button>
      ) : null}

      {failed ? (
        <>
          <p className="tc-help">{t('authorizeFailed')}</p>
          <CodeBlock text="agently-cli auth login" />
        </>
      ) : null}
    </div>
  )
}
