'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { AuthorizedInstallation } from '../lib/installations';

/**
 * Dropdown to pick a single authorized installation to view, or "All" to
 * aggregate across every installation the session is authorized for.
 * Selection is persisted as a `?installation=<id>` query param so it's
 * shareable/bookmarkable and survives a refresh without extra state.
 * Only rendered when the user is authorized for more than one installation.
 */
export function InstallationSwitcher({
  installations,
}: {
  installations: AuthorizedInstallation[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('installation') ?? undefined;

  if (installations.length <= 1) return null;

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') {
      params.delete('installation');
    } else {
      params.set('installation', value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <select
      value={selectedId ?? 'all'}
      onChange={(e) => handleChange(e.target.value)}
      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
    >
      <option value="all">All Installations</option>
      {installations.map((installation) => (
        <option key={installation.id} value={installation.id}>
          {installation.owner}
        </option>
      ))}
    </select>
  );
}
