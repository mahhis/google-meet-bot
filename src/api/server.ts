import express = require('express')
import bodyParser = require('body-parser')
import { Request, Response } from 'express'

import env from '@/helpers/env'
import oauthRoutes from '@/api/oauth'

// Create Express server
const app = express()

// Middleware
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Routes
app.use('/oauth', oauthRoutes)

// Simple health check endpoint
app.get('/health', (_: Request, res: Response) => {
  res.send('OK')
})

// Start the server
export function startServer(port = 3000) {
  return new Promise<{ close: () => Promise<void> }>((resolve) => {
    const server = app.listen(port, () => {
      console.log(`API server listening on port ${port}`)
      resolve({
        close: () => new Promise<void>((closeResolve) => {
          console.log('Closing HTTP server')
          server.close(() => {
            console.log('HTTP server closed')
            closeResolve()
          })
        })
      })
    })
  })
}

export default app
