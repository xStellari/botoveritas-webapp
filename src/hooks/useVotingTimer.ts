import { useEffect, useState } from "react";

type Params = {
  currentStep: string;
};

/**
 * useVotingTimer
 * - Keeps the kiosk countdown behavior identical to the previous inline implementation.
 * - Starts with a total duration (ms) when requested.
 * - Counts down every second, but stops ticking during "submitting" and "complete".
 * - When <= 1s remains, it shows the timeout modal and does NOT force the timer to 0:00.
 */
export function useVotingTimer({ currentStep }: Params) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);

  const startTimerIfNeeded = (totalMs: number) => {
    if (timeLeft !== null) return;
    setTimeLeft(totalMs);
  };

  const resetTimer = () => {
    setTimeLeft(null);
    setShowTimeoutModal(false);
  };

  useEffect(() => {
    if (timeLeft === null) return;
    if (currentStep === "submitting" || currentStep === "complete") return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null) return null;

        if (prev <= 1000) {
          clearInterval(interval);
          if (!showTimeoutModal) setShowTimeoutModal(true);
          return prev; // keep last non-zero value (prevents showing 0:00)
        }

        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, currentStep, showTimeoutModal]);

  return {
    timeLeft,
    showTimeoutModal,
    setShowTimeoutModal,
    startTimerIfNeeded,
    setTimeLeft,
    resetTimer,
  };
}
