import * as User from '@/models/User'
import { Context as BaseContext } from 'grammy'
import { DocumentType } from '@typegoose/typegoose'
import { I18nContext } from '@grammyjs/i18n/dist/source'

class Context extends BaseContext {
  readonly i18n!: I18nContext
  dbuser!: DocumentType<User.User>

  replyWithLocalization: this['reply'] = (text, other, ...rest) => {
    text = this.i18n.t(text, other)
    return this.reply(text, other, ...rest)
  }
  editMessageWithLocalization: this['editMessageText'] = (
    text,
    other,
    ...rest
  ) => {
    text = this.i18n.t(text, other)
    return this.editMessageText(text, other, ...rest)
  }
}

export default Context
