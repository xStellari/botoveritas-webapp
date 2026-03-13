// FacialRecognition.tsx — Optimized for kiosk cold-start performance
//
// Key changes vs previous version:
//
// 1. CLAIM WARM STREAM: On mount, we first try claimWarmStream() from
//    cameraWarmup.ts. If a pre-acquired stream is available, we attach it
//    directly to the <video> element — no getUserMedia call, no OS delay.
//    Only falls back to getUserMedia if warmup didn't run or stream expired.
//
// 2. MODELS FIRST, LOOP SECOND: The detection loop now only starts after
//    modelsReady is true. Previously requestAnimationFrame was spinning
//    immediately even before models were loaded, causing a jank burst.
//
// 3. SKIP REDUNDANT MODEL LOAD: We check the same window-level promise cache
//    set by cameraWarmup so we never double-load. If warmup already finished
//    loading, setModelsReady(true) fires synchronously — no await needed.

// @ts-ignore
import * as faceapi from "face-api.js/dist/face-api.js";

import React, { useEffect, useRef, useState } from "react";
import { claimWarmStream } from "@/utils/cameraWarmup";

interface FacialRecognitionProps {
  onCapture: (descriptor: Float32Array) => void;
  onError?: (msg: string) => void;
  autoCapture?: boolean;
}

