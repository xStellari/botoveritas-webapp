import { supabase } from "@/integrations/supabase/client";

function normalizeField(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      return BigInt(trimmed).toString();
    }
    return trimmed;
  }
  return String(value ?? "").trim();
}

async function downloadStorageJson(bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  return await data.text().then((t) => JSON.parse(t));
}

export type PublicTallyBundle = {
  proof: any;
  publicSignals: string[];
  verificationKey: any;
  proofPath: string;
  publicSignalsPath: string;
  vkeyBucket: string;
  vkeyPath: string;
};

export async function loadPublicTallyArtifacts(args: {
  proofPath: string;
  publicSignalsPath: string;
  vkeyBucket: string;
  vkeyPath: string;
}): Promise<PublicTallyBundle> {
  const { proofPath, publicSignalsPath, vkeyBucket, vkeyPath } = args;
  const [proof, publicSignalsRaw, verificationKey] = await Promise.all([
    downloadStorageJson("zk-proofs", proofPath),
    downloadStorageJson("zk-proofs", publicSignalsPath),
    downloadStorageJson(vkeyBucket, vkeyPath),
  ]);

  if (!Array.isArray(publicSignalsRaw) || publicSignalsRaw.length < 4) {
    throw new Error("publicSignals.json must contain at least 4 entries");
  }

  return {
    proof,
    publicSignals: publicSignalsRaw.map((value) => normalizeField(value)),
    verificationKey,
    proofPath,
    publicSignalsPath,
    vkeyBucket,
    vkeyPath,
  };
}

export async function verifyPublicTallyProof(bundle: PublicTallyBundle): Promise<boolean> {
  const snarkjsMod = await import("snarkjs");
  const groth16 = (snarkjsMod as any).groth16 ?? (snarkjsMod as any).default?.groth16;
  if (!groth16?.verify) {
    throw new Error("snarkjs.groth16.verify is unavailable in the browser runtime");
  }

  return await Promise.race<boolean>([
    groth16.verify(bundle.verificationKey, bundle.publicSignals, bundle.proof),
    new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error("Browser proof verification timed out after 45 seconds")), 45000),
    ),
  ]);
}

export function getPublicSignalMetadata(publicSignals: string[]) {
  return {
    electionIdHash: publicSignals[0] ?? "",
    electionVoteRoot: publicSignals[1] ?? "",
    manifestHash: publicSignals[2] ?? "",
    resultsHash: publicSignals[3] ?? "",
  };
}

export function normalizePublicField(value: unknown) {
  return normalizeField(value);
}
