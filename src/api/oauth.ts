import { Request, Response, Router } from 'express'

import bot from '@/helpers/bot'
import { exchangeCodeForTokens } from '@/helpers/oauth'
import { UserModel } from '@/models/User'

const router = Router()

// OAuth callback route that Google will redirect to after authorization
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query

    if (!code || !state) {
      res.status(400).send('Missing required parameters')
      return
    }

    // Extract user ID from state parameter
    const stateData = JSON.parse(
      Buffer.from(state as string, 'base64').toString()
    )
    const userId = stateData.userId

    if (!userId) {
      res.status(400).send('Invalid state parameter')
      return
    }

    // Exchange the code for tokens
    const { accessToken, refreshToken, expiresIn } =
      await exchangeCodeForTokens(code as string)

    // Calculate token expiry time
    const tokenExpiry = new Date(Date.now() + expiresIn * 1000)

    // Update user in database
    await UserModel.findOneAndUpdate(
      { id: userId },
      {
        isAuthorized: true,
        refreshToken,
        accessToken,
        tokenExpiry,
      }
    )

    // Send confirmation message to user
    try {
      // Get user's preferred language
      const user = await UserModel.findOne({ id: userId })
      const locale = user?.language || 'en'
      
      // Get success message based on user language
      const successMessage = locale === 'ru'
        ? 'Авторизация успешна! Теперь вы можете создавать персонализированные Google Meet ссылки.'
        : 'Authorization successful! You can now create personalized Google Meet links.'

      // Convert userId to string to ensure type safety
      const userIdString = String(userId)
      await bot.api.sendMessage(userIdString, successMessage)
    } catch (error) {
      console.error('Error sending confirmation message:', error)
    }

    // Redirect or show success page
    res.send(`
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              text-align: center;
              margin-top: 50px;
            }
            .success {
              color: green;
              font-size: 24px;
              margin-bottom: 20px;
            }
            .info {
              margin-bottom: 30px;
            }
            .telegram-button {
              background-color: #0088cc;
              color: white;
              padding: 10px 20px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <div class="success">✅ Authorization Successful!</div>
          <div class="info">You can now close this window and return to the Telegram bot.</div>
          <a href="https://t.me/${bot.botInfo.username}" class="telegram-button">Return to Telegram</a>
        </body>
      </html>
    `)
  } catch (error) {
    console.error('Error processing OAuth callback:', error)
    res.status(500).send('Authorization failed. Please try again.')
  }
})

export default router
