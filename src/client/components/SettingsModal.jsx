import { useState } from 'react'

import { Modal } from './Modal.jsx'
import { appearanceStyle, hexOf } from '../theme.js'

const FONT_PRESETS = [
  { label: '系统默认', value: '' },
  { label: '微软雅黑', value: '"Microsoft YaHei", "微软雅黑", system-ui, sans-serif' },
  { label: '苹方 / 思源', value: '"PingFang SC", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif' },
  { label: '宋体', value: 'SimSun, "宋体", "Songti SC", serif' },
  { label: '等宽', value: 'ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace' },
]

const REFRESH_LABEL = { 0: '关闭', 30: '30 秒', 60: '60 秒', 300: '5 分钟' }

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function merge(base, patch) {
  const next = clone(base)
  for (const group of ['font', 'surface', 'behavior', 'advanced']) {
    if (patch[group]) next[group] = { ...next[group], ...patch[group] }
  }
  return next
}

function ColorField({ value, onChange, placeholder, presets }) {
  const hex = hexOf(value) || '#1a1a1a'
  return (
    <div className="tc-color-input">
      <input type="color" value={hex} onChange={(event) => onChange(event.target.value)} aria-label="colour" />
      <input
        type="text"
        value={value || ''}
        placeholder={placeholder || '跟随界面'}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" className="tc-btn tc-btn--ghost" onClick={() => onChange('')}>
          跟随主题
        </button>
      ) : null}
      {presets ? (
        <div className="tc-swatches">
          {presets.map((color) => (
            <button
              key={color}
              type="button"
              className="tc-swatch"
              style={{ background: color }}
              onClick={() => onChange(color)}
              aria-label={color}
              title={color}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function SettingsModal({ settings, tokens, onPreview, onSave, onReset, onClose, t }) {
  const [draft, setDraft] = useState(() => clone(settings))
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)

  const update = (patch) => {
    const next = merge(draft, patch)
    setDraft(next)
    onPreview(next)
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setResetting(true)
    try {
      await onReset()
    } finally {
      setResetting(false)
    }
  }

  const previewStyle = appearanceStyle(draft, tokens)

  return (
    <Modal
      title={t('settingsTitle')}
      onClose={onClose}
      themeStyle={previewStyle}
      footer={
        <>
          <button type="button" className="tc-btn" onClick={reset} disabled={resetting}>
            {t('reset')}
          </button>
          <span className="tc-spacer" />
          <button type="button" className="tc-btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="tc-btn tc-btn--primary" onClick={save} disabled={saving}>
            {saving ? '…' : t('save')}
          </button>
        </>
      }
    >
      <div className="tc-section">
        <div className="tc-section-head">
          <span className="tc-section-title">{t('fontSection')}</span>
        </div>

        <div className="tc-field">
          <label htmlFor="tc-font-family">{t('fontFamily')}</label>
          <input
            id="tc-font-family"
            type="text"
            list="tc-font-presets"
            value={draft.font.family}
            placeholder={t('fontDefault')}
            onChange={(event) => update({ font: { family: event.target.value } })}
          />
          <datalist id="tc-font-presets">
            {FONT_PRESETS.filter((preset) => preset.value).map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </datalist>
          <div className="tc-swatches">
            {FONT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="tc-btn"
                style={{ height: 26, padding: '0 8px', fontSize: '0.82em' }}
                onClick={() => update({ font: { family: preset.value } })}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="tc-field">
          <label htmlFor="tc-font-size">{t('fontSize')}</label>
          <div className="tc-range">
            <input
              id="tc-font-size"
              type="range"
              min="11"
              max="22"
              step="1"
              value={draft.font.size}
              onChange={(event) => update({ font: { size: Number(event.target.value) } })}
            />
            <output>{draft.font.size}px</output>
          </div>
        </div>

        <div className="tc-field">
          <label>{t('fontColor')}</label>
          <ColorField
            value={draft.font.color}
            placeholder="跟随主题"
            presets={['#1a1a1a', '#374151', '#6b7280', '#ffffff', '#1f7ae0']}
            onChange={(color) => update({ font: { color } })}
          />
        </div>
      </div>

      <div className="tc-section">
        <div className="tc-section-head">
          <span className="tc-section-title">{t('surfaceSection')}</span>
        </div>

        <div className="tc-field">
          <label>{t('surfaceColor')}</label>
          <ColorField
            value={draft.surface.color}
            placeholder="跟随主题"
            presets={['#ffffff', '#f7f8fa', '#111827', '#1f2937', '#eef6ff', '#fdf6ec']}
            onChange={(color) => update({ surface: { color } })}
          />
        </div>

        <div className="tc-field-row">
          <div className="tc-field">
            <label htmlFor="tc-opacity">{t('surfaceOpacity')}</label>
            <div className="tc-range">
              <input
                id="tc-opacity"
                type="range"
                min="0"
                max="100"
                step="5"
                value={Math.round(draft.surface.opacity * 100)}
                onChange={(event) => update({ surface: { opacity: Number(event.target.value) / 100 } })}
              />
              <output>{Math.round(draft.surface.opacity * 100)}%</output>
            </div>
          </div>
          <div className="tc-field">
            <label htmlFor="tc-radius">{t('surfaceRadius')}</label>
            <div className="tc-range">
              <input
                id="tc-radius"
                type="range"
                min="0"
                max="24"
                step="2"
                value={draft.surface.radius}
                onChange={(event) => update({ surface: { radius: Number(event.target.value) } })}
              />
              <output>{draft.surface.radius}px</output>
            </div>
          </div>
        </div>

        <div className="tc-field">
          <label>{t('preview')}</label>
          <div className="tc-preview" style={previewStyle}>
            <div className="tc-preview-subject">{t('previewSubject')}</div>
            <div className="tc-preview-snippet">{t('previewSnippet')}</div>
          </div>
        </div>
      </div>

      <div className="tc-section">
        <div className="tc-section-head">
          <span className="tc-section-title">{t('behaviorSection')}</span>
        </div>
        <div className="tc-field-row">
          <div className="tc-field">
            <label htmlFor="tc-default-dir">{t('defaultDir')}</label>
            <select
              id="tc-default-dir"
              value={draft.behavior.dir}
              onChange={(event) => update({ behavior: { dir: event.target.value } })}
            >
              <option value="inbox">{t('inbox')}</option>
              <option value="sent">{t('sent')}</option>
              <option value="trash">{t('trash')}</option>
            </select>
          </div>
          <div className="tc-field">
            <label htmlFor="tc-refresh">{t('autoRefresh')}</label>
            <select
              id="tc-refresh"
              value={String(draft.behavior.autoRefreshSec)}
              onChange={(event) => update({ behavior: { autoRefreshSec: Number(event.target.value) } })}
            >
              {Object.keys(REFRESH_LABEL).map((key) => (
                <option key={key} value={key}>
                  {REFRESH_LABEL[key]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="tc-check" style={{ marginTop: 2 }}>
          <input
            type="checkbox"
            checked={draft.behavior.showImages}
            onChange={(event) => update({ behavior: { showImages: event.target.checked } })}
          />
          {t('showImagesDefault')}
        </label>
      </div>

      <div className="tc-section">
        <div className="tc-section-head">
          <span className="tc-section-title">{t('advanced')}</span>
        </div>
        <div className="tc-field">
          <label htmlFor="tc-cli-path">{t('cliPath')}</label>
          <input
            id="tc-cli-path"
            type="text"
            value={draft.advanced.cliPath}
            placeholder="agently-cli.exe"
            onChange={(event) => update({ advanced: { cliPath: event.target.value } })}
          />
        </div>
        <div className="tc-field">
          <label htmlFor="tc-workspace">{t('workspace')}</label>
          <input
            id="tc-workspace"
            type="text"
            value={draft.advanced.workspace}
            placeholder="default"
            onChange={(event) => update({ advanced: { workspace: event.target.value } })}
          />
        </div>
      </div>
    </Modal>
  )
}
