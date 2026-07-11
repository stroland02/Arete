"use client";

import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "framer-motion";

/**
 * Animates a metric value counting up from 0 on mount. Only the leading
 * integer portion of the string is animated; any remaining suffix (units,
 * symbols) renders statically. Non-numeric values render as-is.
 *
 * Server-rendered HTML (and no-JS clients) always show the final value;
 * the count-up only kicks in after hydration. Users with
 * prefers-reduced-motion get the final value immediately.
 */

const LEADING_INTEGER = /^(\d+)(.*)$/;

export function CountUpValue({ value }: { value: string }) {
  const match = LEADING_INTEGER.exec(value);
  const target = match ? Number.parseInt(match[1], 10) : null;
  const suffix = match ? match[2] : "";

  const numberRef = useRef<HTMLSpanElement>(null);
  const hasPlayedRef = useRef(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const node = numberRef.current;
    if (target === null || node === null) return;

    if (reducedMotion) {
      // Ensure the final value is shown even if motion preference flips
      // mid-animation (cleanup below stops the tween wherever it was).
      node.textContent = String(target);
      return;
    }

    // Play once per mount — don't re-run if reducedMotion resolves late.
    if (hasPlayedRef.current) return;
    hasPlayedRef.current = true;

    node.textContent = "0";
    const controls = animate(0, target, {
      duration: 1,
      delay: 0.2,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        node.textContent = String(Math.round(latest));
      },
    });

    return () => controls.stop();
  }, [target, reducedMotion]);

  if (target === null) {
    return <>{value}</>;
  }

  return (
    <>
      <span ref={numberRef}>{target}</span>
      {suffix}
    </>
  );
}
