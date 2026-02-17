import { useCallback, useEffect, useRef, useState } from "react";

type Params = {
  currentStep: string;
};

/**
 * useVotingTimer
 * - Starts with a total duration (ms) when requested.
 * - Counts down every second, but stops ticking during "submitting" and "complete".
 * - When <= 1s remains, it shows the timeout modal and does NOT force the timer to 0:00.
 */
export function useVotingTimer({ currentStep }: Params) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);

  const startedRef = useRef(false);
  const modalShownRef = useRef(false);

  const startTimerIfNeeded = useCallback((totalMs: number) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setTimeLeft(totalMs);
  }, []);

  const resetTimer = useCallback(() => {
    startedRef.current = false;
    modalShownRef.current = false;
    setTimeLeft(null);
    setShowTimeoutModal(false);
  }, []);

  useEffect(() => {
    if (timeLeft === null) return;
    if (currentStep === "submitting" || currentStep === "complete") return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null) return null;

        if (prev <= 1000) {
          clearInterval(interval);
          if (!modalShownRef.current) {
            modalShownRef.current = true;
            setShowTimeoutModal(true);
          }
          return prev; // keep last non-zero value (prevents showing 0:00)
        }

        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, currentStep]);

  return {
    timeLeft,
    showTimeoutModal,
    setShowTimeoutModal,
    startTimerIfNeeded,
    setTimeLeft,
    resetTimer,
  };
}