const FacialRecognition: React.FC<FacialRecognitionProps> = ({
  onCapture,
  onError,
  autoCapture = true,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [status, setStatus] = useState("Preparing camera…");
  const [modelsReady, setModelsReady] = useState(false);
  const [recognitionReady, setRecognitionReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);

  // Avoid rerender storms from rapid status updates
  const statusRef = useRef<string>("Preparing camera…");
  const setStatusIfChanged = (next: string) => {
    if (statusRef.current !== next) {
      statusRef.current = next;
      setStatus(next);
    }
  };

  // -------------------------------------------------------
  // Perf constants (tuneable)
  // -------------------------------------------------------
  const DETECT_INTERVAL_MS = 180; // ~5-6 fps
  const DETECTOR_INPUT_SIZE = 160;

  // -------------------------------------------------------
  // Refs to avoid re-creating the detection loop on every state change
  // -------------------------------------------------------
  const stoppedRef = useRef(false);
  const inFlightRef = useRef(false);
  const lastDetectAtRef = useRef(0);
  const faceDetectedRef = useRef(false);
  const countdownRef = useRef<number | null>(null);
  const cameraStartedRef = useRef(false);

  // Keep refs in sync with state (state drives UI; refs drive the loop)
  useEffect(() => {
    faceDetectedRef.current = faceDetected;
  }, [faceDetected]);

  useEffect(() => {
    countdownRef.current = countdown;
  }, [countdown]);

  // -------------------------------------------------------
  // Recognition net loader (lazy — called right before capture)
  // -------------------------------------------------------
  const ensureRecognitionNetLoaded = async (): Promise<void> => {
    if (recognitionReady || faceapi.nets.faceRecognitionNet.isLoaded) {
      if (!recognitionReady) setRecognitionReady(true);
      return;
    }

    // Re-use the promise started by warmupCamera (may already be resolved).
    let p: Promise<void> | null = (window as any).__faceRecognitionLoadPromise ?? null;
    if (!p) {
      const MODEL_URL = `${window.location.origin}/models`;
      p = faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL).then(() => undefined);
      (window as any).__faceRecognitionLoadPromise = p;
    }

    await p;
    setRecognitionReady(true);
  };

  // -------------------------------------------------------
  // Load Models
  // -------------------------------------------------------
  useEffect(() => {
    const load = async () => {
      try {
        const MODEL_URL = `${window.location.origin}/models`;
        const w = window as any;

        // If warmupCamera already started (or finished) loading, reuse its promise.
        // This avoids re-parsing model weights that are already in memory.
        if (!w.__faceModelsLoadPromise) {
          w.__faceModelsLoadPromise = Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
          ]).then(() => undefined);
        }

        await w.__faceModelsLoadPromise;

        setModelsReady(true);
        setStatusIfChanged("Starting camera…");
      } catch (err) {
        console.error("Model load error:", err);
        onError?.("Failed to load face recognition models.");
        setStatusIfChanged("Model loading failed.");
      }
    };

    load();
  }, [onError]);

  // -------------------------------------------------------
  // Start webcam — claim warm stream first, fall back to getUserMedia
  // -------------------------------------------------------
  useEffect(() => {
    if (cameraStartedRef.current) return;
    cameraStartedRef.current = true;

    const startCam = async () => {
      try {
        // --- Fast path: reuse the stream held open by warmupCamera ---
        let stream = claimWarmStream();

        if (!stream) {
          // Warm stream wasn't available — acquire fresh (slower path).
          console.log("[FacialRecognition] No warm stream — calling getUserMedia.");
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: 640, max: 640 },
              height: { ideal: 480, max: 480 },
              frameRate: { ideal: 24, max: 24 },
            },
          });
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(() => { /* ignored */ });
          };
          videoRef.current.oncanplay = () => {
            videoRef.current?.play().catch(() => { /* ignored */ });
          };
        }

        setStatusIfChanged("Align your face inside the frame…");
      } catch (err) {
        onError?.("Unable to access webcam.");
        setStatusIfChanged("Unable to access webcam.");
      }
    };

    startCam();

    return () => {
      // Stop tracks on unmount so the camera indicator light turns off.
      if (videoRef.current?.srcObject instanceof MediaStream) {
        videoRef.current.srcObject.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      }
    };
  }, [onError]);

  // -------------------------------------------------------
  // Detection Loop — only starts after models are confirmed ready
  // -------------------------------------------------------
  useEffect(() => {
    // Guard: don't spin the loop until models are loaded.
    // Previously this was missing, causing rAF to churn before face-api was ready.
    if (!modelsReady) return;

    stoppedRef.current = false;
    inFlightRef.current = false;
    lastDetectAtRef.current = 0;

    const loop = async (ts: number) => {
      if (stoppedRef.current) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || !autoCapture) {
        requestAnimationFrame(loop);
        return;
      }

      // Throttle detection to reduce CPU usage and improve responsiveness.
      if (inFlightRef.current || ts - lastDetectAtRef.current < DETECT_INTERVAL_MS) {
        requestAnimationFrame(loop);
        return;
      }

      inFlightRef.current = true;
      lastDetectAtRef.current = ts;

      try {
        const det = await faceapi.detectSingleFace(
          video,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: DETECTOR_INPUT_SIZE,
            scoreThreshold: 0.55,
          })
        );

        if (det) {
          if (!faceDetectedRef.current) setFaceDetected(true);

          if (countdownRef.current === null) {
            setCountdown(3);
            setStatusIfChanged("Face detected — hold still… capturing in 3");
          }
        } else {
          if (faceDetectedRef.current) setFaceDetected(false);

          if (countdownRef.current !== null && (countdownRef.current ?? 0) > 0) {
            setCountdown(null);
          }

          setStatusIfChanged("No face detected");
        }
      } catch (err) {
        console.error("Detection error:", err);
      } finally {
        inFlightRef.current = false;
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
    return () => {
      stoppedRef.current = true;
    };
  }, [modelsReady, autoCapture]);

  // -------------------------------------------------------
  // Countdown
  // -------------------------------------------------------
  useEffect(() => {
    if (countdown === null) return;

    if (countdown === 0) {
      setStatusIfChanged("Capturing…");

      const video = videoRef.current;
      if (video) {
        (async () => {
          try {
            await ensureRecognitionNetLoaded();

            const finalDet = await faceapi
              .detectSingleFace(
                video,
                new faceapi.TinyFaceDetectorOptions({ inputSize: DETECTOR_INPUT_SIZE })
              )
              .withFaceLandmarks(true)
              .withFaceDescriptor();

            if (finalDet) {
              onCapture(finalDet.descriptor);
            }
          } catch (e) {
            console.error("Capture error:", e);
          }
        })();
      }
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev: number | null) => (prev !== null ? prev - 1 : null));
      setStatusIfChanged(`Hold still… capturing in ${countdown - 1}`);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, onCapture]);

  // -------------------------------------------------------
  // Guidance
  // -------------------------------------------------------
  let guidance = "Center your face inside the frame";

  if (countdown !== null) {
    guidance = status;
  } else if (!faceDetected) {
    guidance = "No face detected";
  }

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------
  return (
    <div className="flex flex-col items-center gap-3 w-full">

      {/* VIDEO + PREMIUM FRAME */}
      <div
        ref={containerRef}
        className="
          relative w-full max-w-md mx-auto rounded-3xl overflow-hidden
          backdrop-blur-md bg-white/10
          shadow-[0_8px_30px_rgba(0,0,0,0.12)]
        "
        style={{ aspectRatio: "4 / 3" }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="
            absolute inset-0 w-full h-full object-cover rounded-3xl
          "
        />

        {/* GLOW FRAME */}
        <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
          <div
            className={`
              w-[68%] h-[68%] rounded-full border-4
              transition-all duration-500
              ${faceDetected ? "border-emerald-400 shadow-[0_0_25px_rgba(16,185,129,0.6)]" : "border-white/40"}
            `}
          >
            {faceDetected && (
              <div className="absolute inset-0 rounded-full border-4 border-emerald-300 animate-ping"></div>
            )}
          </div>
        </div>

        {/* Countdown badge */}
        {countdown !== null && (
          <div className="absolute top-4 right-4 bg-emerald-600 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
            {countdown}
          </div>
        )}
      </div>

      {/* STATUS TEXT */}
      <p
        className={`
          text-sm font-medium text-center transition-all duration-300
          ${faceDetected ? "text-emerald-600" : "text-gray-600"}
        `}
      >
        {guidance}
      </p>
    </div>
  );
};

export default FacialRecognition;
