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

function InstallLog({ install, t }) {
  if (!install) return null
  const lines = (install.log || []).filter(Boolean).slice(-3)
  if (install.status === 'idle' || !lines.length) return null
  return (
    <div className="tc-code" style={{ display: 'block', maxWidth: 520, width: '100%', textAlign: 'left', lineHeight: 1.6 }}>
      {lines.map((line, index) => (
        <div key={`${index}-${line.slice(0, 12)}`} style={{ opacity: index === lines.length - 1 ? 1 : 0.6 }}>
          {line.length > 160 ? `${line.slice(0, 160)}…` : line}
        </div>
      ))}
      {install.status === 'running' ? <div style={{ opacity: 0.7 }}>{t('installing')}</div> : null}
    </div>
  )
}

function Steps({ current, t }) {
  const items = [
    { id: 1, label: t('stepInstall') },
    { id: 2, label: t('stepAuthorize') },
    { id: 3, label: t('stepUse') },
  ]
  return (
    <div className="tc-steps">
      {items.map((item) => (
        <span key={item.id} className="tc-step" data-active={item.id === current}>
          <i>{item.id < current ? '✓' : item.id}</i>
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function SetupGuide({ kind, health, login, install, onAuthorize, onInstall, t }) {
  if (kind === 'cli_missing' || kind === 'cli_broken') {
    const broken = kind === 'cli_broken'
    const running = Boolean(install && install.status === 'running')
    const done = Boolean(install && install.status === 'done')
    const failed = Boolean(install && install.status === 'failed')

    return (
      <div className="tc-guide">
        <MailIcon size={28} />
        <Steps current={1} t={t} />
        <h3>{broken ? t('cliBrokenTitle') : t('cliMissingTitle')}</h3>
        <p>{broken ? t('cliBrokenBody') : t('cliMissingBody')}</p>

        {broken && health && health.cli ? (
          <p className="tc-help" style={{ wordBreak: 'break-all', maxWidth: 560 }}>
            {t('cliPathLabel')}：{health.cli.path}
            {health.cli.error ? ` · ${health.cli.error}` : ''}
          </p>
        ) : null}

        {done ? (
          <p style={{ margin: 0, fontWeight: 600 }}>{t('installDone')}</p>
        ) : (
          <button type="button" className="tc-btn tc-btn--primary" onClick={onInstall} disabled={running}>
            {running ? t('installing') : broken ? t('reinstall') : t('installCli')}
          </button>
        )}

        <InstallLog install={install} t={t} />
        {failed ? <p className="tc-help">{t('installFailed')}</p> : null}

        <p className="tc-help" style={{ marginTop: 4 }}>
          {t('manualInstallHint')}
        </p>
        <CodeBlock text="npm install -g @tencent-qqmail/agently-cli" />
        <CodeBlock text="agently-cli auth login" />
        <p className="tc-help">
          文档：<a href="https://agent.qq.com/doc/cli-setup.md" target="_blank" rel="noopener noreferrer">agent.qq.com/doc/cli-setup.md</a>
        </p>
      </div>
    )
  }

  const waiting = Boolean(login && login.status === 'waiting')
  const failed = Boolean(login && login.status === 'failed')
  const done = Boolean(login && login.status === 'done')

  return (
    <div className="tc-guide">
      <MailIcon size={28} />
      <Steps current={2} t={t} />
      <h3>{t('unauthorizedTitle')}</h3>
      <p>{t('unauthorizedBody')}</p>
      <p className="tc-help" style={{ maxWidth: 460 }}>
        {t('newUserHint')}
      </p>

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
