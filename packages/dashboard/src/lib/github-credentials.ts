import { createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Decrypts a GitHub access token previously encrypted via
 * `encryptCredentials({ accessToken })` (telemetry-credentials.ts), stored
 * on `Account.githubAccessTokenEncrypted`. Same `aes-256-gcm`
 * `iv:authTag:ciphertext` hex format, same `TELEMETRY_ENCRYPTION_KEY`.
 *
 * This is the first dashboard-side code that needs to read back something
 * it encrypted (telemetry credentials are write-only from the dashboard's
 * side — packages/webhook decrypts those). Throws if the key is missing or
 * the ciphertext/auth-tag doesn't match (tampered or wrong key) — callers
 * (auth.ts's jwt callback) must catch this and fail closed to the
 * last-known-good cached installations list, never to "all installations."
 */
export function decryptGithubToken(encrypted: string): string {
  const keyHex = process.env.TELEMETRY_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('Configuration error: TELEMETRY_ENCRYPTION_KEY is required');
  }
  const [ivHex, authTagHex, cipherHex] = encrypted.split(':');
  const decipher = createDecipheriv(ALGORITHM, Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]);
  return (JSON.parse(decrypted.toString('utf8')) as { accessToken: string }).accessToken;
}
