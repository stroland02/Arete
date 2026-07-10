import { z } from 'zod'

const ConfigSchema = z.object({
  GITHUB_APP_ID: z
    .string({ required_error: 'GITHUB_APP_ID is required' })
    .min(1, 'GITHUB_APP_ID is required')
    .transform(Number),
  GITHUB_PRIVATE_KEY: z
    .string({ required_error: 'GITHUB_PRIVATE_KEY is required' })
    .min(1, 'GITHUB_PRIVATE_KEY is required'),
  GITHUB_WEBHOOK_SECRET: z
    .string({ required_error: 'GITHUB_WEBHOOK_SECRET is required' })
    .min(1, 'GITHUB_WEBHOOK_SECRET is required'),
  PORT: z.string().default('3000').transform(Number),
})

export interface Config {
  appId: number
  privateKey: string
  webhookSecret: string
  port: number
}

export function getConfig(): Config {
  const result = ConfigSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.message).join(', ')
    throw new Error(`Configuration error: ${missing}`)
  }
  return {
    appId: result.data.GITHUB_APP_ID,
    privateKey: result.data.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
    webhookSecret: result.data.GITHUB_WEBHOOK_SECRET,
    port: result.data.PORT,
  }
}
