import React from 'react';
import { useAnimatedUnmount } from '../hooks/useAnimatedUnmount';

interface AnimatedPresenceProps {
  /** Whether the content should be visible */
  isOpen: boolean;
  /** CSS classes applied during enter/idle phase */
  enterClassName: string;
  /** CSS classes applied during exit phase */
  exitClassName: string;
  /** Exit animation duration in ms (default 250) */
  duration?: number;
  /** Structural classes for the wrapper div (z-index, positioning, etc.) */
  className?: string;
  children: React.ReactNode;
}

/**
 * Wrapper that enables enter/exit animations for conditionally rendered content.
 * Delays unmounting until the exit animation completes.
 */
const AnimatedPresence: React.FC<AnimatedPresenceProps> = ({
  isOpen,
  enterClassName,
  exitClassName,
  duration = 250,
  className,
  children,
}) => {
  const { mounted, phase } = useAnimatedUnmount(isOpen, duration);

  if (!mounted) return null;

  const animationClass = phase === 'exit' ? exitClassName : enterClassName;

  return (
    <div className={className ? `${className} ${animationClass}` : animationClass}>
      {children}
    </div>
  );
};

export default AnimatedPresence;
