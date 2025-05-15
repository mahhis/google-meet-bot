const readlineSync = require('readline-sync')
const { google } = require('googleapis')
require('dotenv').config()

// Настройки OAuth2
const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_SECRET_KEY,
  'http://localhost:1338/oauth2callback' // Для локального тестирования без веб-сервера
)

// Разрешенные области доступа
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/meetings.space.created',
]
// Генерация ссылки для авторизации
const url = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
})

console.log('Откройте эту ссылку в браузере и авторизуйтесь:\n', url)

const code = readlineSync.question('\nВведите код авторизации: ')

async function getTokens() {
  try {
    const { tokens } = await oAuth2Client.getToken(code)

    console.log('\nПолученные токены:')
    console.log('Access Token:', tokens.access_token)
    console.log('Refresh Token:', tokens.refresh_token)

    // Можно здесь сохранить токены куда нужно
  } catch (error) {
    console.error('Ошибка получения токенов:', error)
  }
}

getTokens()
