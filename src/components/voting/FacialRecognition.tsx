// FacialRecognition.tsx — Premium v2.5 with Live Face Outline Added
// Only adds: properly scaled face outline.
// Everything else (tilt, brightness, premium UI) remains unchanged.

// @ts-ignore
import * as faceapi from "face-api.js/dist/face-api.js";

import React, { useEffect, useRef, useState } from "react";

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

  // Avoid rerender storms from rapid status updates
  const statusRef = useRef<string>("Preparing camera…");
  const setStatusIfChanged = (next: string) => {
    if (statusRef.current !== next) {
      statusRef.current = next;
      setStatus(next);
    }
  };

  const [faceDetected, setFaceDetected] = useState(false);

  // v2.5 extras
  const [brightness, setBrightness] = useState<number | null>(null);
  const [tilt, setTilt] = useState<number | null>(null);

  // NEW: face outline box (scaled to display)
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const faceBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // -------------------------------------------------------
  // Perf constants (tuneable)
  // -------------------------------------------------------
  // How often we run the heavy face-api pipeline while auto-capturing.
  // ~6–8 fps is usually plenty for kiosk UX.
  const DETECT_INTERVAL_MS = 140;
  // Run brightness + tilt checks less frequently (they are expensive).
  const QUALITY_INTERVAL_MS = 600;
  // Smaller input sizes are significantly faster; 224 is a good balance.
  const DETECTOR_INPUT_SIZE = 160;
  // Safe-tier kiosk optimizations:
  // Use a downscaled offscreen canvas for detection to reduce CPU load on low-end kiosks.
  // Set to false if your lighting/camera makes detection less reliable at lower resolution.
  const DETECT_DOWNSCALE_ENABLED = true;
  const DETECT_CANVAS_W = 320;
  const DETECT_CANVAS_H = 240;
  // If no face is detected for a while, occasionally try full-res to recover without complicated adaptive modes.
  const FULL_RES_RECOVERY_MS = 1500;

  // -------------------------------------------------------
  // Refs to avoid re-creating the detection loop on every state change
  // -------------------------------------------------------
  const stoppedRef = useRef(false);
  const inFlightRef = useRef(false);
  const lastDetectAtRef = useRef(0);
  const lastQualityAtRef = useRef(0);
  const faceDetectedRef = useRef(false);
  const countdownRef = useRef<number | null>(null);
  const brightnessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brightnessCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const cameraStartedRef = useRef(false);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const lastFullResAttemptAtRef = useRef(0);
  const lastNoFaceAtRef = useRef<number | null>(null);
  const faceVideoBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  // Keep refs in sync with state (state drives UI; refs drive the loop)
  useEffect(() => {
    faceDetectedRef.current = faceDetected;
  }, [faceDetected]);

  useEffect(() => {
    countdownRef.current = countdown;
  }, [countdown]);

  // -------------------------------------------------------
  // Recognition net loader (lazy)
  // -------------------------------------------------------
  const ensureRecognitionNetLoaded = async (): Promise<void> => {
    if (recognitionReady || faceapi.nets.faceRecognitionNet.isLoaded) {
      if (!recognitionReady) setRecognitionReady(true);
      return;
    }

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
    // Cache model loading across mounts so we don't re-download/re-init.
    // This materially improves "boot" time when navigating between screens.
    let modelsLoadPromise: Promise<void> | null = (window as any).__faceModelsLoadPromise ?? null;

    const load = async () => {
      try {
        const MODEL_URL = `${window.location.origin}/models`;

        if (!modelsLoadPromise) {
          modelsLoadPromise = Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
          ]).then(() => {
            console.log("TinyLandmark loaded:", faceapi.nets.faceLandmark68TinyNet.isLoaded);
            console.log("FullLandmark loaded:", faceapi.nets.faceLandmark68Net.isLoaded);
          });
          // Don’t block boot on the heavy recognition net; load it lazily on first capture.

          (window as any).__faceModelsLoadPromise = modelsLoadPromise;
        }

        await modelsLoadPromise;

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
  // Start webcam
  // -------------------------------------------------------
  useEffect(() => {
    if (cameraStartedRef.current) return;
    cameraStartedRef.current = true;

    const startCam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            // Kiosk perf: keep the camera feed modest; face-api downsamples anyway.
            width: { ideal: 640, max: 640 },
            height: { ideal: 480, max: 480 },
            frameRate: { ideal: 24, max: 24 },
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // Ensure playback starts ASAP.
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(() => {
              /* ignored */
            });
          };
          videoRef.current.oncanplay = () => {
            videoRef.current?.play().catch(() => {
              /* ignored */
            });
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
      if (videoRef.current?.srcObject instanceof MediaStream) {
        videoRef.current.srcObject.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      }
    };
  }, [onError]);

  // -------------------------------------------------------
  // Detection Loop (Premium v2.5 + face outline)
  // -------------------------------------------------------
  useEffect(() => {

    stoppedRef.current = false;
    inFlightRef.current = false;
    lastDetectAtRef.current = 0;
    lastQualityAtRef.current = 0;

    // Reuse a tiny canvas for brightness sampling (avoid creating one per frame)
    if (!brightnessCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      brightnessCanvasRef.current = c;
      brightnessCtxRef.current = c.getContext("2d");
    }

    const loop = async (ts: number) => {
      if (stoppedRef.current) return;

      const video = videoRef.current;
      const container = containerRef.current;

      if (!video || !container || video.readyState < 2) {
        requestAnimationFrame(loop);
        return;
      }

      if (!autoCapture) {
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
        // If it’s time to compute quality metrics, do landmarks (heavier) once.
        const runQuality = ts - lastQualityAtRef.current >= QUALITY_INTERVAL_MS;

        // Detection source selection (safe-tier):
        // - Default to a downscaled offscreen canvas for speed on low-end kiosks.
        // - If we haven't seen a face for a while, occasionally try full-res to recover.
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;

        const noFaceSince = lastNoFaceAtRef.current;
        const shouldTryFullResRecovery =
          DETECT_DOWNSCALE_ENABLED &&
          !faceDetectedRef.current &&
          noFaceSince !== null &&
          ts - noFaceSince >= FULL_RES_RECOVERY_MS &&
          ts - lastFullResAttemptAtRef.current >= FULL_RES_RECOVERY_MS;

        const useDownscaledDetection = DETECT_DOWNSCALE_ENABLED && !shouldTryFullResRecovery;

        let detectEl: HTMLVideoElement | HTMLCanvasElement = video;
        let scaleX = 1;
        let scaleY = 1;

        if (useDownscaledDetection) {
          if (!detectCanvasRef.current) {
            const c = document.createElement("canvas");
            c.width = DETECT_CANVAS_W;
            c.height = DETECT_CANVAS_H;
            detectCanvasRef.current = c;
            detectCtxRef.current = c.getContext("2d", { willReadFrequently: false });
          }

          const ctx = detectCtxRef.current;
          if (ctx) {
            ctx.drawImage(video, 0, 0, DETECT_CANVAS_W, DETECT_CANVAS_H);
            detectEl = detectCanvasRef.current as HTMLCanvasElement;
            scaleX = videoWidth / DETECT_CANVAS_W;
            scaleY = videoHeight / DETECT_CANVAS_H;
          }
        } else if (shouldTryFullResRecovery) {
          lastFullResAttemptAtRef.current = ts;
        }

        const det = runQuality
          ? await faceapi
              .detectSingleFace(
                detectEl,
                new faceapi.TinyFaceDetectorOptions({
                  inputSize: DETECTOR_INPUT_SIZE,
                  scoreThreshold: 0.55,
                })
              )
              .withFaceLandmarks(true)
          : await faceapi.detectSingleFace(
              detectEl,
              new faceapi.TinyFaceDetectorOptions({
                inputSize: DETECTOR_INPUT_SIZE,
                scoreThreshold: 0.55,
              })
            );

        if (det) {
          const boxRaw = "detection" in det ? det.detection.box : det.box;
          const box = {
            x: boxRaw.x * scaleX,
            y: boxRaw.y * scaleY,
            width: boxRaw.width * scaleX,
            height: boxRaw.height * scaleY,
          };
          faceVideoBoxRef.current = { x: box.x, y: box.y, w: box.width, h: box.height };

          // 🌟 SCALE FACE OUTLINE TO DISPLAY (accounts for object-cover crop)

          const displayWidth = container.clientWidth;
          const displayHeight = container.clientHeight;

          // object-cover scales video to fully cover the container, potentially cropping.
          const scale = Math.max(displayWidth / videoWidth, displayHeight / videoHeight);
          const renderedW = videoWidth * scale;
          const renderedH = videoHeight * scale;
          const offsetX = (displayWidth - renderedW) / 2;
          const offsetY = (displayHeight - renderedH) / 2;

          const nextFaceBox = {
            x: box.x * scale + offsetX,
            y: box.y * scale + offsetY,
            w: box.width * scale,
            h: box.height * scale,
          };

          // Avoid state churn if the box hasn't meaningfully moved.
          const prev = faceBoxRef.current;
          const moved =
            !prev ||
            Math.abs(prev.x - nextFaceBox.x) > 1 ||
            Math.abs(prev.y - nextFaceBox.y) > 1 ||
            Math.abs(prev.w - nextFaceBox.w) > 1 ||
            Math.abs(prev.h - nextFaceBox.h) > 1;

          if (moved) {
            faceBoxRef.current = nextFaceBox;
            setFaceBox(nextFaceBox);
          }
if (!faceDetectedRef.current) setFaceDetected(true);
          lastNoFaceAtRef.current = null;

          if (runQuality) {
            lastQualityAtRef.current = ts;

            // brightness (cheap, uses reused 32x32 canvas)
            setBrightness(getVideoBrightness(video, faceVideoBoxRef.current));

            // tilt (needs landmarks)
            if ("landmarks" in det) {
              const leftEye = det.landmarks.getLeftEye();
              const rightEye = det.landmarks.getRightEye();
              const tiltAmount = Math.abs(leftEye[0].y - rightEye[0].y);
              setTilt(tiltAmount);
            }
          }

          if (countdownRef.current === null) {
            setCountdown(3);
            setStatusIfChanged("Face detected — hold still… capturing in 3");
          }
        } else {
          faceVideoBoxRef.current = null;
          if (lastNoFaceAtRef.current === null) lastNoFaceAtRef.current = ts;
          if (faceDetectedRef.current) setFaceDetected(false);

          faceBoxRef.current = null;
          setFaceBox(null);

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
  // Countdown (unchanged)
  // -------------------------------------------------------
  useEffect(() => {
    if (countdown === null) return;

    if (countdown === 0) {
      setStatusIfChanged("Capturing…");

      const video = videoRef.current;
      if (video) {
        (async () => {
          try {
            // Lazy-load the heavy recognition net right before we need descriptors.
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
  // Brightness Helper
  // -------------------------------------------------------
  function getVideoBrightness(
    video: HTMLVideoElement,
    roi?: { x: number; y: number; w: number; h: number } | null
  ): number {
    const ctx = brightnessCtxRef.current;
    if (!ctx) return 1;

    // 32x32 sampling canvas is reused via refs.
    // If we have a face ROI, sample brightness from that region for more accurate guidance.
    if (roi && video.videoWidth > 0 && video.videoHeight > 0) {
      const pad = 0.15; // sample slightly beyond the box to include cheeks/forehead
      const x0 = Math.max(0, roi.x - roi.w * pad);
      const y0 = Math.max(0, roi.y - roi.h * pad);
      const x1 = Math.min(video.videoWidth, roi.x + roi.w * (1 + pad));
      const y1 = Math.min(video.videoHeight, roi.y + roi.h * (1 + pad));
      const w = Math.max(1, x1 - x0);
      const h = Math.max(1, y1 - y0);
      ctx.drawImage(video, x0, y0, w, h, 0, 0, 32, 32);
    } else {
      ctx.drawImage(video, 0, 0, 32, 32);
    }

    const data = ctx.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i] + data[i + 1] + data[i + 2];
    }
    return sum / (32 * 32 * 3);
  }

  // -------------------------------------------------------
  // Guidance
  // -------------------------------------------------------
  // Safe-tier guidance priority:
  // 1) Countdown/status (when actively capturing)
  // 2) Face presence
  // 3) Lighting guidance (ROI-based brightness)
  // 4) Tilt is advisory only (never blocks capture and never overrides lighting)
  let guidance = "Center your face inside the frame";

  if (countdown !== null) {
    guidance = status;
  } else if (!faceDetected) {
    guidance = "No face detected";
  } else if (brightness !== null && brightness < 60) {
    guidance = "Too dark — adjust lighting";
  } else if (brightness !== null && brightness > 200) {
    guidance = "Too bright — avoid direct light";
  } else if (tilt !== null && tilt > 12) {
    guidance = "Keep your head level";
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

        {/* GLOW FRAME (same Premium v2) */}
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

        {/* 🌟 NEW: LIVE FACE OUTLINE */}
        {faceBox && (
          <div
            className="absolute border-2 border-emerald-300 rounded-xl pointer-events-none transition-all duration-75"
            style={{
              left: faceBox.x,
              top: faceBox.y,
              width: faceBox.w,
              height: faceBox.h,
            }}
          ></div>
        )}

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