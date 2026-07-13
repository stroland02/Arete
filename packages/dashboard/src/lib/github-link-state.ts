import { createHmac, timingSafeEqual } from 'node:crypto';

// Self-contained, signed CSRF state for the "Connect GitHub" account-link
// flow — adapted from packages/webhook/src/oauth/oauth-state.ts (same
// HMAC-SHA256 + timingSafeEqual + base64url `payload:signature` shape, same
// 10-minute TTL). Signs `userId` (the dashboard session's own user id)
// rather than an installationId/provider pair, because this state is about
// *which signed-in dashboard user* initiated the link, not which
// installation/provider a credential belongs to.
//
// Keyed off AUTH_SECRET (NextAuth's own session-signing secret) rather than
// TELEMETRY_ENCRYPTION_KEY: this token proves session identity, not
// encrypted-credential integrity, so it deliberately uses a different
// secret than the one that protects the stored GitHub access token — a
// leaked encryption key alone should not let an attacker forge a valid
// account-link state token.
const STATE_TTL_MS = 10 * 60 * 1000;

function sign(payload: string): string {
  const key = process.env.AUTH_SECRET;
  if (!key) throw new Error('Configuration error: AUTH_SECRET is required');
  return createHmac('sha256', key).update(payload).digest('hex');
}

export function signGithubLinkState(userId: string): string {
  const expiresAt = Date.now() + STATE_TTL_MS;
  const payload = `${userId}:${expiresAt}`;
  const signature = sign(payload);
  return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

export function verifyGithubLinkState(token: string): { userId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [userId, expiresAtStr, signature] = parts;

    const payload = `${userId}:${expiresAtStr}`;
    const expectedSignature = sign(payload);
    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;

    return { userId };
  } catch {
    return null;
  }
}
