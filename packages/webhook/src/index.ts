import { createServer } from './server.js'
import { getConfig } from './config.js'
import { logger } from './logger.js'

const log = logger.child({ component: 'index' })
const config = getConfig()

createServer()
  .then((app) => {
    app.listen(config.port, () => {
      log.info({ port: config.port }, 'Areté webhook server listening')
      log.info({ endpoint: `POST http://localhost:${config.port}/webhook` }, 'webhook endpoint ready')
      log.info({ endpoint: `GET http://localhost:${config.port}/health` }, 'health check ready')
    })
  })
  .catch((err) => {
    log.error({ err }, 'Failed to start server')
    process.exit(1)
  })
