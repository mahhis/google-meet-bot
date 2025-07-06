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
  return new Promise<void>((resolve) => {
    const server = app.listen(port, () => {
      console.log(`API server listening on port ${port}`)
      resolve()
    })

    // Handle server shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM signal received: closing HTTP server')
      server.close(() => {
        console.log('HTTP server closed')
      })
    })
  })
}

export default app
