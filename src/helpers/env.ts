import * as dotenv from 'dotenv'
import { cleanEnv, str } from 'envalid'
import { cwd } from 'process'
import { resolve } from 'path'

dotenv.config({ path: resolve(cwd(), '.env') })

// eslint-disable-next-line node/no-process-env
export default cleanEnv(process.env, {
  TOKEN: str(),
  MONGO: str(),

  GOOGLE_ACCESS_TOKEN: str(),
  GOOGLE_REFRESH_TOKEN: str(),

  GOOGLE_CLIENT_ID: str(),
  GOOGLE_SECRET_KEY: str(),
})
