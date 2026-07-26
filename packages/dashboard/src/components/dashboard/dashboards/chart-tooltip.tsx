"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { motionDuration } from "@/lib/motion";

export interface ChartTooltipProps {
  /** Offset from the relative wrapper's top-left; px number or CSS length (e.g. "42%"). */
  x: number | string;
  y: number | string;
  visible: boolean;
  children: ReactNode;
}

/**
 * Shared hover tooltip for the hand-rolled SVG charts. Render it inside a
 * `relative` wrapper; the chart supplies the anchor point and the tooltip
 * floats centered above it. Pointer-events are disabled so it never steals
 * the hover it annotates. Hidden entirely until `visible` (hover is a client
 * interaction — server markup renders nothing).
 */
export function ChartTooltip({ x, y, visible, children }: ChartTooltipProps) {
  return (
    <div aria-hidden className="pointer-events-none absolute left-0 top-0 z-10">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionDuration.micro }}
            className="absolute whitespace-nowrap rounded-lg border border-border-default bg-surface-2 px-2.5 py-1.5"
            style={{ left: x, top: y, transform: "translate(-50%, calc(-100% - 10px))", boxShadow: "var(--shadow-card)" }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
