import Context from '@/models/Context'

export default function sendOptions(ctx?: Context, data?: any | undefined) {
  return {
    //reply_to_message_id: ctx.msg?.message_id,
    data,
    parse_mode: 'HTML' as const,
  }
}
