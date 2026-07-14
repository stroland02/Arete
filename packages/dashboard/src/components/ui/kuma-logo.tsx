"use client";

import React from 'react';
import { motion } from 'framer-motion';

export function KumaLogo({ 
  className = "", 
  size = 24,
  isLoading = false 
}: { 
  className?: string; 
  size?: number;
  isLoading?: boolean;
}) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      animate={{
        rotate: isLoading ? -360 : 0
      }}
      transition={{
        rotate: {
          repeat: isLoading ? Infinity : 0,
          duration: 2,
          ease: "linear"
        }
      }}
    >
      {/* Outer Hexagon */}
      <path d="M50 10 L85 30 L85 70 L50 90 L15 70 L15 30 Z" />
      {/* 3D Cube Edges */}
      <path d="M15 30 L50 50 L85 30" />
      <path d="M50 90 L50 50" />
      
      {/* Inner Tech Core (Pulsing Lantern Glow) */}
      <motion.path 
        d="M35 42 L50 33 L65 42 L65 58 L50 67 L35 58 Z" 
        strokeWidth="4" 
        animate={{ 
          opacity: isLoading ? [0.6, 1, 0.6] : [0.3, 0.8, 0.3],
          filter: isLoading 
            ? [
                "drop-shadow(0px 0px 10px currentColor)",
                "drop-shadow(0px 0px 25px currentColor)",
                "drop-shadow(0px 0px 10px currentColor)"
              ]
            : [
                "drop-shadow(0px 0px 4px currentColor)",
                "drop-shadow(0px 0px 14px currentColor)",
                "drop-shadow(0px 0px 4px currentColor)"
              ]
        }}
        transition={{ repeat: Infinity, duration: isLoading ? 1.5 : 3, ease: "easeInOut" }}
      />
      
      {/* Glowing Center Dot */}
      <motion.circle 
        cx="50" cy="50" 
        fill="currentColor" 
        animate={{ 
          opacity: isLoading ? [0.8, 1, 0.8] : [0.5, 1, 0.5],
          r: isLoading ? [4, 7, 4] : [4, 5, 4],
          filter: isLoading 
            ? [
                "drop-shadow(0px 0px 10px currentColor)",
                "drop-shadow(0px 0px 25px currentColor)",
                "drop-shadow(0px 0px 10px currentColor)"
              ]
            : [
                "drop-shadow(0px 0px 4px currentColor)",
                "drop-shadow(0px 0px 14px currentColor)",
                "drop-shadow(0px 0px 4px currentColor)"
              ]
        }}
        transition={{ repeat: Infinity, duration: isLoading ? 1.5 : 3, ease: "easeInOut" }}
      />
    </motion.svg>
  );
}
