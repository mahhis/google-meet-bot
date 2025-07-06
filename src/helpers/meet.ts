import * as qs from 'qs'
import axios from 'axios'

import { User, UserModel } from '@/models/User'
import env from '@/helpers/env'
import { refreshAccessToken } from '@/helpers/oauth'

/** ---------- env ------------- */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_SECRET_KEY: GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
} = env

/** Obtain a fresh access token via the refresh-token grant */
async function getAccessToken(user?: User): Promise<string> {
  // If user is provided and authorized, use their refresh token
  if (user?.isAuthorized && user?.refreshToken) {
    // Check if token needs refreshing
    if (
      !user.accessToken || 
      !user.tokenExpiry || 
      new Date() >= user.tokenExpiry
    ) {
      const { accessToken, expiresIn } = await refreshAccessToken(
        user.refreshToken
      )
      
      // Update user's token information
      user.accessToken = accessToken
      user.tokenExpiry = new Date(Date.now() + expiresIn * 1000)
      // Save user to database
      await UserModel.findOneAndUpdate(
        { id: user.id },
        { 
          accessToken: user.accessToken,
          tokenExpiry: user.tokenExpiry 
        }
      )
    }
    
    return user.accessToken as string
  }
  
  // Fallback to global refresh token if user is not authorized
  const { data } = await axios.post(
    'https://oauth2.googleapis.com/token',
    qs.stringify({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  return data.access_token as string
}

export type MeetAccessType = 'OPEN' | 'DEFAULT'

/**
 * Create a Google Meet link.
 *
 * If `overrideAccessType` is provided it will be used as-is. Otherwise the
 * helper will pick `DEFAULT` for authorised users and `OPEN` for everyone
 * else.
 */
export default async function createMeetLink(
  user?: User,
  overrideAccessType?: MeetAccessType
): Promise<string> {
  const accessType: MeetAccessType = overrideAccessType
    ? overrideAccessType
    : user?.isAuthorized
    ? 'DEFAULT'
    : 'OPEN'

  // Для публичных ссылок достаточно универсальной ссылки \u2014 без OAuth.
  if (accessType === 'OPEN') {
    return 'https://meet.google.com/new'
  }

  // Для приватных ссылок нужен accessToken.
  let accessToken: string
  try {
    accessToken = await getAccessToken(user)
  } catch (err) {
    // Если не удалось получить токен \u2014 отдаём fallback.
    return 'https://meet.google.com/new'
  }

  try {
    const { data } = await axios.post(
      'https://meet.googleapis.com/v2/spaces',
      {
        config: {
          accessType,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    // `meetingUri` is полный URL; `meetingCode` \u2014 только код
    return data.meetingUri as string
  } catch (error) {
    // Любая ошибка API \u2014 fallback
    return 'https://meet.google.com/new'
  }
}
