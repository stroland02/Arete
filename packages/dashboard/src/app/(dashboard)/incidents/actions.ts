'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { resolveSelectedInstallationIds } from '@/lib/queries';
import { createManualIncident, setIncidentNoise } from '@/lib/incidents';

const SEVERITIES = ['critical', 'warning'] as const;

export interface NewInvestigationState {
  error?: string;
}

/**
 * Opens a manual incident (a "New investigation"). `installationId` comes from
 * a hidden form field but is NEVER trusted alone — it must appear in the
 * signed-in session's own authorized installations, the same "never trust the
 * client-supplied id" rule as connectStripeApiKey / resolveSelectedInstallationIds.
 * Without it, any signed-in user could open an incident on ANY installation.
 */
export async function createInvestigationAction(
  _prevState: NewInvestigationState,
  formData: FormData,
): Promise<NewInvestigationState> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const installationId = formData.get('installationId');
  const title = formData.get('title');
  const severity = formData.get('severity');
  const summary = formData.get('summary');

  if (
    typeof installationId !== 'string' ||
    typeof title !== 'string' ||
    typeof severity !== 'string' ||
    typeof summary !== 'string'
  ) {
    return { error: 'Invalid form submission.' };
  }

  const authorized = (session.installations ?? []).some((i) => i.id === installationId);
  if (!authorized) {
    return { error: 'You are not authorized to open an investigation for that installation.' };
  }

  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0) {
    return { error: 'Give the investigation a title.' };
  }
  if (!SEVERITIES.includes(severity as (typeof SEVERITIES)[number])) {
    return { error: 'Pick a severity.' };
  }

  const id = await createManualIncident(db, installationId, {
    alertName: trimmedTitle,
    severity,
    summary: summary.trim(),
  });

  revalidatePath('/incidents');
  redirect(`/incidents/${id}`);
}

/**
 * Marks an incident as noise, or clears that. Tenant-scoped through
 * setIncidentNoise (updateMany pinned to the session's installations), so an id
 * outside the caller's installations is a silent no-op. Stays on the detail
 * page; revalidates so the new state renders.
 */
export async function setIncidentNoiseAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const id = formData.get('id');
  const noise = formData.get('noise');
  if (typeof id !== 'string') {
    return;
  }

  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], undefined);
  await setIncidentNoise(db, installationIds, id, noise === 'true');

  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
}
