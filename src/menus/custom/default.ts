import { Keyboard } from 'grammy'
import i18n from '@/helpers/i18n'

export default function getI18nKeyboard(lng: string, type: string) {
  let keyboard: Keyboard

  switch (type) {
    case 'no':
      keyboard = new Keyboard().text(i18n.t(lng, 'no_btn'))
      return keyboard
  }
}
