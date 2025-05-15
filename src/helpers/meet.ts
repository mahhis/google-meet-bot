import * as qs from 'qs'
import axios from 'axios'
import env from '@/helpers/env'

/** ---------- env ------------- */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_SECRET_KEY: GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
} = env

/** Obtain a fresh access token via the refresh-token grant */
async function getAccessToken(): Promise<string> {
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

/** Create an OPEN Google Meet that anyone can join without knocking */
export default async function createMeetLink(): Promise<string> {
  const accessToken = await getAccessToken()

  const { data } = await axios.post(
    'https://meet.googleapis.com/v2/spaces',
    {
      config: {
        accessType: 'OPEN',
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  )

  // `meetingUri` is full URL; `meetingCode` is just the code
  return data.meetingUri as string
}
