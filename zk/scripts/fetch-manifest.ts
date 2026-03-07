#!/usr/bin/env node
/**
 * zk/scripts/fetch-manifest.ts
 *
 * Fetches election manifest from Supabase and writes a reproducible snapshot:
 *   zk/manifests/election_<electionId>__<manifestHash>.json
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node zk/scripts/fetch-manifest.ts <electionId>
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

type ManifestRow = {
  election_id: string;
  spec_version: string;
  manifest: unknown;
  manifest_hash: string;
};

export async function fetchElectionManifest(electionId: string): Promise<ManifestRow> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("election_manifests")
    .select("election_id,spec_version,manifest,manifest_hash")
    .eq("election_id", electionId)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to fetch election_manifests for election_id=${electionId}: ${error?.message ?? "no data"}`
    );
  }

  return data as ManifestRow;
}

export function writeManifestSnapshot(row: ManifestRow, outDir = path.join("zk", "manifests")): string {
  const safeElectionId = row.election_id; // UUID is safe for filenames
  const safeHash = row.manifest_hash.startsWith("0x") ? row.manifest_hash : `0x${row.manifest_hash}`;
  const filename = `election_${safeElectionId}__${safeHash}.json`;
  const outPath = path.join(outDir, filename);

  fs.mkdirSync(outDir, { recursive: true });

  const payload = {
    schema: "BV_ELECTION_MANIFEST_SNAPSHOT_V1",
    election_id: row.election_id,
    spec_version: row.spec_version,
    manifest_hash: safeHash,
    manifest: row.manifest,
    snapped_at: new Date().toISOString(),
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  return outPath;
}

async function main() {
  const electionId = process.argv[2];
  if (!electionId) {
    console.error("Usage: fetch-manifest <electionId>");
    process.exit(1);
  }

  const row = await fetchElectionManifest(electionId);
  const outPath = writeManifestSnapshot(row);
  console.log(`Snapshot written: ${outPath}`);
  console.log(`manifest_hash: ${row.manifest_hash}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e));
    process.exit(1);
  });
}
