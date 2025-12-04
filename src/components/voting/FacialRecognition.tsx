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
  const [countdown, setCountdown] = useState<number | null>(null);

  const [faceDetected, setFaceDetected] = useState(false);

  // v2.5 extras
  const [brightness, setBrightness] = useState<number | null>(null);
  const [tilt, setTilt] = useState<number | null>(null);

  // NEW: face outline box (scaled to display)
  const [faceBox, setFaceBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // -------------------------------------------------------
  // Load Models
  // -------------------------------------------------------
  useEffect(() => {
    const load = async () => {
      try {
        const MODEL_URL = "/models";

        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);

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
            width: { ideal: 640, max:720 }, 
            height: { ideal: 480, max:480 }},
        });

        if (videoRef.current) videoRef.current.srcObject = stream;
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

    let stopped = false;

    const loop = async () => {
      if (stopped) return;

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

      try {
        const result = await faceapi
          .detectSingleFace(
            video,
            new faceapi.TinyFaceDetectorOptions({
              inputSize: 320,
              scoreThreshold: 0.5,
            })
          )
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (result) {
          const { box } = result.detection;
          const landmarks = result.landmarks;

          // 🌟 NEW: SCALE FACE OUTLINE TO DISPLAY
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

          // v2.5 brightness
          setBrightness(getVideoBrightness(video));

          // v2.5 tilt
          const leftEye = landmarks.getLeftEye();
          const rightEye = landmarks.getRightEye();
          const tiltAmount = Math.abs(leftEye[0].y - rightEye[0].y);
          setTilt(tiltAmount);

          if (!faceDetected) setFaceDetected(true);

          if (countdown === null) {
            setCountdown(3);
            setStatus("Face detected — hold still… capturing in 3");
          }
        } else {
          if (faceDetected) setFaceDetected(false);

          setFaceBox(null);

          if (countdown !== null && countdown > 0) {
            setCountdown(null);
          }

          setStatus("No face detected");
        }
      } catch (err) {
        console.error("Detection error:", err);
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
    return () => {
      stopped = true;
    };
  }, [modelsReady, countdown, autoCapture, faceDetected]);

  // -------------------------------------------------------
  // Countdown (unchanged)
  // -------------------------------------------------------
  useEffect(() => {
    if (countdown === null) return;

    if (countdown === 0) {
      setStatus("Capturing…");

      const video = videoRef.current;
      if (video) {
        faceapi
          .detectSingleFace(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 320 })
          )
          .withFaceLandmarks()
          .withFaceDescriptor()
          .then((finalDet) => {
            if (finalDet) {
              onCapture(finalDet.descriptor);
            }
          });
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
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return 1;

    canvas.width = 32;
    canvas.height = 32;
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
