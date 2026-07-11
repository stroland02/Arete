"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { springTransition } from "@/lib/motion";
import { InstallationSwitcher } from "@/components/InstallationSwitcher";
import { SignOutButton } from "@/components/SignOutButton";
import type { AuthorizedInstallation } from "@/lib/installations";

const collapseTransition = { ...springTransition, opacity: { duration: 0.15 } } as const;

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/history", label: "Review History" },
  { href: "/settings", label: "Settings" },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  installations: AuthorizedInstallation[];
  userName: string;
}

export function Sidebar({ collapsed, onToggleCollapsed, installations, userName }: SidebarProps) {
  const pathname = usePathname();
  const initial = userName.charAt(0).toUpperCase();

  return (
    <aside
      className={cn(
        "glass border-r border-slate-800/50 flex flex-col fixed h-full z-20 transition-all duration-300",
        collapsed ? "w-20" : "w-64"
      )}
    >
      <div className="p-6 h-[68px] flex items-center overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {collapsed ? (
            <motion.h1
              key="brand-mark"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={collapseTransition}
              className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300 tracking-tight"
            >
              A
            </motion.h1>
          ) : (
            <motion.h1
              key="brand-wordmark"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={collapseTransition}
              className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300 tracking-tight whitespace-nowrap"
            >
              Areté AI
            </motion.h1>
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
                isActive ? "text-content-primary" : "text-content-muted hover:text-white hover:bg-white/5"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="sidebar-active-indicator"
                  className="absolute inset-0 bg-white/5 border border-border-default rounded-xl shadow-sm"
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
        className="mx-4 mb-2 flex items-center justify-center h-8 rounded-lg text-content-muted hover:text-white hover:bg-white/5 transition-colors"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <IconChevronRight className="w-4 h-4" /> : <IconChevronLeft className="w-4 h-4" />}
      </button>

      <div className="p-4 border-t border-slate-800/50">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-sm font-bold shadow-lg ring-2 ring-indigo-500/20 shrink-0">
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
                <SignOutButton />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </aside>
  );
}
