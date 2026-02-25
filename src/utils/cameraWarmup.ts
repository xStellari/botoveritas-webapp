// src/utils/cameraWarmup.ts

let warmedUpThisSession = false;

export async function warmupCamera() {
  if (warmedUpThisSession) {
    console.log("[CameraWarmup] Skipped (already warmed this session)");
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn("[CameraWarmup] getUserMedia not supported in this browser");
    return;
  }

  console.log("[CameraWarmup] Starting camera warm-up...");

  try {
    const start = performance.now();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });

    const duration = Math.round(performance.now() - start);
    console.log(`[CameraWarmup] Camera stream acquired in ${duration} ms`);

    // Immediately stop tracks (we just want to prime the pipeline)
    stream.getTracks().forEach((track) => track.stop());

    warmedUpThisSession = true;

    console.log("[CameraWarmup] Warm-up complete (tracks stopped)");
  } catch (err) {
    console.error("[CameraWarmup] Warm-up failed:", err);
  }
}