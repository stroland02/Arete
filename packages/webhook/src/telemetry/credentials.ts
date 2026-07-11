import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getTelemetryConfig } from '../config.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

/** Encrypts a credential object (e.g. { apiKey: "..." }) for storage in
 * TelemetryConnection.credentials. AES-256-GCM with a random IV per call —
 * ciphertext is `iv:authTag:encrypted`, all hex-encoded, so it round-trips
 * cleanly through a Prisma String column. */
export function encryptCredentials(plaintext: object): string {
  const key = Buffer.from(getTelemetryConfig().encryptionKey, 'hex')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(plaintext), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptCredentials<T>(ciphertext: string): T {
  const key = Buffer.from(getTelemetryConfig().encryptionKey, 'hex')
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':')
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()])
  return JSON.parse(decrypted.toString('utf8')) as T
}
