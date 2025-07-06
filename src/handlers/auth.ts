import { generateAuthUrl } from '@/helpers/oauth'
import Context from '@/models/Context'

export default async function handleAuth(ctx: Context): Promise<void> {
  try {
    const userId = ctx.from?.id

    if (!userId) {
      await ctx.reply(ctx.i18n.t('auth.no_user_id'))
      return
    }

    // Check if user is already authorized
    if (ctx.dbuser.isAuthorized) {
      await ctx.reply(ctx.i18n.t('auth.already_authorized'))
      return
    }

    const authUrl = generateAuthUrl(userId)

    await ctx.reply(ctx.i18n.t('auth.instructions'), {
      reply_markup: {
        inline_keyboard: [[{ text: ctx.i18n.t('auth.button'), url: authUrl }]],
      },
    })
  } catch (error) {
    console.error('Error handling auth command:', error)
    await ctx.reply(ctx.i18n.t('auth.error'))
  }
}
