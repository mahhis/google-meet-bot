import 'module-alias/register'
import 'reflect-metadata'
import 'source-map-support/register'

import { v4 as uuid } from 'uuid'
import type {
  InlineQueryResultArticle,
  InputTextMessageContent, // ← понадобится именно этот интерфейс
} from 'grammy/types'

import { call } from '@/models/LetterCounter'
import { ignoreOld, sequentialize } from 'grammy-middlewares'
import { run } from '@grammyjs/runner'
import attachUser from '@/middlewares/attachUser'
import bot from '@/helpers/bot'
import configureI18n from '@/middlewares/configureI18n'
import createMeetLink, { MeetAccessType } from '@/helpers/meet'
import { generateAuthUrl } from '@/helpers/oauth'
import handleAuth from '@/handlers/auth'
import handleLanguage from '@/handlers/language'
import handleRevoke from '@/handlers/revoke'
import i18n from '@/helpers/i18n'
import languageMenu from '@/menus/inline/language'
import sendStart from '@/handlers/start'
import startMongo from '@/helpers/startMongo'
import { startServer } from '@/api/server'
import env from '@/helpers/env'

async function runApp() {
  console.log('Starting app...')
  // Mongo
  await startMongo()
  console.log('Mongo connected')
  
  // Start API server for OAuth callbacks
  await startServer(parseInt(env.PORT, 10))
  console.log('API server started')

  bot
    // Middlewares
    .use(sequentialize())
    .use(ignoreOld())
    .use(attachUser)
    .use(i18n.middleware())
    .use(configureI18n)
    // Menus
    .use(languageMenu)
  // Register command handlers
  bot.command('start', sendStart)
  bot.command('help', async (ctx) => {
    await ctx.reply(ctx.i18n.t('help'))
  })
  bot.command('language', handleLanguage)
  bot.command('auth', handleAuth)
  bot.command('auth_revoke', handleRevoke)

  bot.inlineQuery(/.*/, async (ctx) => {
    // Collect metrics
    ;(await call()).seq

    const query = ctx.inlineQuery.query.trim().toLowerCase()
    const wantsPrivate = ['p', 'priv', 'private', 'приват'].includes(query)

    // Helper to build a Markdown-escaped message
    const buildMsg = (link: string) => {
      const escapedLink = escapeMarkdownV2(link)
      const escapedAd = escapeMarkdownV2('@givemegooglemeetbot')
      return `${escapedLink}\n\n||${escapedAd}||`
    }

    const results: InlineQueryResultArticle[] = []

    if (wantsPrivate) {
      if (ctx.dbuser.isAuthorized) {
        // Private link (DEFAULT access)
        const link = await createMeetLink(ctx.dbuser, 'DEFAULT' as MeetAccessType)
        results.push({
          type: 'article',
          id: uuid(),
          title: ctx.i18n.t('inline.private_title') ?? 'Private Google Meet',
          description:
            ctx.i18n.t('inline.private_description') ??
            'Click to create a private Meet link',
          input_message_content: {
            message_text: buildMsg(link.meetingUri),
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: true,
          } as InputTextMessageContent,
        })
      } else {
        // Ask user to authorise first
        const authUrl = generateAuthUrl(ctx.from!.id)
        results.push({
          type: 'article',
          id: uuid(),
          title: ctx.i18n.t('inline.auth_required_title') ?? 'Authorization required',
          description:
            ctx.i18n.t('inline.auth_required_description') ??
            'You must authorise the bot with Google to create private links',
          input_message_content: {
            message_text:
              ctx.i18n.t('auth.instructions') ??
              'Please authorise with Google using the /auth command',
            parse_mode: 'HTML',
          } as InputTextMessageContent,
          reply_markup: {
            inline_keyboard: [[{ text: ctx.i18n.t('auth.button'), url: authUrl }]],
          },
        })
      }
    } else {
      // Link (access type determined by authorization status)
      const link = await createMeetLink(
        ctx.dbuser.isAuthorized ? ctx.dbuser : undefined
      )
      
      // Show correct description based on user authorization status
      const title = ctx.dbuser.isAuthorized 
        ? (ctx.i18n.t('inline.private_title') ?? 'Private Google Meet')
        : (ctx.i18n.t('inline.open_title') ?? 'Google Meet')
      const description = ctx.dbuser.isAuthorized
        ? (ctx.i18n.t('inline.private_description') ?? 'Click to create a private Meet link')
        : (ctx.i18n.t('inline.open_description') ?? 'Click to create a public link')
        
      results.push({
        type: 'article',
        id: uuid(),
        title,
        description,
        input_message_content: {
          message_text: buildMsg(link.meetingUri),
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        } as InputTextMessageContent,
      })  
    }

    await ctx.answerInlineQuery(results, { cache_time: 0 })
  })

  bot.catch(console.error)
  // Start bot
  await bot.init()
  run(bot)
  console.info(`Bot ${bot.botInfo.username} is up and running`)
}

void runApp()

function escapeMarkdownV2(text: string) {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1')
}
