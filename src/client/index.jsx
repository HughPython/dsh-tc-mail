/**
 * Browser half: registers the sidebar entry and the main panel it opens.
 *
 * Both registrations carry the same id/key — `ctx.layout.selectPanel(id)`
 * throws when a sidebar row points at a `main` entry that does not exist, so
 * the two must always be added together.
 */

import { createElement } from 'react'

import styles from './styles.css'
import { createTranslator } from './i18n.js'
import { MailPanel } from './panel.jsx'
import { MailIcon } from './components/Icons.jsx'

export const name = 'dsh-tc-mail'
export const inject = ['slots']

const PANEL_ID = 'dsh-tc-mail'
const PANEL_ORDER = 40

function PanelIcon({ size }) {
  return createElement(MailIcon, { size: size || 18 })
}

function PanelPage() {
  const { t } = createTranslator()
  return createElement(MailPanel, { t })
}

function injectStyles() {
  const element = document.createElement('style')
  element.setAttribute('data-dsh-tc-mail', '')
  element.textContent = styles
  document.head.appendChild(element)
  return () => element.remove()
}

export function apply(ctx) {
  ctx.effect(injectStyles, 'dsh-tc-mail: styles')

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: PANEL_ORDER,
        label: () => createTranslator().t('nav'),
      },
      PanelIcon,
    ),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
      },
      PanelPage,
    ),
  )
}
