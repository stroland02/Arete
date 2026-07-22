"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { IconPlugConnected, IconClockHour4, IconArrowRight } from "@tabler/icons-react";

export type BannerVariant = "connect-service" | "awaiting-review";

type Copy = {
  title: string;
  desc: string;
  Icon: typeof IconPlugConnected;
  cta?: { label: string; href: string };
};

const COPY: Record<BannerVariant, Copy> = {
  "connect-service": {
    title: "See your telemetry in one place",
    desc: "Below is the shape of this dashboard. Connect a service like Sentry, Vercel, or PostHog and its latest metrics appear here, captured at each review.",
    Icon: IconPlugConnected,
    cta: { label: "Connect a service", href: "/connections" },
  },
  "awaiting-review": {
    title: "Waiting for your first review",
    desc: "Everything's connected. Open a pull request on a connected repository and its review appears here — usually within a couple of minutes.",
    Icon: IconClockHour4,
  },
};

/** Single contextual status banner for the Dashboards preview states. Shown ONCE
 *  by the workspace — never per widget. */
export function DashboardStatusBanner({ variant }: { variant: BannerVariant }) {
  const { title, desc, Icon, cta } = COPY[variant];
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-start gap-4 rounded-2xl border border-border-default bg-surface-1 p-5 sm:flex-row sm:items-center"
      style={{ backgroundImage: "radial-gradient(120% 180% at 0% 0%, rgba(124,151,255,0.10), transparent 60%)" }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-default bg-accent-primary/15 text-accent-primary">
        <Icon className="h-5 w-5" stroke={1.6} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-content-primary">{title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-content-muted">{desc}</p>
      </div>
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-primary/90"
        >
          {cta.label} <IconArrowRight className="h-4 w-4" />
        </Link>
      )}
    </motion.div>
  );
}
