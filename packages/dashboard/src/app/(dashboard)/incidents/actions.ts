'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { resolveSelectedInstallationIds } from '@/lib/queries';
import { createManualIncident, setIncidentNoise } from '@/lib/incidents';
import { dispatchFixTrigger } from '@/lib/fix-dispatch';
import {
  ERROR_STATUSES,
  attachErrorGroupToIncident,
  resolveIncidentWithErrors,
  setErrorGroupStatus,
  type ErrorStatus,
} from '@/lib/errors';

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

  // Opens the incident, the WorkItem that makes it healable, and (when a repo
  // is connected) the fix run itself.
  const { incidentId, workItemId, containerId } = await createManualIncident(
    db,
    installationId,
    { alertName: trimmedTitle, severity, summary: summary.trim() },
  );

  // Auto-start: the container exists and the WorkItem is already `fixing`, so
  // kick the drive. Fire-and-forget by contract — a dispatch failure leaves a
  // retriable run, never a failed investigation. No container (tenant has no
  // connected repository) means there is nothing to fix against yet, so the
  // WorkItem stays `open` and nothing is dispatched.
  if (containerId) {
    await dispatchFixTrigger(workItemId);
  }

  revalidatePath('/incidents');
  redirect(`/incidents/${incidentId}`);
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

/**
 * Triages ONE error group (Open / Observing / Resolved / Silenced). Tenant-scoped
 * through setErrorGroupStatus (pinned to the session's installations), so a
 * fingerprint outside the caller's installations is a silent no-op — the same
 * "never trust the client-supplied id" rule as setIncidentNoiseAction.
 */
export async function setErrorStatusAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const fingerprint = formData.get('fingerprint');
  const status = formData.get('status');
  if (typeof fingerprint !== 'string' || typeof status !== 'string') {
    return;
  }
  if (!ERROR_STATUSES.includes(status as ErrorStatus)) {
    return;
  }

  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], undefined);
  await setErrorGroupStatus(db, installationIds, fingerprint, status as ErrorStatus);

  revalidatePath('/incidents');
}

/**
 * Attaches an error group to an incident, or detaches it (`incidentId` absent
 * or empty). This is the join the two views share: Errors are the individual
 * failures, an Incident is the grouping that resolves them together.
 * Tenant-scoped through attachErrorGroupToIncident.
 */
export async function attachErrorAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const fingerprint = formData.get('fingerprint');
  const rawIncidentId = formData.get('incidentId');
  if (typeof fingerprint !== 'string') {
    return;
  }

  const incidentId =
    typeof rawIncidentId === 'string' && rawIncidentId.length > 0 ? rawIncidentId : null;

  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], undefined);
  await attachErrorGroupToIncident(db, installationIds, fingerprint, incidentId);

  if (incidentId) {
    revalidatePath(`/incidents/${incidentId}`);
  }
  // A detach still has to refresh the page it was performed on.
  const from = formData.get('from');
  if (typeof from === 'string' && from.length > 0) {
    revalidatePath(`/incidents/${from}`);
  }
  revalidatePath('/incidents');
}

/**
 * Resolves an incident together with every error group attached to it — the
 * whole point of grouping errors into an incident. Tenant-scoped through
 * resolveIncidentWithErrors, which returns how many groups it closed; an id
 * outside the caller's installations closes nothing.
 */
export async function resolveIncidentWithErrorsAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const id = formData.get('id');
  if (typeof id !== 'string') {
    return;
  }

  const installationIds = resolveSelectedInstallationIds(session.installations ?? [], undefined);
  await resolveIncidentWithErrors(db, installationIds, id);

  revalidatePath(`/incidents/${id}`);
  revalidatePath('/incidents');
}
