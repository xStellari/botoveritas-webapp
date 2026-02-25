import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Attract mode (idle slideshow)
 * - Tap anywhere to return to Home ("/")
 * - Keep visuals lightweight (kiosk runs for hours)
 */

type Slide = {
  kicker: string;
  title: string;
  body: string;
};

const SLIDE_INTERVAL_MS = 8000;

export default function Attract() {
  const navigate = useNavigate();

  const slides: Slide[] = useMemo(
    () => [
      {
        kicker: "BotoVeritas Voting Kiosk",
        title: "Tap anywhere to start",
        body: "Follow the on-screen steps to verify and cast your vote.",
      },
      {
        kicker: "Before you begin",
        title: "Prepare your ID",
        body: "Keep your official FEUA ID ready for quick verification.",
      },
      {
        kicker: "Verification",
        title: "Look at the camera",
        body: "When prompted, face the camera and stay still for a moment.",
      },
      {
        kicker: "Voting",
        title: "Review, then submit",
        body: "Double-check your selections before confirming your vote.",
      },
    ],
    []
  );

  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => {
      setIndex((i) => (i + 1) % slides.length);
    }, SLIDE_INTERVAL_MS);

    return () => window.clearInterval(t);
  }, [slides.length]);

  const onExit = () => {
    // Always return to a clean start route.
    navigate("/", { replace: true });
  };

  const slide = slides[index];

  return (
    <div
      className="min-h-screen w-full bg-neutral-950 text-neutral-100 flex items-center justify-center p-8 select-none"
      style={{
        backgroundImage:
          "radial-gradient(1200px circle at 50% 20%, rgba(255,255,255,0.06), transparent 55%), radial-gradient(900px circle at 15% 85%, rgba(255,255,255,0.04), transparent 60%)",
      }}
      role="button"
      tabIndex={0}
      onPointerDown={onExit}
      onKeyDown={(e) => {
        // Not used on the touchscreen kiosk, but keeps accessibility sane in dev.
        if (e.key === "Enter" || e.key === " ") onExit();
      }}
      aria-label="Attract mode. Tap anywhere to start."
    >
      <div className="w-full max-w-3xl">
        <div
          key={index}
          className="text-center space-y-6 transition-opacity duration-500"
        >
          <div className="mx-auto w-fit text-center">
            <div className="text-xs tracking-[0.22em] uppercase text-neutral-300/80">
              {slide.kicker}
            </div>
            <div className="mt-3 h-px w-40 mx-auto bg-gradient-to-r from-transparent via-neutral-200/40 to-transparent" />
          </div>

          <div className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-neutral-200/90 shadow-[0_0_30px_rgba(255,255,255,0.06)] backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-neutral-100/70" />
            <span>Tap anywhere to begin</span>
          </div>
<div className="text-5xl sm:text-6xl font-semibold tracking-tight leading-tight">
            {slide.title}
          </div>

          <div className="text-lg sm:text-xl text-neutral-300 max-w-2xl mx-auto">
            {slide.body}
          </div>

          <div className="pt-10 flex items-center justify-center gap-2" aria-hidden>
            {slides.map((_, i) => (
              <span
                key={i}
                className={
                  i === index
                    ? "h-2.5 w-2.5 rounded-full bg-neutral-100/70"
                    : "h-2.5 w-2.5 rounded-full bg-neutral-100/20"
                }
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}