'use server';

import { redirect } from 'next/navigation';
import { Prisma } from '@arete/db';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { encryptCredentials } from '@/lib/telemetry-credentials';
import { buildStoredModelConfig } from './model-config-shared';

function assertAuthorized(
  installations: { id: string }[] | undefined,
  installationId: string,
): void {
  // Tenancy: only an installation this signed-in user administers.
  if (!installationId || !(installations ?? []).some((i) => i.id === installationId)) {
    redirect('/settings?error=model_forbidden');
  }
}

/** Server action: save a per-installation "connect your model" config. */
export async function saveModelConfig(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const installationId = String(formData.get('installationId') ?? '');
  assertAuthorized(session.installations, installationId);

  const stored = buildStoredModelConfig(
    {
      provider: String(formData.get('provider') ?? ''),
      model: formData.get('model') ? String(formData.get('model')) : undefined,
      baseUrl: formData.get('baseUrl') ? String(formData.get('baseUrl')) : undefined,
      apiKey: formData.get('apiKey') ? String(formData.get('apiKey')) : undefined,
    },
    encryptCredentials,
  );

  await db.installation.update({
    where: { id: installationId },
    data: { modelConfig: stored as unknown as Prisma.InputJsonValue },
  });

  redirect('/settings?modelConnected=1');
}

/** Server action: clear the config, reverting to the service default / Ollama fallback. */
export async function clearModelConfig(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const installationId = String(formData.get('installationId') ?? '');
  assertAuthorized(session.installations, installationId);

  await db.installation.update({
    where: { id: installationId },
    data: { modelConfig: Prisma.DbNull },
  });

  redirect('/settings?modelCleared=1');
}
