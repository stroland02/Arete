"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { IconChevronLeft, IconChevronRight, IconCpu } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { springTransition } from "@/lib/motion";
import { InstallationSwitcher } from "@/components/InstallationSwitcher";
import { KumaLogo } from "@/components/ui/kuma-logo";
import { useGlobalLoading } from "@/lib/loading-context";
import { MODEL_PROVIDERS } from "@/lib/model-catalog";
import type { ReactNode } from "react";
import type { AuthorizedInstallation } from "@/lib/installations";
import type { ActiveModelConnection } from "@/lib/model-connections-map";

const collapseTransition = { ...springTransition, opacity: { duration: 0.15 } } as const;

const NAV_ITEMS = [
  { href: "/overview", label: "Overview" },
  // Code map is reached from the Overview page (inline map + "Open map"), not a
  // top-level tab. Dashboards charts are now a section of Overview too. Both
  // routes still exist (/map deep-links; /dashboards redirects to /overview).
  { href: "/services", label: "Services" },
  { href: "/agents", label: "Agents" },
  // Incidents lives on Overview too (its own section), but a top-level tab
  // makes it deep-linkable/discoverable the same way Services and Agents are.
  { href: "/incidents", label: "Incidents" },
  // Connections and Review History now live under Settings (linked from the
  // Settings page). Their routes still exist for those links + deep-links.
  { href: "/settings", label: "Settings" },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  installations: AuthorizedInstallation[];
  userName: string;
  userEmail: string | null;
  activeModel: ActiveModelConnection | null;
  signOutSlot: ReactNode;
}

export function Sidebar({ collapsed, onToggleCollapsed, installations, userName, userEmail, activeModel, signOutSlot }: SidebarProps) {
  const pathname = usePathname();
  const { isLoading, setIsLoading } = useGlobalLoading();
  const initial = userName.charAt(0).toUpperCase();
  // The model every AI-processing page/service runs on (newest = active,
  // matching the review resolver). Shown on every page so "which model am I
  // running" is answered globally, not just on the AI Models card.
  const activeProviderName = activeModel
    ? MODEL_PROVIDERS.find((p) => p.id === activeModel.provider)?.name ?? activeModel.provider
    : null;

  // A quick demonstration handler to prove the decoupled data pipeline loading state
  const handleSimulateLoad = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 3000); // Spins for 3 seconds simulating a heavy data fetch
  };

  return (
    <aside
      className={cn(
        "glass border-r border-border-subtle flex flex-col fixed h-full z-20 transition-all duration-300",
        collapsed ? "w-20" : "w-64"
      )}
    >
      <div 
        className="p-6 h-[68px] flex items-center overflow-hidden cursor-pointer group" 
        onClick={handleSimulateLoad} 
        title="Click to simulate data pipeline loading!"
      >
        <AnimatePresence mode="wait" initial={false}>
          {collapsed ? (
            <motion.div
              key="brand-mark"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={collapseTransition}
              className="flex items-center text-accent-primary drop-shadow-[0_0_8px_rgba(0,212,255,0.4)]"
            >
              <KumaLogo size={28} isLoading={isLoading} />
            </motion.div>
          ) : (
            <motion.div
              key="brand-wordmark"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={collapseTransition}
              className="flex items-center gap-2 text-accent-primary"
            >
              <span className="drop-shadow-[0_0_8px_rgba(0,212,255,0.4)]">
                <KumaLogo size={28} isLoading={isLoading} />
              </span>
              <span className="text-2xl font-semibold font-serif text-content-primary tracking-tight whitespace-nowrap">
                Kuma
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!collapsed && installations.length > 1 && (
        <div className="px-4 mb-2">
          <InstallationSwitcher installations={installations} />
        </div>
      )}

      <nav className="flex-1 px-4 space-y-1.5 mt-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-colors duration-150",
                isActive ? "text-content-primary" : "text-content-muted hover:text-content-primary hover:bg-content-primary/5"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-indicator"
                  className="absolute inset-0 bg-content-primary/5 border border-border-default rounded-xl shadow-sm"
                  transition={springTransition}
                />
              )}
              <span className="relative grid">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={collapsed ? "short" : "full"}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={collapseTransition}
                    className="col-start-1 row-start-1 whitespace-nowrap"
                  >
                    {collapsed ? item.label[0] : item.label}
                  </motion.span>
                </AnimatePresence>
              </span>
            </Link>
          );
        })}
      </nav>

      <button
        onClick={onToggleCollapsed}
        className="mx-4 mb-2 flex items-center justify-center h-8 rounded-lg text-content-muted hover:text-content-primary hover:bg-content-primary/5 transition-colors"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <IconChevronRight className="w-4 h-4" /> : <IconChevronLeft className="w-4 h-4" />}
      </button>

      <Link
        href="/connections/ai-models"
        title={activeProviderName ? `Running on ${activeProviderName} · ${activeModel?.model}` : "No AI model connected — click to connect"}
        className={cn(
          "mx-4 mb-2 flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors",
          activeModel
            ? "border-border-default bg-content-primary/5 hover:bg-content-primary/10"
            : "border-dashed border-border-subtle text-content-muted hover:bg-content-primary/5",
          collapsed && "justify-center px-0"
        )}
      >
        <IconCpu className={cn("w-4 h-4 shrink-0", activeModel ? "text-accent-primary" : "text-content-muted")} />
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] uppercase tracking-wide text-content-muted">Running on</span>
            {activeModel ? (
              <>
                <span className="block text-xs font-medium text-content-primary truncate">{activeProviderName}</span>
                <span className="block font-mono text-[10px] text-content-muted truncate">{activeModel.model}</span>
              </>
            ) : (
              <span className="block text-xs font-medium text-content-secondary truncate">Connect a model</span>
            )}
          </span>
        )}
      </Link>

      <div className="p-4 border-t border-border-subtle">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-9 h-9 rounded-full bg-accent-primary text-white flex items-center justify-center text-sm font-bold shadow-sm ring-2 ring-accent-primary/20 shrink-0">
            {initial}
          </div>
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                key="user-info"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={collapseTransition}
                className="text-sm overflow-hidden whitespace-nowrap min-w-0 flex-1"
              >
                <p className="font-medium text-content-secondary truncate">{userName}</p>
                {userEmail && userEmail !== userName ? (
                  <p className="text-xs text-content-muted truncate" title={userEmail}>{userEmail}</p>
                ) : null}
                {signOutSlot}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </aside>
  );
}
