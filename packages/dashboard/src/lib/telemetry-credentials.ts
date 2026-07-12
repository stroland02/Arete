import { createCipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Byte-compatible copy of packages/webhook/src/telemetry/credentials.ts's
 * encryptCredentials — same algorithm, same iv:authTag:encrypted hex format,
 * so webhook's decryptCredentials can read whatever the dashboard writes
 * here. Dashboard only ever WRITES a credential (Connect flow), never reads
 * one back, so only the encrypt half is duplicated. Requires
 * TELEMETRY_ENCRYPTION_KEY to be the SAME value in both services' env.
 */
export function encryptCredentials(plaintext: object): string {
  const keyHex = process.env.TELEMETRY_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('Configuration error: TELEMETRY_ENCRYPTION_KEY is required');
  }
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}
