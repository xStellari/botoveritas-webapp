import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

type PublishConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  version: string;
};

type PublishResult = {
  bucket: string;
  version: string;
  wasm: { key: string; sha256: string; size: number };
  zkey: { key: string; sha256: string; size: number };
  vkey: { key: string; sha256: string; size: number };
};

function repoRootFromHere(): string {
  return path.resolve(__dirname, "..", "..");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function artifactBuffer(filePath: string, label: string): Buffer {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  return fs.readFileSync(filePath);
}

async function uploadObject(config: PublishConfig, key: string, bytes: Buffer, contentType: string): Promise<void> {
  const url = `${config.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${config.bucket}/${key}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
      "x-upsert": "true",
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
    },
    body: bytes,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Upload failed for ${config.bucket}/${key}: HTTP ${response.status}${body ? ` - ${body}` : ""}`);
  }
}

export async function publishCurrentZkArtifacts(repoRoot = repoRootFromHere()): Promise<PublishResult> {
  const config: PublishConfig = {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    bucket: optionalEnv("ZK_ARTIFACTS_BUCKET", "zk-artifacts"),
    version: optionalEnv("ZK_ARTIFACT_VERSION", "BV_TALLY_UNIVERSAL_V1"),
  };

  const buildDir = path.join(repoRoot, "zk", "build", "tally");
  const wasmPath = path.join(buildDir, "tally_js", "tally.wasm");
  const zkeyPath = path.join(buildDir, "tally_final.zkey");
  const vkeyPath = path.join(buildDir, "verification_key.json");

  const wasm = artifactBuffer(wasmPath, "tally.wasm");
  const zkey = artifactBuffer(zkeyPath, "tally_final.zkey");
  const vkey = artifactBuffer(vkeyPath, "verification_key.json");

  const base = `tally/${config.version}`;
  const wasmKey = `${base}/tally_js/tally.wasm`;
  const zkeyKey = `${base}/tally_final.zkey`;
  const vkeyKey = `${base}/verification_key.json`;

  await uploadObject(config, wasmKey, wasm, "application/wasm");
  await uploadObject(config, zkeyKey, zkey, "application/octet-stream");
  await uploadObject(config, vkeyKey, vkey, "application/json");

  return {
    bucket: config.bucket,
    version: config.version,
    wasm: { key: wasmKey, sha256: sha256Hex(wasm), size: wasm.byteLength },
    zkey: { key: zkeyKey, sha256: sha256Hex(zkey), size: zkey.byteLength },
    vkey: { key: vkeyKey, sha256: sha256Hex(vkey), size: vkey.byteLength },
  };
}

async function main() {
  const published = await publishCurrentZkArtifacts();
  console.log(JSON.stringify(published, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
