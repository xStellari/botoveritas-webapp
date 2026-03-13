// src/utils/cameraWarmup.ts
//
// Strategy: preload face-api models AND acquire (but keep alive) the camera
// stream so FacialRecognition can reuse it immediately, eliminating the cold-
// start freeze on first launch.
//
// Why keeping the stream alive matters:
//   - Opening a camera stream cold takes 300–1200 ms on low-end hardware.
//   - If we open + immediately stop (old behaviour), the OS releases the device
//     and FacialRecognition has to re-acquire it from scratch -> same freeze.
//   - Holding the stream open means FacialRecognition just clones the tracks
//     and starts playing instantly.
//
// Model preloading:
//   - face-api.js parses and wires up TensorFlow.js kernels the first time a
//     net is loaded. On an AMD Athlon 3000G this takes ~1-3 s per model.
//   - We piggy-back on the same window-level promise cache used inside
//     FacialRecognition so the work is never repeated.

// @ts-ignore
import * as faceapi from "face-api.js/dist/face-api.js";

// --- Shared state -------------------------------------------------------------

/** Live stream held open so FacialRecognition can claim it with zero wait. */
let _warmStream: MediaStream | null = null;

/** Whether warmup has been attempted this session (regardless of outcome). */
let _warmupAttempted = false;

// --- Public API ---------------------------------------------------------------

/**
 * Preload face-api models AND acquire the camera stream.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function warmupCamera(): Promise<void> {
  if (_warmupAttempted) {
    console.log("[CameraWarmup] Already attempted — skipping.");
    return;
  }
  _warmupAttempted = true;

  console.log("[CameraWarmup] Starting warmup (models + camera)...");
  const t0 = performance.now();

  // Run model preload and camera acquisition in parallel for maximum speed.
  await Promise.allSettled([preloadModels(), acquireStream()]);

  console.log(`[CameraWarmup] Done in ${Math.round(performance.now() - t0)} ms.`);
}

/**
 * Returns the warm stream if it is still live, otherwise null.
 * FacialRecognition calls this to skip its own getUserMedia call.
 */
export function claimWarmStream(): MediaStream | null {
  if (!_warmStream) return null;

  // Verify tracks are still live (user might have revoked camera permission).
  const alive = _warmStream.getTracks().every((t) => t.readyState === "live");
  if (!alive) {
    console.warn("[CameraWarmup] Warm stream tracks are no longer live — discarding.");
    _warmStream = null;
    return null;
  }

  console.log("[CameraWarmup] Handing warm stream to FacialRecognition.");
  const stream = _warmStream;
  // Transfer ownership — caller is responsible for stopping tracks on unmount.
  _warmStream = null;
  return stream;
}

/**
 * Release the held stream (e.g. if the kiosk navigates away before
 * FacialRecognition ever mounts).
 */
export function releaseWarmStream(): void {
  if (_warmStream) {
    _warmStream.getTracks().forEach((t) => t.stop());
    _warmStream = null;
    console.log("[CameraWarmup] Warm stream released.");
  }
}

// --- Internals ----------------------------------------------------------------

async function preloadModels(): Promise<void> {
  // Mirror the exact promise-cache keys used in FacialRecognition.tsx so we
  // never load the same model twice, regardless of call order.
  const w = window as any;

  if (!w.__faceModelsLoadPromise) {
    const MODEL_URL = `${window.location.origin}/models`;
    console.log("[CameraWarmup] Loading TinyFaceDetector + faceLandmark68TinyNet...");

    w.__faceModelsLoadPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
    ]).then(() => {
      console.log("[CameraWarmup] Detection models ready.");
    });
  } else {
    console.log("[CameraWarmup] Detection models already loading/loaded — awaiting.");
  }

  await w.__faceModelsLoadPromise;

  // Also kick off the heavier recognition net in the background so it is
  // likely done (or nearly done) before the voter reaches face capture.
  if (!w.__faceRecognitionLoadPromise && !faceapi.nets.faceRecognitionNet.isLoaded) {
    const MODEL_URL = `${window.location.origin}/models`;
    console.log("[CameraWarmup] Pre-loading faceRecognitionNet in background...");
    w.__faceRecognitionLoadPromise = faceapi.nets.faceRecognitionNet
      .loadFromUri(MODEL_URL)
      .then(() => {
        console.log("[CameraWarmup] faceRecognitionNet ready.");
      })
      .catch((err: unknown) => {
        // Non-fatal — FacialRecognition will retry on demand.
        console.warn("[CameraWarmup] faceRecognitionNet preload failed:", err);
      });
  }
}

async function acquireStream(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn("[CameraWarmup] getUserMedia not available.");
    return;
  }

  try {
    console.log("[CameraWarmup] Acquiring camera stream...");
    const t0 = performance.now();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640, max: 640 },
        height: { ideal: 480, max: 480 },
        frameRate: { ideal: 24, max: 24 },
      },
      audio: false,
    });

    console.log(`[CameraWarmup] Camera ready in ${Math.round(performance.now() - t0)} ms — holding stream open.`);
    _warmStream = stream;
  } catch (err) {
    // Permissions not granted yet, or no camera — FacialRecognition will
    // handle this gracefully on its own.
    console.warn("[CameraWarmup] Could not acquire camera stream:", err);
  }
}
