import * as faceapi from "face-api.js";

export function compareDescriptors(
  stored: Float32Array,
  live: Float32Array,
  threshold: number = 0.45
) {
  const distance = faceapi.euclideanDistance(stored, live);

  return {
    distance,
    match: distance < threshold,
  };
}
