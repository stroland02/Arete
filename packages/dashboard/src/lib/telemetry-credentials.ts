import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function encryptionKey(): Buffer {
  const keyHex = process.env.TELEMETRY_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('Configuration error: TELEMETRY_ENCRYPTION_KEY is required');
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Byte-compatible copy of packages/webhook/src/telemetry/credentials.ts's
 * encryptCredentials — same algorithm, same iv:authTag:encrypted hex format,
 * so webhook's decryptCredentials can read whatever the dashboard writes
 * here. Dashboard only ever WRITES a credential (Connect flow), never reads
 * one back, so only the encrypt half is duplicated. Requires
 * TELEMETRY_ENCRYPTION_KEY to be the SAME value in both services' env.
 */
export function encryptCredentials(plaintext: object): string {
  const key = encryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Inverse of encryptCredentials — reads `iv:authTag:encrypted` (all hex) back
 * into the original object. Byte-compatible with the webhook's decryptCredentials
 * (same AES-256-GCM scheme + TELEMETRY_ENCRYPTION_KEY), so the dashboard can
 * read a key it (or the webhook) wrote. Used to build the `llm` block for agent
 * chat on the tenant's connected model.
 */
export function decryptCredentials<T>(ciphertext: string): T {
  const key = encryptionKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}
