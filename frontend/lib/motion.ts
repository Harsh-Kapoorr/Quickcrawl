/** Shared Framer Motion variants used across the app. */

export const spring = {
  type: "spring" as const,
  stiffness: 300,
  damping: 25,
};

export const springSoft = {
  type: "spring" as const,
  stiffness: 200,
  damping: 20,
};

/** Page-level fade + y-translate entrance */
export const pageEnter = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] as const },
};

/** Stagger children entrance */
export const stagger = (delay = 0.05) => ({
  initial: "hidden",
  animate: "visible",
  variants: {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: delay,
        delayChildren: 0.05,
      },
    },
  },
});

export const staggerItem = {
  variants: {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  },
};

/** Card hover — lift + shadow */
export const cardHover = {
  whileHover: { y: -2 },
  transition: { type: "spring" as const, stiffness: 400, damping: 25 },
};
