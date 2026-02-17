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

  const [faceDetected, setFaceDetected] = useState(false);

  // v2.5 extras
  const [brightness, setBrightness] = useState<number | null>(null);
  const [tilt, setTilt] = useState<number | null>(null);

  // NEW: face outline box (scaled to display)
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

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
    if (recognitionReady) return;

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

          // Don’t block "boot" on the heavy recognition net; load it lazily on first capture.
          // (We also warm it up in the background if bandwidth/CPU allows.)
          ensureRecognitionNetLoaded().catch(() => {
            /* ignore warm-up failures; capture will retry */
          });

          (window as any).__faceModelsLoadPromise = modelsLoadPromise;
        }

        await modelsLoadPromise;

        setModelsReady(true);
        setStatus("Starting camera…");
      } catch (err) {
        console.error("Model load error:", err);
        onError?.("Failed to load face recognition models.");
        setStatus("Model loading failed.");
      }
    };

    load();
  }, [onError]);

  // -------------------------------------------------------
  // Start webcam
  // -------------------------------------------------------
  useEffect(() => {
    if (!modelsReady) return;

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
        }
        setStatus("Align your face inside the frame…");

      } catch (err) {
        onError?.("Unable to access webcam.");
        setStatus("Unable to access webcam.");
      }
    };

    startCam();

    return () => {
      if (videoRef.current?.srcObject instanceof MediaStream) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      }
    };
  }, [modelsReady, onError]);

  // -------------------------------------------------------
  // Detection Loop (Premium v2.5 + face outline)
  // -------------------------------------------------------
  useEffect(() => {
    if (!modelsReady) return;

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

        const det = runQuality
          ? await faceapi
              .detectSingleFace(
                video,
                new faceapi.TinyFaceDetectorOptions({
                  inputSize: DETECTOR_INPUT_SIZE,
                  scoreThreshold: 0.55,
                })
              )
              .withFaceLandmarks(true)
          : await faceapi.detectSingleFace(
              video,
              new faceapi.TinyFaceDetectorOptions({
                inputSize: DETECTOR_INPUT_SIZE,
                scoreThreshold: 0.55,
              })
            );
        
        if (det) {
          const box = "detection" in det ? det.detection.box : det.box;

          // 🌟 SCALE FACE OUTLINE TO DISPLAY
          const videoWidth = video.videoWidth;
          const videoHeight = video.videoHeight;

          const displayWidth = container.clientWidth;
          const displayHeight = container.clientHeight;

          const scaleX = displayWidth / videoWidth;
          const scaleY = displayHeight / videoHeight;

          setFaceBox({
            x: box.x * scaleX,
            y: box.y * scaleY,
            w: box.width * scaleX,
            h: box.height * scaleY,
          });

          if (!faceDetectedRef.current) setFaceDetected(true);

          if (runQuality) {
            lastQualityAtRef.current = ts;

            // brightness (cheap, uses reused 32x32 canvas)
            setBrightness(getVideoBrightness(video));

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
            setStatus("Face detected — hold still… capturing in 3");
          }
        } else {
          if (faceDetectedRef.current) setFaceDetected(false);

          setFaceBox(null);

          if (countdownRef.current !== null && (countdownRef.current ?? 0) > 0) {
            setCountdown(null);
          }

          setStatus("No face detected");
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
      setStatus("Capturing…");

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
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
      setStatus(`Hold still… capturing in ${countdown - 1}`);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, onCapture]);

  // -------------------------------------------------------
  // Brightness Helper
  // -------------------------------------------------------
  function getVideoBrightness(video: HTMLVideoElement): number {
    const ctx = brightnessCtxRef.current;
    if (!ctx) return 1;

    // 32x32 sampling canvas is reused via refs.
    ctx.drawImage(video, 0, 0, 32, 32);

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
  let guidance = "Center your face inside the frame";

  if (!faceDetected) guidance = "No face detected";

  if (brightness !== null) {
    if (brightness < 60) guidance = "Too dark — adjust lighting";
    else if (brightness > 200) guidance = "Too bright — avoid direct light";
  }

  if (tilt !== null && tilt > 12) guidance = "Keep your head level";

  if (countdown !== null) guidance = status;

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
