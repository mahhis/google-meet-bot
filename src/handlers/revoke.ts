import { UserModel } from '@/models/User'
import Context from '@/models/Context'

export default async function handleRevoke(ctx: Context): Promise<void> {
  try {
    const userId = ctx.from?.id

    if (!userId) {
      await ctx.reply(ctx.i18n.t('revoke.no_user_id'))
      return
    }

    // Check if user is already authorized
    if (!ctx.dbuser.isAuthorized) {
      await ctx.reply(ctx.i18n.t('revoke.not_authorized'))
      return
    }

    // Revoke authorization by removing tokens and setting isAuthorized to false
    await UserModel.findOneAndUpdate(
      { id: userId },
      {
        isAuthorized: false,
        refreshToken: null,
        accessToken: null,
        tokenExpiry: null,
      }
    )

    // Generate a new open-access Google Meet link
    ctx.dbuser.googleMeetLink = undefined
    await ctx.dbuser.save()

    await ctx.reply(ctx.i18n.t('revoke.success'))
  } catch (error) {
    console.error('Error handling revoke command:', error)
    await ctx.reply(ctx.i18n.t('revoke.error'))
  }
}
