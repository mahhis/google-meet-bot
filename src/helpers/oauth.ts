import * as qs from 'qs'
import axios from 'axios'
import env from '@/helpers/env'

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_SECRET_KEY: GOOGLE_CLIENT_SECRET,
} = env

// URL where your bot is hosted - this should be added to your env file
const BOT_URL = process.env.BOT_URL || 'https://your-bot-domain.com'

// Scopes needed for Google Meet
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/meetings.space.created',
]

/**
 * Generate an authorization URL for user to authenticate with Google
 * @param userId Telegram user ID used for state parameter
 * @returns URL to redirect user for Google authorization
 */
export function generateAuthUrl(userId: number): string {
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64')

  const authUrl = 
    'https://accounts.google.com/o/oauth2/v2/auth?' + qs.stringify({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${BOT_URL}/oauth/callback`,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    })
  
  return authUrl
}

/**
 * Exchange authorization code for tokens
 * @param code Authorization code from Google
 * @returns Object containing tokens and expiry
 */
export async function exchangeCodeForTokens(code: string) {
  try {
    const { data } = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${BOT_URL}/oauth/callback`,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    }
  } catch (error) {
    console.error('Error exchanging code for tokens:', error)
    throw error
  }
}

/**
 * Refresh an access token using a refresh token
 * @param refreshToken Refresh token
 * @returns New access token and expiry
 */
export async function refreshAccessToken(refreshToken: string) {
  try {
    const { data } = await axios.post(
      'https://oauth2.googleapis.com/token',
      qs.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    )
    
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    }
  } catch (error) {
    console.error('Error refreshing token:', error)
    throw error
  }
}
