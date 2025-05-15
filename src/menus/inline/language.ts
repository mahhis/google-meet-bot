import { Menu } from '@grammyjs/menu'
import { cwd } from 'process'
import getI18nKeyboard from '@/menus/custom/default'

import { load } from 'js-yaml'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import Context from '@/models/Context'

interface YamlWithName {
  name: string
}

const localeFilePaths = readdirSync(resolve(cwd(), 'locales'))

const localeFile = (path: string) => {
  return load(
    readFileSync(resolve(cwd(), 'locales', path), 'utf8')
  ) as YamlWithName
}

const setLanguage = (languageCode: string) => async (ctx: Context) => {
  ctx.dbuser.language = languageCode
  await ctx.dbuser.save()
  ctx.i18n.locale(languageCode)
  await ctx.deleteMessage()
  return ctx.replyWithLocalization(ctx.i18n.t('language_selected'), {
    parse_mode: 'HTML',
    reply_markup: getI18nKeyboard(ctx.dbuser.language, 'start'),
  })
}

const languageMenu = new Menu<Context>('language')

localeFilePaths.forEach((localeFilePath, index) => {
  const localeCode = localeFilePath.split('.')[0]
  const localeName = localeFile(localeFilePath).name
  languageMenu.text(localeName, setLanguage(localeCode))
  if (index % 2 != 0) {
    languageMenu.row()
  }
})

export default languageMenu
