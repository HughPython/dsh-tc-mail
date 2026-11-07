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
export const inject = ['webServer']

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

  ctx.effect(
    () => {
      try {
        return registerRoutes({ webServer: ctx.webServer, mail, cli, settings, logger })
      } catch (error) {
        // A second mount of the same package would collide on the route prefix.
        logger.warn(`[dsh-tc-mail] 路由注册失败（可能重复安装）：${(error && error.message) || error}`)
        return () => {}
      }
    },
    'dsh-tc-mail: http routes',
  )

  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(
      () => {
        try {
          return registerTools({ ctx: toolsCtx, mail })
        } catch (error) {
          logger.warn(`[dsh-tc-mail] 工具注册失败：${(error && error.message) || error}`)
          return () => {}
        }
      },
      'dsh-tc-mail: agent tools',
    )
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(() => {
      try {
        return promptCtx.systemPrompt.section({ name: 'tool:dsh-tc-mail', order: 150, text: MAIL_PROMPT })
      } catch (error) {
        logger.warn(`[dsh-tc-mail] 提示词注入失败：${(error && error.message) || error}`)
        return () => {}
      }
    }, 'dsh-tc-mail: prompt section')
  })
}
