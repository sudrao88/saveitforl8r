import { useState, useEffect, useCallback } from 'react';
import { Memory } from '../types';
import { logEvent } from '../services/analytics';
import { STORAGE_KEYS, ANALYTICS_EVENTS } from '../constants';

interface UseOnboardingProps {
  memories: Memory[];
}

interface UseOnboardingReturn {
  isShareOnboardingOpen: boolean;
  closeOnboarding: () => void;
}

export const useOnboarding = ({ memories }: UseOnboardingProps): UseOnboardingReturn => {
  const [isShareOnboardingOpen, setIsShareOnboardingOpen] = useState(false);

  useEffect(() => {
    const hasSeenOnboarding = localStorage.getItem(STORAGE_KEYS.HAS_SEEN_SHARE_ONBOARDING);
    // Modern mobile detection
    const isMobile = window.matchMedia('(max-width: 768px)').matches || ('ontouchstart' in window);
    
    // Logic: If mobile, has memories, and hasn't seen onboarding yet
    if (isMobile && memories.length > 0 && !hasSeenOnboarding) {
        // We only show it once a memory is successfully enriched/created to not block initial usage
        // Let's check if any memory has enrichment data
        const hasEnrichedMemory = memories.some(m => m.enrichment);
        if (hasEnrichedMemory) {
            setIsShareOnboardingOpen(true);
        }
    }
  }, [memories]);

  const closeOnboarding = useCallback(() => {
    setIsShareOnboardingOpen(false);
    localStorage.setItem(STORAGE_KEYS.HAS_SEEN_SHARE_ONBOARDING, 'true');
    logEvent(ANALYTICS_EVENTS.ONBOARDING.CATEGORY, ANALYTICS_EVENTS.ONBOARDING.ACTION_DISMISSED);
  }, []);

  return {
    isShareOnboardingOpen,
    closeOnboarding
  };
};
