"use client";

import type { ReactNode } from "react";
import { motion, MotionConfig } from "framer-motion";
import { staggerContainer, fadeSlideUp } from "@/lib/motion";

/**
 * Client boundary for page entrance choreography. Server components render
 * their content and pass it in as children; PageReveal orchestrates a
 * staggered reveal of every descendant RevealItem in tree order.
 *
 * `MotionConfig reducedMotion="user"` collapses the y-transform to a plain
 * opacity fade for users with prefers-reduced-motion.
 */
export function PageReveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div className={className} variants={staggerContainer} initial="hidden" animate="show">
        {children}
      </motion.div>
    </MotionConfig>
  );
}

/**
 * A single unit of the page cascade. Inherits its "hidden" -> "show" timing
 * from the nearest PageReveal ancestor, so it works even when nested inside
 * plain (non-motion) layout elements.
 */
export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={fadeSlideUp}>
      {children}
    </motion.div>
  );
}
