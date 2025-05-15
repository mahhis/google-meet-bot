import { getCounter } from '@/models/LetterCounter'
import Context from '@/models/Context'
import sendOptions from '@/helpers/sendOptions'

export default async function handleStart(ctx: Context) {
  try {
    const counter = await getCounter() // вызываем и ждём Mongo

    return ctx.replyWithLocalization('start', {
      ...sendOptions(ctx, {
        counter: counter.seq, // передаём текущее значение seq
      }),
    })
  } catch (error) {
    console.error('Failed to get counter:', error)
    return ctx.reply('⚠ Ошибка при получении счётчика')
  }
}
