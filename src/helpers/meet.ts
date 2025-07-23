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
     // !!! НЕ убирайте, этот refresh-token
     // должен быть получен со scope-ами SCOPES
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )

  return data.access_token as string
}

export type MeetAccessType = 'OPEN' | 'TRUSTED' | 'RESTRICTED'

/**
 * Create a Google Meet link.
 *
 * If `overrideAccessType` is provided it will be used as-is. Otherwise:
 * - Unauthenticated users get `OPEN` links (anyone can join without approval)
 * - Authenticated users get `TRUSTED` links (personal meetings)
 */
export default async function createMeetLink(
  user?: User,
  overrideAccessType?: MeetAccessType
): Promise<string> {
  const accessType: MeetAccessType =
    overrideAccessType ?? (user?.isAuthorized ? 'TRUSTED' : 'OPEN')

  const accessToken = await getAccessToken(user)

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

    // `meetingUri` is полный URL; `meetingCode` — только код
    return data.meetingUri as string
  } catch (error: any) {
    console.error('Meet API Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      config: {
        url: error.config?.url,
        method: error.config?.method,
        data: error.config?.data,
      },
      isAuthorized: user?.isAuthorized,
      accessType,
    })
    throw error
  }
}
