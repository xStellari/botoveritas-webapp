#!/usr/bin/env node
/**
 * zk/scripts/generate-tally-circuit.ts
 *
 * Emits the universal tally circuit used by all elections that fit within:
 * - MAX_POSITIONS = 20
 * - MAX_CANDIDATES_PER_POSITION = 5
 *
 * Optional manifest/election arguments are used only to validate that an
 * election fits the universal bounds before the shared circuit is promoted.
 */
import fs from "node:fs";
import path from "node:path";

import { fetchElectionManifest, writeManifestSnapshot } from "./fetch-manifest";

const MAX_POSITIONS = 20;
const MAX_CANDIDATES_PER_POSITION = 5;
const RESULTS_COMMIT_DOMAIN = "223344556";
const CIRCUIT_VERSION = "BV_TALLY_UNIVERSAL_V1";

type ManifestPosition =
  | string
  | {
      name?: string;
      position?: string;
      candidates?: unknown[];
    };

type SnapshotEnvelope = {
  manifest?: unknown;
};

type Manifest = {
  positions?: ManifestPosition[];
  manifest?: { positions?: ManifestPosition[] };
};

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizePositions(manifestRaw: Manifest): { name: string; candidateCount: number }[] {
  const inner = (manifestRaw.manifest ?? manifestRaw) as Manifest;
  const positions = inner.positions ?? [];
  if (!Array.isArray(positions) || positions.length === 0) {
    throw new Error("Manifest missing positions[]");
  }

  return positions.map((p, idx) => {
    if (typeof p === "string") {
      return { name: p, candidateCount: 0 };
    }
    const name = (p.name ?? p.position ?? `Position_${idx}`) as string;
    const candidateCount = Array.isArray(p.candidates) ? p.candidates.length : 0;
    return { name, candidateCount };
  });
}

function assertWithinUniversalBounds(positions: { name: string; candidateCount: number }[]) {
  if (positions.length > MAX_POSITIONS) {
    throw new Error(`Manifest has ${positions.length} positions; universal circuit supports at most ${MAX_POSITIONS}`);
  }
  for (const p of positions) {
    if (p.candidateCount > MAX_CANDIDATES_PER_POSITION) {
      throw new Error(
        `Position "${p.name}" has ${p.candidateCount} candidates; universal circuit supports at most ${MAX_CANDIDATES_PER_POSITION}`,
      );
    }
  }
}

function emitCircom() {
  return fs.readFileSync(path.join("zk", "circuits", "tally.circom"), "utf8");
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--electionId") args.electionId = argv[++i];
    else if (a === "--manifestFile") args.manifestFile = argv[++i];
    else if (a === "--outCircom") args.outCircom = argv[++i];
    else if (a === "--outMeta") args.outMeta = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage:");
    console.log("  node zk/scripts/generate-tally-circuit.ts");
    console.log("  node zk/scripts/generate-tally-circuit.ts --electionId <uuid>");
    console.log("  node zk/scripts/generate-tally-circuit.ts --manifestFile <path>");
    process.exit(0);
  }

  const outCircom = (args.outCircom as string) ?? path.join("zk", "circuits", "tally.circom");
  const outMeta = (args.outMeta as string) ?? path.join("zk", "circuits", "tally.meta.json");

  let positions: { name: string; candidateCount: number }[] | null = null;
  if (args.electionId) {
    const row = await fetchElectionManifest(args.electionId as string);
    const snapPath = writeManifestSnapshot(row, path.join("zk", "manifests"));
    const env = readJson(snapPath) as SnapshotEnvelope;
    const rawManifest = env && typeof env === "object" && "manifest" in env && env.manifest ? (env.manifest as Manifest) : (env as Manifest);
    positions = normalizePositions(rawManifest);
  } else if (args.manifestFile) {
    const manifestObj = readJson(args.manifestFile as string) as SnapshotEnvelope;
    const rawManifest = manifestObj && typeof manifestObj === "object" && "manifest" in manifestObj && manifestObj.manifest ? (manifestObj.manifest as Manifest) : (manifestObj as Manifest);
    positions = normalizePositions(rawManifest);
  }

  if (positions) assertWithinUniversalBounds(positions);

  const meta = {
    schema: "BV_TALLY_UNIVERSAL_META_V1",
    circuitId: "tally",
    circuitVersion: CIRCUIT_VERSION,
    maxPositions: MAX_POSITIONS,
    maxCandidatesPerPosition: MAX_CANDIDATES_PER_POSITION,
    resultsCommitDomain: RESULTS_COMMIT_DOMAIN,
    validatedManifest: positions
      ? { positions: positions.length, maxCandidatesSeen: Math.max(0, ...positions.map((p) => p.candidateCount)) }
      : null,
  };

  fs.mkdirSync(path.dirname(outCircom), { recursive: true });
  fs.writeFileSync(outCircom, emitCircom(), "utf8");
  fs.writeFileSync(outMeta, JSON.stringify(meta, null, 2), "utf8");

  console.log(`Generated universal circuit: ${outCircom}`);
  console.log(`Meta: ${outMeta}`);
  if (positions) console.log(`Validated manifest against ${CIRCUIT_VERSION}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
