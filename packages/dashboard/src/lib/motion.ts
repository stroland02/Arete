export const motionDuration = {
  micro: 0.15,
  standard: 0.3,
  emphasis: 0.6,
} as const;

export const springTransition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
} as const;

export const staggerContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.08,
    },
  },
} as const;

export const fadeSlideUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: motionDuration.standard } },
} as const;
