"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { cn } from "@/lib/utils";
import type { AuthorizedInstallation } from "@/lib/installations";
import { LoadingProvider } from "@/lib/loading-context";

interface DashboardShellProps {
  children: ReactNode;
  installations: AuthorizedInstallation[];
  userName: string;
  userEmail: string | null;
  signOutSlot: ReactNode;
}

export function DashboardShell({ children, installations, userName, userEmail, signOutSlot }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <LoadingProvider>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        installations={installations}
        userName={userName}
        userEmail={userEmail}
        signOutSlot={signOutSlot}
      />
      <main
        className={cn(
          "flex-1 min-h-screen relative overflow-hidden transition-all duration-300",
          collapsed ? "ml-20" : "ml-64"
        )}
      >
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-accent-info/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        <Topbar />
        <div className="p-8">{children}</div>
      </main>
    </LoadingProvider>
  );
}
