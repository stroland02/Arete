import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireScope } from '@/lib/model-connections-api';

// Session-scoped; never statically prerendered.
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/model-connections/:id — disconnect a model connection. Scoped by
 * BOTH id AND the caller's authorized installations (deleteMany), so a caller
 * can never delete another tenant's connection by guessing an id.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const scope = await requireScope();
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  await db.modelConnection.deleteMany({
    // Installation-scoped rows OR the caller's own PENDING (pre-installation)
    // row — cross-tenant deletion stays impossible either way.
    where: {
      id,
      OR: [
        { installationId: { in: scope.installationIds } },
        { userId: scope.userId, installationId: null },
      ],
    },
  });
  return new NextResponse(null, { status: 204 });
}
