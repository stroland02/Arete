"use client";

import { motion } from "framer-motion";
import { KumaLogo } from "@/components/ui/kuma-logo";
import { IconBug, IconGitPullRequest } from "@tabler/icons-react";

export function SynthesizerVisual() {
  return (
    <div className="w-full h-[700px] sm:h-[600px] rounded-2xl border border-border-default bg-surface-0 shadow-2xl relative overflow-hidden flex items-center justify-center">
      {/* Subtle background glow */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[600px] rounded-full bg-accent-primary/10 blur-[100px] pointer-events-none" />

      <BugZap delay={0} startX={-250} startY={200} holdX={-120} holdY={40} endX={-80} endY={-400} />
      <BugZap delay={2} startX={250} startY={-200} holdX={140} holdY={-60} endX={100} endY={-400} />
      <BugZap delay={4} startX={50} startY={300} holdX={30} holdY={110} endX={0} endY={-400} />

      {/* Animated Central Node */}
      <div className="relative flex items-center justify-center">
        {/* Pulsing rings */}
        <motion.div
          className="absolute h-64 w-64 rounded-full border border-accent-primary/30"
          animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute h-48 w-48 rounded-full border border-accent-primary/40"
          animate={{ scale: [1, 1.2, 1], opacity: [0.6, 0.1, 0.6] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />
        
        {/* The Node */}
        <div className="relative z-10 flex h-32 w-32 items-center justify-center">
          <KumaLogo size={100} className="text-accent-primary relative z-10 drop-shadow-[0_0_15px_rgba(0,212,255,0.8)]" />
        </div>
      </div>
    </div>
  );
}

function BugZap({ delay = 0, startX, startY, holdX, holdY, endX, endY }: any) {
  const angle = Math.round(Math.atan2(holdY, holdX) * (180 / Math.PI));
  const distance = Math.round(Math.sqrt(holdX * holdX + holdY * holdY));

  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      <motion.div
        className="absolute left-1/2 top-1/2 z-30 flex items-center justify-center"
        animate={{
          x: [startX, holdX, holdX, holdX, endX],
          y: [startY, holdY, holdY, holdY, endY],
          opacity: [0, 1, 1, 1, 0],
        }}
        transition={{ duration: 6, delay, repeat: Infinity, ease: "easeInOut", times: [0, 0.2, 0.4, 0.6, 1] }}
      >
        <motion.div
          className="absolute flex items-center justify-center h-10 w-10 bg-surface-0 rounded-full border shadow-lg"
          animate={{
            borderColor: ["#dc2626", "#dc2626", "#dc2626", "#22c55e", "#22c55e"],
            boxShadow: ["0 0 15px rgba(220,38,38,0.3)", "0 0 15px rgba(220,38,38,0.3)", "0 0 15px rgba(220,38,38,0.3)", "0 0 15px rgba(34,197,94,0.3)", "0 0 15px rgba(34,197,94,0.3)"]
          }}
          transition={{ duration: 6, delay, repeat: Infinity, ease: "easeInOut", times: [0, 0.2, 0.4, 0.6, 1] }}
        >
          <motion.div 
            className="absolute text-red-600"
            animate={{ opacity: [1, 1, 0, 0, 0], scale: [1, 1, 0, 0, 0], rotate: [0, 15, -15, 0, 0] }}
            transition={{ duration: 6, delay, repeat: Infinity, times: [0, 0.45, 0.55, 1, 1] }}
          >
            <IconBug size={20} />
          </motion.div>
          <motion.div 
            className="absolute text-accent-success"
            animate={{ opacity: [0, 0, 1, 1, 1], scale: [0, 0, 1, 1, 1] }}
            transition={{ duration: 6, delay, repeat: Infinity, times: [0, 0.45, 0.55, 1, 1] }}
          >
            <IconGitPullRequest size={20} />
          </motion.div>
        </motion.div>
      </motion.div>

      {/* The ZAP Laser */}
      <motion.div
        className="absolute left-1/2 top-1/2 h-[2px] bg-accent-primary origin-left z-20"
        style={{ 
          width: distance - 20, // stop slightly before the bug
          rotate: angle,
          filter: "drop-shadow(0 0 6px #00d4ff) drop-shadow(0 0 12px #00d4ff)" 
        }}
        animate={{
          opacity: [0, 0, 1, 0, 0],
          scaleX: [0, 0, 1, 0, 0],
        }}
        transition={{ duration: 6, delay, repeat: Infinity, times: [0, 0.4, 0.45, 0.55, 1] }}
      />
    </div>
  );
}
