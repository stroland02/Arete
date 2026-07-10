import { createServer } from './server.js'
import { getConfig } from './config.js'

const config = getConfig()

createServer()
  .then((app) => {
    app.listen(config.port, () => {
      console.log(`Areté webhook server listening on port ${config.port}`)
      console.log(`Webhook endpoint: POST http://localhost:${config.port}/webhook`)
      console.log(`Health check:     GET  http://localhost:${config.port}/health`)
    })
  })
  .catch((err) => {
    console.error('Failed to start server:', err)
    process.exit(1)
  })
