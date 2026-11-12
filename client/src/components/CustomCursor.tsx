import React, { useEffect, useState, useRef } from 'react';
import { useReducedMotion } from '../utils/motion';

/**
 * Custom interactive cursor follower for the SafeAgent dashboard.
 * Features:
 * - Fluid dual-element follower (central dot + trailing ring with lerp interpolation)
 * - Expands smoothly over interactive elements (buttons, inputs, cards, sliders)
 * - Click contraction micro-interaction
 * - Respects prefers-reduced-motion and touch device detection
 * - Zero interference with interactions (pointer-events-none)
 */
export const CustomCursor: React.FC = () => {
  const shouldReduceMotion = useReducedMotion();
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const [isClicking, setIsClicking] = useState<boolean>(false);

  // Use refs for direct 60fps transform updates without React re-render lag
  const mousePos = useRef({ x: -100, y: -100 });
  const ringPos = useRef({ x: -100, y: -100 });
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const animFrameId = useRef<number | null>(null);

  useEffect(() => {
    // Disable if user requested reduced motion or on touch-only devices
    if (shouldReduceMotion) return;
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
      if (!isVisible) setIsVisible(true);

      // Fast sync for inner dot
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX - 4}px, ${e.clientY - 4}px, 0)`;
      }

      // Check if hovering over an interactive element
      const target = e.target as HTMLElement | null;
      if (target) {
        const isInteractive = Boolean(
          target.closest('button, a, input, select, textarea, [role="button"], .cursor-pointer, .fintech-card, .btn-primary, .btn-secondary, .card-lift')
        );
        setIsHovering(isInteractive);
      }
    };

    const handleMouseDown = () => setIsClicking(true);
    const handleMouseUp = () => setIsClicking(false);
    const handleMouseLeave = () => setIsVisible(false);
    const handleMouseEnter = () => setIsVisible(true);

    // Smooth lerp loop for outer ring
    const render = () => {
      // Lerp smoothing (linear interpolation factor 0.18)
      ringPos.current.x += (mousePos.current.x - ringPos.current.x) * 0.18;
      ringPos.current.y += (mousePos.current.y - ringPos.current.y) * 0.18;

      if (ringRef.current) {
        const size = isHovering ? 42 : 26;
        const offset = size / 2;
        ringRef.current.style.transform = `translate3d(${ringPos.current.x - offset}px, ${ringPos.current.y - offset}px, 0) scale(${isClicking ? 0.85 : isHovering ? 1.25 : 1})`;
      }

      animFrameId.current = requestAnimationFrame(render);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('mouseenter', handleMouseEnter);

    animFrameId.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('mouseenter', handleMouseEnter);
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
    };
  }, [isVisible, isHovering, isClicking, shouldReduceMotion]);

  if (shouldReduceMotion || !isVisible) return null;

  return (
    <>
      {/* Precision inner dot */}
      <div
        ref={dotRef}
        className="fixed top-0 left-0 w-2 h-2 rounded-full bg-accent pointer-events-none z-[9999] transition-opacity duration-200 will-change-transform"
        style={{ opacity: isVisible ? 1 : 0 }}
      />

      {/* Lagging outer halo ring */}
      <div
        ref={ringRef}
        className={`fixed top-0 left-0 rounded-full pointer-events-none z-[9998] transition-all duration-150 ease-out will-change-transform ${
          isHovering
            ? 'w-10 h-10 border-2 border-accent/70 bg-accent/15 shadow-2xs'
            : 'w-6.5 h-6.5 border border-accent/40 bg-accent/5'
        }`}
        style={{ opacity: isVisible ? 1 : 0 }}
      />
    </>
  );
};
