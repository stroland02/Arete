"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { cn } from "@/lib/utils";
import type { AuthorizedInstallation } from "@/lib/installations";

interface DashboardShellProps {
  children: ReactNode;
  installations: AuthorizedInstallation[];
  userName: string;
  signOutSlot: ReactNode;
}

export function DashboardShell({ children, installations, userName, signOutSlot }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        installations={installations}
        userName={userName}
        signOutSlot={signOutSlot}
      />
      <main
        className={cn(
          "flex-1 min-h-screen relative overflow-hidden transition-all duration-300",
          collapsed ? "ml-20" : "ml-64"
        )}
      >
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        <div className="absolute bottom-1/4 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        <Topbar />
        <div className="p-8">{children}</div>
      </main>
    </>
  );
}
