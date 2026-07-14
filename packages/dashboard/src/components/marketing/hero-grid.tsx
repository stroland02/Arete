"use client";

import { motion } from "framer-motion";
import { IconGitBranch, IconShieldCheck } from "@tabler/icons-react";

export function HeroGrid() {
  return (
    <div className="absolute inset-0 z-0 flex w-full h-full justify-center overflow-hidden pointer-events-none [mask-image:radial-gradient(ellipse_100%_100%_at_50%_0%,#000_80%,transparent_100%)]">
      {/* 
        The SVG Grid: 
        Uses x="50%" to anchor the grid perfectly to the center of the viewport.
        Grid lines are drawn every 120px out from the center.
      */}
      <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="hero-grid-pattern" width="120" height="120" patternUnits="userSpaceOnUse" x="50%" y="0">
            <path d="M 120 0 L 0 0 0 120" fill="none" stroke="currentColor" className="text-border-strong opacity-40" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hero-grid-pattern)" />
      </svg>

      {/* Floating Elements Container */}
      {/* We use a full-width container and left-1/2 with margins to perfectly lock to the 120px grid intersections regardless of screen size */}
      <div className="relative w-full h-full">
        
        {/* === TOP CORNERS (X: ±480, Y: 120) === */}
        <motion.div 
          className="absolute top-[120px] left-1/2 -ml-[480px] -translate-x-1/2 -translate-y-1/2 text-accent-primary"
          animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="drop-shadow-[0_0_8px_rgba(0,212,255,0.8)]">
            <path d="M8 0v16M0 8h16" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </motion.div>
        
        <motion.div 
          className="absolute top-[120px] left-1/2 ml-[480px] -translate-x-1/2 -translate-y-1/2 text-accent-primary"
          animate={{ scale: [1, 1.4, 1], opacity: [0.4, 1, 0.4] }}
          transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: 1 }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="drop-shadow-[0_0_8px_rgba(0,212,255,0.8)]">
            <path d="M8 0v16M0 8h16" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </motion.div>

        {/* === MIDDLE TEXT BOXES (X: ±420, Y: 180) - Centered in grid squares === */}
        <motion.div 
          className="absolute top-[180px] left-1/2 -ml-[420px] -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] text-content-muted/50 tracking-widest whitespace-nowrap"
          animate={{ opacity: [0.15, 0.5, 0.15] }}
          transition={{ repeat: Infinity, duration: 5, ease: "easeInOut", delay: 0.5 }}
        >
          [ AST ]
        </motion.div>

        <motion.div 
          className="absolute top-[180px] left-1/2 ml-[420px] -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] text-content-muted/50 tracking-widest whitespace-nowrap"
          animate={{ opacity: [0.15, 0.5, 0.15] }}
          transition={{ repeat: Infinity, duration: 5, ease: "easeInOut", delay: 2.5 }}
        >
          [ PR ]
        </motion.div>

        {/* === LOWER ICONS (X: ±300, Y: 420) - Centered in grid squares === */}
        <motion.div 
          className="absolute top-[420px] left-1/2 -ml-[300px] -translate-x-1/2 -translate-y-1/2 text-content-muted/30"
          animate={{ opacity: [0.1, 0.4, 0.1] }}
          transition={{ repeat: Infinity, duration: 6, ease: "easeInOut", delay: 1 }}
        >
          <IconGitBranch size={24} stroke={1.5} />
        </motion.div>

        <motion.div 
          className="absolute top-[420px] left-1/2 ml-[300px] -translate-x-1/2 -translate-y-1/2 text-content-muted/30"
          animate={{ opacity: [0.1, 0.4, 0.1] }}
          transition={{ repeat: Infinity, duration: 6, ease: "easeInOut", delay: 3 }}
        >
          <IconShieldCheck size={24} stroke={1.5} />
        </motion.div>
        
        {/* === BOTTOM CORNERS (X: ±480, Y: 480) === */}
        <motion.div 
          className="absolute top-[480px] left-1/2 -ml-[480px] -translate-x-1/2 -translate-y-1/2"
          animate={{ scale: [1, 1.6, 1], opacity: [0.4, 1, 0.4] }}
          transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut", delay: 0.5 }}
        >
          <div className="w-2.5 h-2.5 bg-accent-primary rounded-full shadow-[0_0_12px_rgba(0,212,255,1)]" />
        </motion.div>

        <motion.div 
          className="absolute top-[480px] left-1/2 ml-[480px] -translate-x-1/2 -translate-y-1/2"
          animate={{ scale: [1, 1.6, 1], opacity: [0.4, 1, 0.4] }}
          transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut", delay: 2 }}
        >
          <div className="w-2.5 h-2.5 bg-accent-primary rounded-full shadow-[0_0_12px_rgba(0,212,255,1)]" />
        </motion.div>
      </div>
    </div>
  );
}
