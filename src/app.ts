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
import createMeetLink from '@/helpers/meet'
import handleLanguage from '@/handlers/language'
import i18n from '@/helpers/i18n'
import languageMenu from '@/menus/inline/language'
import sendStart from '@/handlers/start'
import startMongo from '@/helpers/startMongo'

async function runApp() {
  console.log('Starting app...')
  // Mongo
  await startMongo()
  console.log('Mongo connected')

  bot
    // Middlewares
    .use(sequentialize())
    .use(ignoreOld())
    .use(attachUser)
    .use(i18n.middleware())
    .use(configureI18n)
    // Menus
    .use(languageMenu)
  // Commands
  bot.command('start', sendStart)
  bot.command('language', handleLanguage)

  bot.inlineQuery(/.*/, async (ctx) => {
    ;(await call()).seq

    if (!ctx.dbuser.googleMeetLink) {
      ctx.dbuser.googleMeetLink = await createMeetLink()
      await ctx.dbuser.save()
    }

    const escapedLink = escapeMarkdownV2(ctx.dbuser.googleMeetLink)
    const escapedAd = escapeMarkdownV2('@givemegooglemeetbot')

    const msg = `${escapedLink}\n\n||${escapedAd}||`

    const result: InlineQueryResultArticle = {
      type: 'article',
      id: uuid(),
      title: 'Google Meet',
      description: 'click me to create',
      input_message_content: {
        message_text: msg,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      } as InputTextMessageContent,
    }

    await ctx.answerInlineQuery([result], { cache_time: 0 })
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
