"use client";

import { motion } from "framer-motion";

export function AnimatedDiagonalLines() {
  return (
    <div className="absolute inset-0 -z-10 h-full w-full overflow-hidden [mask-image:radial-gradient(ellipse_60%_60%_at_50%_0%,#000_70%,transparent_100%)]">
      <motion.div
        // We only need to translate X by the exact width of the pattern tile (40px)
        // to create a mathematically flawless infinite loop!
        animate={{ x: [0, -40] }}
        transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
        className="absolute inset-y-0 left-[-20%] h-full w-[140%]"
      >
        <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="diagonal-lines" width="40" height="40" patternUnits="userSpaceOnUse">
              {/* Three lines to ensure seamless tiling at the corners of the 40x40 box */}
              <path 
                d="M-10,10 l20,-20 M0,40 l40,-40 M30,50 l20,-20" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                className="text-content-muted/20 dark:text-content-muted/10" 
                fill="none" 
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#diagonal-lines)" />
        </svg>
      </motion.div>
    </div>
  );
}
