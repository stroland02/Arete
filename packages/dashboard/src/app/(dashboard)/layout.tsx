import { redirect } from "next/navigation";
import { auth } from "../../lib/auth";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { SignOutButton } from "@/components/SignOutButton";
import { GlassBoxDock } from "@/components/dashboard/glassbox/glassbox-dock";
import { getActiveModelConnection } from "@/lib/model-connections-api";

// This layout wraps every authenticated dashboard route. It reads the
// session itself (in addition to proxy.ts) so it can render the signed-in
// user and their authorized installations — proxy.ts only gates access, it
// doesn't hand session data to the render tree.
//
// SignOutButton is a Server Component (it imports lib/auth's server-only
// signOut action) and is passed down to DashboardShell/Sidebar — both
// Client Components — as an already-rendered ReactNode slot, not imported
// by them directly. A Client Component can never import a Server Component
// module itself; it can only render one it's handed as children/props.
export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const installations = session.installations ?? [];
  const userEmail = session.user.email ?? null;
  const userName = session.user.name ?? userEmail ?? "Signed in";
  const activeModel = await getActiveModelConnection();

  return (
    <>
      <DashboardShell
        installations={installations}
        userName={userName}
        userEmail={userEmail}
        activeModel={activeModel}
        signOutSlot={<SignOutButton />}
      >
        {children}
      </DashboardShell>
      {/* Glass Box live cockpit — inert unless NEXT_PUBLIC_GLASSBOX_URL is set
          (dev only). Additive, presentational; no server/Redis dependency. */}
      <GlassBoxDock />
    </>
  );
}
