/**
 * dsh-tc-mail — Agent Mail (腾讯智能体邮箱) inside the Harness Web UI.
 *
 * Host half: resolves `agently-cli`, exposes the mailbox over local HTTP routes
 * for the browser half, and registers the `mail_*` agent tools.
 */

import { createCli } from './cli.js'
import { createMailService } from './mail-service.js'
import { registerRoutes } from './routes.js'
import { createSettingsStore } from './settings-store.js'
import { MAIL_PROMPT, registerTools } from './tools.js'

export const name = 'dsh-tc-mail'
// All three are core Harness services. Declaring them here (rather than via
// ctx.inject) is the pattern the shipped plugins use, and it guarantees the
// services exist by the time apply() runs.
export const inject = ['webServer', 'tools', 'systemPrompt']

function pickLogger(ctx) {
  try {
    const logger = ctx.logger('dsh-tc-mail')
    if (logger && typeof logger.info === 'function') return logger
  } catch {
    /* fall through */
  }
  return console
}

export function apply(ctx) {
  const logger = pickLogger(ctx)
  const settings = createSettingsStore({ logger })
  void settings.load()

  const cli = createCli({
    logger,
    getOverride: () => settings.peek().advanced.cliPath,
    getWorkspace: () => settings.peek().advanced.workspace,
  })
  const mail = createMailService({ cli, settings, logger })
  // Shared with the HTTP layer so /health can report what the agent can call.
  const runtime = { tools: [], toolError: null }

  ctx.effect(
    () => {
      try {
        return registerRoutes({ webServer: ctx.webServer, mail, cli, settings, logger, runtime })
      } catch (error) {
        // A second mount of the same package would collide on the route prefix.
        logger.warn(`[dsh-tc-mail] 路由注册失败（可能重复安装）：${(error && error.message) || error}`)
        return () => {}
      }
    },
    'dsh-tc-mail: http routes',
  )

  ctx.effect(
    () => {
      try {
        const registration = registerTools({ ctx, mail })
        runtime.tools = registration.names
        runtime.toolError = null
        console.log(`[dsh-tc-mail] agent tools registered: ${registration.names.join(', ')}`)
        return () => {
          runtime.tools = []
          registration.dispose()
        }
      } catch (error) {
        const message = (error && error.stack) || String(error)
        runtime.toolError = message.slice(0, 400)
        logger.warn(`[dsh-tc-mail] 工具注册失败：${message}`)
        console.error(`[dsh-tc-mail] tool registration failed: ${message}`)
        return () => {}
      }
    },
    'dsh-tc-mail: agent tools',
  )

  ctx.effect(
    () => {
      try {
        const dispose = ctx.systemPrompt.section({ name: 'tool:dsh-tc-mail', order: 150, text: MAIL_PROMPT })
        return typeof dispose === 'function' ? dispose : () => {}
      } catch (error) {
        logger.warn(`[dsh-tc-mail] 提示词注入失败：${(error && error.message) || error}`)
        return () => {}
      }
    },
    'dsh-tc-mail: prompt section',
  )
}
