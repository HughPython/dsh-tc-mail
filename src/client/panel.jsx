import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from './api.js'
import { appearanceStyle, resolveTheme } from './theme.js'
import { ThemeContext } from './theme-context.js'
import { initials } from './format.js'
import { MessageList } from './components/MessageList.jsx'
import { Reader } from './components/Reader.jsx'
import { Composer } from './components/Composer.jsx'
import { SettingsModal } from './components/SettingsModal.jsx'
import { SetupGuide } from './components/SetupGuide.jsx'
import { Modal } from './components/Modal.jsx'
import { GearIcon, RefreshIcon, SearchIcon, SendIcon, TrashIcon } from './components/Icons.jsx'

const TABS = ['inbox', 'sent', 'trash']

export function MailPanel({ t }) {
  const [settings, setSettings] = useState(null)
  const [preview, setPreview] = useState(null)
  const [health, setHealth] = useState(null)
  const [dir, setDir] = useState('inbox')
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ hasMore: false, nextCursor: null })
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [detail, setDetail] = useState(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [showImages, setShowImages] = useState(false)
  const [composer, setComposer] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [toast, setToast] = useState(null)
  const [busy, setBusy] = useState('')
  const [login, setLogin] = useState(null)
  const [install, setInstall] = useState(null)
  const [tokens, setTokens] = useState(() => resolveTheme())
  const mounted = useRef(true)

  const pageSize = (settings && settings.behavior && settings.behavior.pageSize) || 20
  const ready = Boolean(health && health.ready)
  const active = preview || settings

  const notify = useCallback((message, tone = 'info') => {
    setToast({ message, tone, id: Date.now() })
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  /* Re-resolve theme tokens when the Host switches light/dark or a skin. */
  useEffect(() => {
    let timer
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => setTokens(resolveTheme()), 150)
    }
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 3400)
    return () => clearTimeout(timer)
  }, [toast])

  /* ------------------------------------------------------------ bootstrap */

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [loaded, snapshot] = await Promise.all([api.getSettings(), api.health()])
        if (cancelled) return
        setSettings(loaded)
        setHealth(snapshot)
        setShowImages(Boolean(loaded.behavior && loaded.behavior.showImages))
        if (loaded.behavior && loaded.behavior.dir && loaded.behavior.dir !== 'inbox') setDir(loaded.behavior.dir)
      } catch (error) {
        if (!cancelled) notify(error.message, 'error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [notify])

  /* ---------------------------------------------------------- search delay */

  useEffect(() => {
    const timer = setTimeout(() => setActiveQuery(query.trim()), 320)
    return () => clearTimeout(timer)
  }, [query])

  /* ------------------------------------------------------------- list load */

  const load = useCallback(
    async (cursor) => {
      if (!ready) return
      const isPaging = Boolean(cursor)
      if (isPaging) setLoadingMore(true)
      else setLoading(true)
      try {
        const params = { dir, limit: pageSize, cursor }
        const data = activeQuery ? await api.search({ q: activeQuery, ...params }) : await api.list(params)
        if (!mounted.current) return
        setItems((current) => (isPaging ? [...current, ...(data.items || [])] : data.items || []))
        setPagination(data.pagination || { hasMore: false, nextCursor: null })
        if (!isPaging) setSelected(new Set())
      } catch (error) {
        notify(error.message, 'error')
      } finally {
        if (mounted.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [activeQuery, dir, notify, pageSize, ready],
  )

  useEffect(() => {
    void load()
  }, [load])

  /* --------------------------------------------------------- auto refresh */

  useEffect(() => {
    const seconds = settings && settings.behavior ? settings.behavior.autoRefreshSec : 0
    if (!ready || !seconds || detail) return undefined
    const timer = setInterval(() => {
      void load()
    }, seconds * 1000)
    return () => clearInterval(timer)
  }, [detail, load, ready, settings])

  /* --------------------------------------------------------- login polling */

  useEffect(() => {
    if (!login || login.status !== 'waiting') return undefined
    const timer = setInterval(async () => {
      try {
        const state = await api.loginStatus()
        setLogin(state)
        if (state.status === 'done') {
          const snapshot = await api.health(true)
          setHealth(snapshot)
          notify(t('authorizeDone'))
        }
      } catch {
        /* keep polling */
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [login, notify, t])

  /* ------------------------------------------------------ install polling */

  useEffect(() => {
    if (!install || install.status !== 'running') return undefined
    const timer = setInterval(async () => {
      try {
        const state = await api.installStatus()
        setInstall(state)
        if (state.status === 'done') {
          const snapshot = await api.health(true)
          setHealth(snapshot)
        }
      } catch {
        /* keep polling */
      }
    }, 1200)
    return () => clearInterval(timer)
  }, [install && install.status])

  /* --------------------------------------------------------------- actions */

  const refreshHealth = useCallback(async () => {
    try {
      const snapshot = await api.health(true)
      if (mounted.current) setHealth(snapshot)
    } catch {
      /* non-fatal */
    }
  }, [])

  const openMessage = useCallback(
    async (id) => {
      setDetailBusy(true)
      try {
        const message = await api.read(id)
        if (!mounted.current) return null
        setDetail(message)
        setShowImages(Boolean(settings && settings.behavior && settings.behavior.showImages))
        return message
      } catch (error) {
        notify(error.message, 'error')
        return null
      } finally {
        if (mounted.current) setDetailBusy(false)
      }
    },
    [notify, settings],
  )

  const toggleOne = useCallback((id) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback((ids) => {
    setSelected((current) => {
      const all = ids.length > 0 && ids.every((id) => current.has(id))
      return all ? new Set() : new Set(ids)
    })
  }, [])

  const runConfirm = async () => {
    if (!confirm) return
    const action = confirm.run
    setConfirm(null)
    setBusy('delete')
    try {
      await action()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  const deleteSelected = () => {
    const ids = [...selected]
    if (!ids.length) {
      notify(t('noSelection'))
      return
    }
    if (dir === 'trash') {
      setConfirm({
        title: t('deleteForeverTitle'),
        message: t('deleteForeverBody'),
        label: t('deleteForever'),
        tone: 'danger',
        run: async () => {
          await api.remove({ ids })
          notify(t('deletedOk'))
          await load()
        },
      })
      return
    }
    setConfirm({
      title: t('moveToTrashTitle'),
      message: t('moveToTrashBody'),
      label: t('moveToTrash'),
      tone: 'danger',
      run: async () => {
        await api.trash(ids)
        notify(t('movedOk'))
        await load()
      },
    })
  }

  const emptyTrash = () => {
    setConfirm({
      title: t('emptyTrashTitle'),
      message: t('emptyTrashBody'),
      label: t('emptyTrash'),
      tone: 'danger',
      run: async () => {
        await api.remove({ all: true })
        notify(t('emptyOk'))
        await load()
      },
    })
  }

  const submitComposer = async (payload) => {
    if (!composer) return
    setBusy('send')
    try {
      if (composer.mode === 'new') await api.send(payload)
      else if (composer.mode === 'reply') await api.reply(payload)
      else await api.forward(payload)
      setComposer(null)
      notify(t('sentOk'))
      await load()
      void refreshHealth()
    } catch (error) {
      notify(error.message, 'error')
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  const uploadAttachment = async (name, dataUrl) => api.upload(name, dataUrl)

  const downloadAttachment = async ({ messageId, attachmentId, filename }) => {
    try {
      const result = await api.downloadAttachment({ messageId, attachmentId, filename })
      notify(`${t('download')}：${result.savedTo || result.filename}`)
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const saveSettings = async (draft) => {
    try {
      const saved = await api.saveSettings(draft)
      setSettings(saved)
      setPreview(null)
      setSettingsOpen(false)
      notify(t('settingsSaved'))
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const resetSettings = async () => {
    try {
      const saved = await api.resetSettings()
      setSettings(saved)
      setPreview(null)
      setSettingsOpen(false)
      notify(t('resetDone'))
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const startInstall = async () => {
    try {
      const state = await api.installCli()
      setInstall(state)
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const startLogin = async () => {
    try {
      const state = await api.loginStart()
      setLogin(state)
    } catch (error) {
      notify(error.message, 'error')
    }
  }

  const switchDir = (next) => {
    setDir(next)
    setDetail(null)
    setSelected(new Set())
  }

  /* ----------------------------------------------------------------- views */

  const style = useMemo(() => appearanceStyle(active, tokens), [active, tokens])

  const account = health && health.account
  const quota = account && account.quota ? account.quota : null
  const sentToday = health && Number.isFinite(health.sentToday) ? health.sentToday : null

  const header = (
    <div className="tc-header">
      <h1 className="tc-title">{t('title')}</h1>
      <div className="tc-header-actions">
        <button
          type="button"
          className="tc-btn"
          onClick={() => window.open('https://agent.qq.com', '_blank', 'noopener,noreferrer')}
        >
          {t('manage')}
        </button>
        <button
          type="button"
          className="tc-btn tc-btn--primary"
          onClick={() => setComposer({ mode: 'new' })}
          disabled={!ready}
        >
          <SendIcon />
          {t('compose')}
        </button>
        <button
          type="button"
          className="tc-btn tc-btn--icon"
          title={t('refresh')}
          onClick={() => {
            void load()
            void refreshHealth()
          }}
          disabled={!ready}
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="tc-btn tc-btn--icon"
          title={t('settings')}
          onClick={() => setSettingsOpen(true)}
        >
          <GearIcon />
        </button>
      </div>
    </div>
  )

  return (
    <ThemeContext.Provider value={style}>
      <div className="tc-theme tc-root" style={style}>
        {header}

      {!health ? (
        <div className="tc-guide">
          <span className="tc-spinner" />
          <span>{t('loading')}</span>
        </div>
      ) : !health.ready ? (
        <SetupGuide
          kind={health.reason === 'cli_missing' || health.reason === 'cli_broken' ? health.reason : 'not_logged_in'}
          health={health}
          login={login}
          install={install}
          onAuthorize={startLogin}
          onInstall={startInstall}
          t={t}
        />
      ) : detail ? (
        <Reader
          message={detail}
          showImages={showImages}
          onToggleImages={() => setShowImages(true)}
          onBack={() => setDetail(null)}
          onReply={(message) => setComposer({ mode: 'reply', message })}
          onForward={(message) => setComposer({ mode: 'forward', message })}
          onDownload={downloadAttachment}
          t={t}
        />
      ) : (
        <>
          <div className="tc-account">
            <span className="tc-avatar">{initials(account && account.email)}</span>
            <span className="tc-account-main">
              <span className="tc-account-email">{(account && account.email) || ''}</span>
              <span className="tc-chip tc-chip--ok">{t('running')}</span>
            </span>
            <span className="tc-account-meta">
              {t('todaySent')} {sentToday === null ? '—' : sentToday}/{quota || '—'}
            </span>
          </div>

          <div className="tc-tabs" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={dir === tab}
                className="tc-tab"
                data-active={dir === tab}
                onClick={() => switchDir(tab)}
              >
                {t(tab)}
              </button>
            ))}
          </div>

          <div className="tc-toolbar">
            <label className="tc-check">
              <input
                type="checkbox"
                checked={items.length > 0 && items.every((item) => selected.has(item.id))}
                onChange={() => toggleAll(items.map((item) => item.id))}
              />
              {t('selectAll')}
            </label>
            <button type="button" className="tc-btn tc-btn--danger" onClick={deleteSelected} disabled={!selected.size}>
              <TrashIcon />
              {dir === 'trash' ? t('deleteForever') : t('delete')}
            </button>
            {dir === 'trash' ? (
              <button type="button" className="tc-btn" onClick={emptyTrash}>
                {t('emptyTrash')}
              </button>
            ) : null}
            <span className="tc-spacer" />
            <div className="tc-search">
              <SearchIcon />
              <input
                type="text"
                value={query}
                placeholder={t('searchPlaceholder')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          <MessageList
            items={items}
            dir={dir}
            selected={selected}
            onToggle={toggleOne}
            onToggleAll={toggleAll}
            onOpen={openMessage}
            onReply={async (id) => {
              const message = await openMessage(id)
              if (message) setComposer({ mode: 'reply', message })
            }}
            loading={loading}
            loadingMore={loadingMore}
            emptyLabel={activeQuery ? t('noResult') : t('noMail')}
            hasMore={pagination.hasMore}
            onLoadMore={() => load(pagination.nextCursor)}
            t={t}
          />
        </>
      )}

      {detailBusy ? (
        <div className="tc-busy">
          <span className="tc-spinner" />
        </div>
      ) : null}

      {composer ? (
        <Composer
          mode={composer.mode}
          message={composer.message}
          t={t}
          busy={busy === 'send'}
          onClose={() => setComposer(null)}
          onSubmit={submitComposer}
          onUpload={uploadAttachment}
        />
      ) : null}

      {settingsOpen && settings ? (
        <SettingsModal
          settings={settings}
          tokens={tokens}
          onPreview={setPreview}
          onSave={saveSettings}
          onReset={resetSettings}
          onClose={() => {
            setSettingsOpen(false)
            setPreview(null)
          }}
          t={t}
        />
      ) : null}

      {confirm ? (
        <Modal
          title={confirm.title}
          onClose={() => setConfirm(null)}
          small
          footer={
            <>
              <button type="button" className="tc-btn" onClick={() => setConfirm(null)}>
                {t('cancel')}
              </button>
              <button type="button" className="tc-btn tc-btn--danger" onClick={runConfirm}>
                {confirm.label}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>{confirm.message}</p>
        </Modal>
      ) : null}

      {toast ? (
        <div className="tc-toast" data-tone={toast.tone} role="status">
          {toast.message}
        </div>
      ) : null}
      </div>
    </ThemeContext.Provider>
  )
}
