'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { encryptCredentials } from '@/lib/telemetry-credentials';

export interface ConnectApiKeyState {
  error?: string;
}

/**
 * Stores an API-key-based TelemetryConnection (currently Stripe only).
 * `installationId` comes from a hidden form field, but is NEVER trusted on
 * its own — it must appear in the signed-in session's own authorized
 * installations list, same "never trust the client-supplied id alone"
 * pattern as resolveSelectedInstallationIds (queries.ts). Without this
 * check, any signed-in user could write a credential onto ANY installation
 * by editing the hidden field.
 */
export async function connectStripeApiKey(
  _prevState: ConnectApiKeyState,
  formData: FormData
): Promise<ConnectApiKeyState> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const installationId = formData.get('installationId');
  const secretKey = formData.get('secretKey');

  if (typeof installationId !== 'string' || typeof secretKey !== 'string') {
    return { error: 'Invalid form submission.' };
  }

  const authorized = (session.installations ?? []).some((i) => i.id === installationId);
  if (!authorized) {
    return { error: 'You are not authorized to connect a source for that installation.' };
  }

  const trimmedKey = secretKey.trim();
  if (trimmedKey.length === 0) {
    return { error: 'Enter a Stripe restricted API key.' };
  }

  const encrypted = encryptCredentials({ secretKey: trimmedKey });

  await db.telemetryConnection.upsert({
    where: { installationId_provider: { installationId, provider: 'stripe' } },
    create: {
      installationId,
      provider: 'stripe',
      config: {},
      credentials: encrypted,
      authMethod: 'api_key',
    },
    update: {
      credentials: encrypted,
      authMethod: 'api_key',
    },
  });

  redirect('/connections?connected=stripe');
}
