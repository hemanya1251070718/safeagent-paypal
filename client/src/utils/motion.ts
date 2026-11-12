import { useReducedMotion as useMotionReducedMotion, type Variants, type Transition } from 'motion/react';

/**
 * Standard cubic-bezier ease-out curve for calm, crisp fintech transitions.
 * Complies with the 150-300ms UI transition rule.
 */
export const defaultEase = [0.16, 1, 0.3, 1] as const;

export const defaultTransition: Transition = {
  duration: 0.24, // 240ms (strictly within 150-300ms limit)
  ease: [0.16, 1, 0.3, 1]
};

export const quickTransition: Transition = {
  duration: 0.18, // 180ms
  ease: [0.16, 1, 0.3, 1]
};

/**
 * Helper wrapper around motion/react's useReducedMotion hook.
 * Returns true if OS/browser requests reduced motion.
 */
export const useReducedMotion = (): boolean => {
  const shouldReduce = useMotionReducedMotion();
  return Boolean(shouldReduce);
};

/**
 * Shared fadeUp variant:
 * Subtle vertical slide (10px) with fade-in.
 */
export const fadeUpVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 10
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: defaultTransition
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: quickTransition
  }
};

/**
 * Shared scaleIn variant:
 * Subtle scale from 96% to 100% with fade-in.
 */
export const scaleInVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.96
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: defaultTransition
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    transition: quickTransition
  }
};

/**
 * Stagger container helper for sequential child entry.
 */
export const createStaggerContainer = (staggerChildren = 0.05, delayChildren = 0): Variants => ({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren,
      delayChildren
    }
  }
});

export const staggerContainerVariants: Variants = createStaggerContainer(0.05, 0.02);

/**
 * No-motion fallback variants for users with prefers-reduced-motion.
 * Performs instant or minimal opacity change without transform offsets.
 */
export const reducedMotionVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } }
};

/**
 * Selects either the animated variant or the reduced-motion fallback.
 */
export const getMotionVariants = (variants: Variants, shouldReduce: boolean): Variants => {
  return shouldReduce ? reducedMotionVariants : variants;
};
