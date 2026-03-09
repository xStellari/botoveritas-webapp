import { Buffer } from "buffer";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RefreshCw, FileText, Layers, ShieldCheck, Download, CheckCircle2, Circle, Play, FileJson, MoreHorizontal, ScrollText } from "lucide-react";

type ElectionRow = {
  id: string;
  title: string;
  is_final: boolean | null;
  is_archived: boolean | null;
  finalized_at: string | null;
};

type ManifestRow = {
  election_id: string;
  manifest_hash: string;
  updated_at: string;
  manifest?: any;
};

type ChunkRow = {
  election_id: string;
  chunk_index: number;
  leaf_count: number;
  chunk_root: string;
  created_at: string;
};


type RootRow = {
  election_id: string;
  election_vote_root: string;
  chunk_count: number;
  computed_at: string;
};

type ProofRow = {
  election_id: string;
  status: string | null;
  tx_hash: string | null;
  registry_address?: string | null;
  verifier_address?: string | null;
  chain?: string | null;
  proof_json_url?: string | null;
  public_signals_json_url?: string | null;
  error_message?: string | null;
  updated_at: string | null;
};

if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}


const UNIVERSAL_CIRCUIT_VERSION = "BV_TALLY_UNIVERSAL_V1";
const UNIVERSAL_ARTIFACT_BASE = `tally/${UNIVERSAL_CIRCUIT_VERSION}`;


type VerifyTallyProofResponse = {
  ok: boolean;
  verified: boolean;
  persistedStatus?: string | null;
  signalChecks?: {
    electionVoteRootMatches?: boolean;
    manifestHashMatches?: boolean;
    resultsHashMatches?: boolean;
  };
  error?: string;
};


type TallyPreviewPosition = {
  title: string;
  abstain: number;
  totalBallots: number;
  candidates: Array<{
    id: string;
    name: string;
    votes: number;
  }>;
};

type ZkRunResult = {
  ok: boolean;
  electionId: string;
  proofGenerated: boolean;
  proofVerified: boolean;
  genMs: number;
  verifyMs: number;
  proofSha256?: string;
  publicSignalsSha256?: string;
  proofJsonUrl?: string;
  publicSignalsJsonUrl?: string;
  manifestHash?: string;
  electionVoteRoot?: string;
  resultsHash?: string;
  positionsTotal?: number;
  positionsMatched?: number;
  mismatchCount?: number;
  accuracy?: number;
  notes?: string;
  error?: string;
  details?: string;
  tallyPreview?: TallyPreviewPosition[];
};

type VoteTallyRow = {
  election_id: string;
  position: string;
  candidate_id?: string | null;
  candidate_name: string;
  vote_count: number;
  abstain_count?: number | null;
  total_ballots_for_position?: number | null;
};

type TestingRow = {
  electionId: string;
  electionTitle: string;
  position: string;
  votesCount: number;
  expectedTally: string;
  generatedTally: string;
  proofVerification: string;
  privacyPreserved: string;
  finalizationStatus: string;
  remarks: string;
};

type VerifyProofRow = {
  election_id: string;
  status: string | null;
  manifest_hash: string;
  election_vote_root: string;
  results_hash: string;
  proof_json_url: string | null;
  public_signals_json_url: string | null;
};

function shortHex(hex: string, keep = 10) {
  const h = String(hex || "");
  if (!h) return "—";
  if (h.length <= keep * 2) return h;
  return `${h.slice(0, keep)}…${h.slice(-keep)}`;
}


function fmtTiming(ms?: number) {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "—";
  return `${ms.toLocaleString()} ms`;
}

function formatTallySummary(params: { abstain?: number | null; candidates: Array<{ name: string; votes: number }> }) {
  const parts = [...params.candidates]
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name))
    .map((candidate) => `${candidate.name} (${candidate.votes})`);

  if ((params.abstain ?? 0) > 0) parts.push(`Abstain (${params.abstain ?? 0})`);
  return parts.length ? parts.join(", ") : "—";
}

function toTestingRowKey(electionId: string, position: string) {
  return `${electionId}::${position}`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadJson(filename: string, data: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
}

function downloadText(filename: string, text: string) {
  downloadBlob(filename, new Blob([text], { type: "text/plain" }));
}


async function computeResultsHashField(params: {
  electionIdHash: string | number;
  electionVoteRoot: string | number;
  manifestHash: string | number;
  foldVector: (string | number)[];
}): Promise<{ field: string; bytes32: string }> {
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  const toBI = (v: string | number | bigint): bigint => {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(v);
    const s = String(v).trim();
    if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
    return BigInt(s);
  };

  const DOMAIN = 123456789n;
  const pose2 = (a: bigint, b: bigint): bigint => BigInt(F.toObject(poseidon([a, b])));

  let h = pose2(DOMAIN, toBI(params.electionIdHash));
  h = pose2(h, toBI(params.electionVoteRoot));
  h = pose2(h, toBI(params.manifestHash));
  for (const value of params.foldVector) h = pose2(h, toBI(value));

  const field = h.toString(10);
  const hex = h.toString(16).padStart(64, "0");
  return { field, bytes32: `0x${hex}` };
}

async function downloadStorageBlob(bucket: string, key: string) {
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error) throw error;
  return data;
}


async function downloadManifestJson(electionId: string) {
  const { data, error } = await supabase.from("election_manifests").select("*").eq("election_id", electionId).maybeSingle();
  if (error) {
    toast.error(`Failed to load manifest row: ${error.message}`);
    return;
  }
  if (!data) {
    toast.error("No manifest row found for this election.");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  downloadJson(`manifest.${electionId}.${stamp}.json`, data);
}

async function downloadProofJson(electionId: string) {
  const { data, error } = await supabase.from("election_tally_proofs").select("*").eq("election_id", electionId).maybeSingle();
  if (error) {
    toast.error(`Failed to load proof row: ${error.message}`);
    return;
  }
  if (!data) {
    toast.error("No proof row found for this election.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (data.proof_json_url) {
    try {
      const blob = await downloadStorageBlob("zk-proofs", String(data.proof_json_url));
      downloadBlob(`proof.${electionId}.${stamp}.json`, blob);
      return;
    } catch (storageError: any) {
      toast.error(`Failed to download stored proof.json: ${storageError?.message ?? String(storageError)}`);
      return;
    }
  }

  downloadJson(`proof-row.${electionId}.${stamp}.json`, data);
}

async function downloadPublicSignalsJson(electionId: string) {
  const { data, error } = await supabase.from("election_tally_proofs").select("*").eq("election_id", electionId).maybeSingle();
  if (error) {
    toast.error(`Failed to load proof row: ${error.message}`);
    return;
  }
  if (!data?.public_signals_json_url) {
    toast.error("No publicSignals.json path found for this election.");
    return;
  }

  try {
    const blob = await downloadStorageBlob("zk-proofs", String(data.public_signals_json_url));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadBlob(`publicSignals.${electionId}.${stamp}.json`, blob);
  } catch (storageError: any) {
    toast.error(`Failed to download stored publicSignals.json: ${storageError?.message ?? String(storageError)}`);
  }
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}


function normalizeField(v: unknown): string {
  if (typeof v === "bigint") return v.toString(10);
  if (typeof v === "number") return BigInt(v).toString(10);
  const s = String(v ?? "").trim();
  if (!s) throw new Error("Encountered empty field while normalizing public signal");
  return BigInt(s).toString(10);
}

async function blobToJson(blob: Blob): Promise<any> {
  return JSON.parse(await blob.text());
}

function StatusPill(props: { isFinal: boolean; hasManifest: boolean; hasChunks: boolean; hasRoot: boolean; artifactsReady: boolean; proofOk: boolean }) {
  const { isFinal, hasManifest, hasChunks, hasRoot, artifactsReady, proofOk } = props;

  const variant = hasManifest && hasRoot && artifactsReady ? "default" : "secondary";

  const Item = ({ label, ok }: { label: string; ok: boolean }) => (
    <span className="inline-flex items-center gap-1">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5 opacity-60" />}
      <span className="text-xs">{label}</span>
    </span>
  );

  return (
    <Badge variant={variant} className="gap-2">
      <Item label={isFinal ? "Final" : "Not final"} ok={isFinal} />
      <span className="opacity-60">•</span>
      <Item label="Manifest" ok={hasManifest} />
      <span className="opacity-60">•</span>
      <Item label="Chunks" ok={hasChunks} />
      <span className="opacity-60">•</span>
      <Item label="Root" ok={hasRoot} />
      <span className="opacity-60">•</span>
      <Item label="Artifacts" ok={artifactsReady} />
      <span className="opacity-60">•</span>
      <Item label="Proof" ok={proofOk} />
      </Badge>
  );
}

export default function ZKTally() {
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [manifests, setManifests] = useState<Record<string, ManifestRow>>({});
  const [chunkStats, setChunkStats] = useState<
    Record<string, { chunkCount: number; totalLeaves: number; lastChunkAt: string | null }>
  >({});
  const [roots, setRoots] = useState<Record<string, RootRow>>({});
  const [proofs, setProofs] = useState<Record<string, ProofRow>>({});
  const [voteTallies, setVoteTallies] = useState<Record<string, VoteTallyRow[]>>({});
  const [zkRuns, setZkRuns] = useState<Record<string, ZkRunResult>>({});

  const [artifactChecking, setArtifactChecking] = useState(false);
  const [artifactExisting, setArtifactExisting] = useState({
    wasm: { exists: false, size: null as number | null },
    zkey: { exists: false, size: null as number | null },
    vkey: { exists: false, size: null as number | null },
  });

  const artifactsReady = useMemo(
    () => artifactExisting.wasm.exists && artifactExisting.zkey.exists && artifactExisting.vkey.exists,
    [artifactExisting],
  );

  const finalized = useMemo(
    () => elections.filter((e) => Boolean(e.is_final) && !Boolean(e.is_archived)),
    [elections],
  );

  const testingRows = useMemo<TestingRow[]>(() => {
    const rows: TestingRow[] = [];

    for (const election of finalized) {
      const dbRows = voteTallies[election.id] ?? [];
      const dbByPosition = new Map<string, VoteTallyRow[]>();
      for (const row of dbRows) {
        const key = String(row.position ?? "");
        if (!dbByPosition.has(key)) dbByPosition.set(key, []);
        dbByPosition.get(key)?.push(row);
      }

      const run = zkRuns[election.id];
      const witnessByPosition = new Map((run?.tallyPreview ?? []).map((position) => [position.title, position]));
      const allPositions = Array.from(new Set([...dbByPosition.keys(), ...witnessByPosition.keys()])).sort((a, b) => a.localeCompare(b));

      for (const position of allPositions) {
        const expectedRows = dbByPosition.get(position) ?? [];
        const expectedVotes = expectedRows[0]?.total_ballots_for_position ?? expectedRows.reduce((sum, row) => sum + Number(row.vote_count ?? 0), 0) + Number(expectedRows[0]?.abstain_count ?? 0);
        const expectedTally = formatTallySummary({
          abstain: expectedRows[0]?.abstain_count ?? 0,
          candidates: expectedRows.map((row) => ({ name: row.candidate_name, votes: Number(row.vote_count ?? 0) })),
        });

        const generated = witnessByPosition.get(position);
        const generatedTally = generated
          ? formatTallySummary({
              abstain: generated.abstain,
              candidates: generated.candidates.map((candidate) => ({ name: candidate.name, votes: candidate.votes })),
            })
          : proofs[election.id]
            ? "Stored proof only"
            : "—";

        const proofVerification = run
          ? run.proofVerified
            ? "Valid"
            : run.proofGenerated
              ? "Generated / verify failed"
              : "Failed"
          : ["verified", "submitted", "confirmed"].includes(String(proofs[election.id]?.status ?? "").toLowerCase())
            ? "Valid"
            : proofs[election.id]
              ? String(proofs[election.id]?.status ?? "Stored")
              : "Pending";

        const remarks = run
          ? run.proofVerified && generatedTally === expectedTally
            ? "PASS"
            : "CHECK"
          : ["verified", "submitted", "confirmed"].includes(String(proofs[election.id]?.status ?? "").toLowerCase())
            ? "PASS"
            : "PENDING";

        rows.push({
          electionId: election.id,
          electionTitle: election.title,
          position,
          votesCount: Number(expectedVotes ?? 0),
          expectedTally,
          generatedTally,
          proofVerification,
          privacyPreserved: generated || proofs[election.id] ? "Yes" : "—",
          finalizationStatus: election.is_final ? "Success" : "Pending",
          remarks,
        });
      }
    }

    return rows;
  }, [finalized, proofs, voteTallies, zkRuns]);

  useEffect(() => {
    void refreshArtifactPresence();
  }, []);

  const load = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      const { data: eData, error: eErr } = await supabase
        .from("elections")
        .select("id,title,is_final,is_archived,finalized_at")
        .order("created_at", { ascending: false });

      if (eErr) throw eErr;
      setElections((eData ?? []) as ElectionRow[]);

      const { data: mData, error: mErr } = await supabase
        .from("election_manifests")
        .select("election_id,manifest_hash,updated_at,manifest");

      if (mErr) throw mErr;

      const mMap: Record<string, ManifestRow> = {};
      for (const r of (mData ?? []) as ManifestRow[]) mMap[r.election_id] = r;
      setManifests(mMap);

      const { data: cData, error: cErr } = await supabase
        .from("election_vote_chunks")
        .select("election_id,chunk_index,leaf_count,chunk_root,created_at")
        .order("chunk_index", { ascending: true });

      if (cErr) throw cErr;

      const stats: Record<string, { chunkCount: number; totalLeaves: number; lastChunkAt: string | null }> = {};
      for (const row of (cData ?? []) as ChunkRow[]) {
        const s = stats[row.election_id] ?? { chunkCount: 0, totalLeaves: 0, lastChunkAt: null };
        s.chunkCount += 1;
        s.totalLeaves += row.leaf_count ?? 0;
        s.lastChunkAt = !s.lastChunkAt || row.created_at > s.lastChunkAt ? row.created_at : s.lastChunkAt;
        stats[row.election_id] = s;
      }
      setChunkStats(stats);

      const { data: rData, error: rErr } = await supabase
        .from("election_vote_roots" as any)
        .select("election_id,election_vote_root,chunk_count,computed_at");

      if (rErr) throw rErr;

      const rMap: Record<string, RootRow> = {};
      for (const r of (rData ?? []) as unknown as RootRow[]) rMap[r.election_id] = r;
      setRoots(rMap);

const { data: pData, error: pErr } = await supabase
  .from("election_tally_proofs" as any)
  .select("election_id,status,tx_hash,registry_address,verifier_address,chain,proof_json_url,public_signals_json_url,error_message,updated_at");

if (pErr) throw pErr;

const pMap: Record<string, ProofRow> = {};
for (const p of (pData ?? []) as unknown as ProofRow[]) pMap[p.election_id] = p;
setProofs(pMap);

      const { data: tallyData, error: tallyErr } = await supabase
        .from("vote_tally_view" as any)
        .select("election_id,position,candidate_id,candidate_name,vote_count,abstain_count,total_ballots_for_position");

      if (tallyErr) throw tallyErr;

      const tallyMap: Record<string, VoteTallyRow[]> = {};
      for (const row of (tallyData ?? []) as unknown as VoteTallyRow[]) {
        if (!tallyMap[row.election_id]) tallyMap[row.election_id] = [];
        tallyMap[row.election_id].push(row);
      }
      setVoteTallies(tallyMap);

    } catch (e: any) {
      console.error("[ZKTally] load failed", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("admin-zk-tally")
      .on("postgres_changes", { event: "*", schema: "public", table: "elections" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "election_manifests" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "election_vote_chunks" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "election_vote_roots" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "election_tally_proofs" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runFn = async (electionId: string, fnName: string) => {
    setWorking(`${fnName}:${electionId}`);
    try {
      const { data, error } = await supabase.functions.invoke(fnName, { body: { electionId } });
      if (error) throw error;

      // Deployment-ready: download artifacts that must be retained for proof/audit.
      if (fnName === "generate-zk-tally-witness" && data?.witness) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        downloadJson(`zk-witness.${electionId}.${stamp}.json`, data);
        const rh = data?.witness?.publicInputs?.resultsHashField;
        toast.success(rh ? `Witness generated (resultsHashField=${String(rh).slice(0, 18)}…)` : "Witness generated");
      } else if (fnName === "generate-tally-circuit" && data?.circom) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        if (data?.meta) downloadJson(`tally.meta.${electionId}.${stamp}.json`, data.meta);
        downloadText(`tally.${electionId}.${stamp}.circom`, String(data.circom));
        toast.success("Circuit + meta downloaded");
      } else {
        toast.success(`${fnName} done`);
      }
      return data;
    } catch (e: any) {
      console.error(`[ZKTally] ${fnName} failed`, e);

      const status = e?.context?.status ?? e?.status;
      const body = e?.context?.body ?? e?.context?.json ?? null;
      const apiMsg =
        (body && (body.error || body.message)) ||
        e?.message ||
        String(e);

      if (status === 409) {
        toast.info(apiMsg);
        return null;
      }
      if (status === 401 || status === 403) {
        toast.error(apiMsg || "Unauthorized");
        return null;
      }

      toast.error(`${fnName} failed: ${apiMsg}`);
      throw e;
    } finally {
      setWorking(null);
      await load();
    }
  };

  const downloadResultsPdf = async (electionId: string, mode: "draft" | "final") => {
    setWorking(`pdf:${electionId}`);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Missing session token. Please re-login as admin.");

      const baseUrl = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
      if (!baseUrl) throw new Error("Missing VITE_SUPABASE_URL");

      const res = await fetch(`${baseUrl}/functions/v1/generate-results-pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ electionId, mode }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // Open in a new tab (browser handles download via Content-Disposition)
      window.open(url, "_blank", "noopener,noreferrer");
      toast.success("PDF generated");
    } catch (e: any) {
      console.error("[ZKTally] PDF generation failed", e);
      toast.error(`PDF failed: ${e?.message ?? String(e)}`);
    } finally {
      setWorking(null);
    }
  };


const refreshArtifactPresence = async () => {
  setArtifactChecking(true);
  try {
    const base = UNIVERSAL_ARTIFACT_BASE;
    const [{ data: rootList, error: rootErr }, { data: wasmList, error: wasmErr }] = await Promise.all([
      supabase.storage.from("zk-artifacts").list(base, { limit: 100 }),
      supabase.storage.from("zk-artifacts").list(`${base}/tally_js`, { limit: 100 }),
    ]);
    if (rootErr) throw rootErr;
    if (wasmErr) throw wasmErr;

    const rootMap = new Map((rootList ?? []).map((item: any) => [item.name, item as any]));
    const wasmMap = new Map((wasmList ?? []).map((item: any) => [item.name, item as any]));
    const wasmMeta: any = wasmMap.get("tally.wasm");
    const zkeyMeta: any = rootMap.get("tally_final.zkey");
    const vkeyMeta: any = rootMap.get("verification_key.json");

    setArtifactExisting({
      wasm: { exists: wasmMap.has("tally.wasm"), size: wasmMeta?.metadata?.size ?? wasmMeta?.size ?? null },
      zkey: { exists: rootMap.has("tally_final.zkey"), size: zkeyMeta?.metadata?.size ?? zkeyMeta?.size ?? null },
      vkey: { exists: rootMap.has("verification_key.json"), size: vkeyMeta?.metadata?.size ?? vkeyMeta?.size ?? null },
    });
  } catch (e: any) {
    console.error("[ZKTally] artifact presence check failed", e);
    toast.error(`Failed to check existing artifacts: ${e?.message ?? String(e)}`);
  } finally {
    setArtifactChecking(false);
  }
};

const handleGenerateProof = async (electionId: string) => {
  setWorking(`generate-tally-proof:${electionId}`);
  try {
    const manifestHash = manifests[electionId]?.manifest_hash;

    if (!manifestHash) {
      toast.error("Generate manifest first.");
      return;
    }
    if (!artifactsReady) {
      toast.error("Universal tally artifacts are missing. Install tally.wasm, tally_final.zkey, and verification_key.json in zk-artifacts before generating proof.");
      return;
    }

    toast.message("Generating proof on the backend… This may take a bit for the universal circuit.");

    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw sessionErr;
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      toast.error("Please sign in again before generating a proof.");
      return;
    }

    const response = await fetch("/api/zk/run.ts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ electionId }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const message = payload?.details || payload?.error || `HTTP ${response.status}`;
      throw new Error(message);
    }

    if (!payload?.proofGenerated) {
      throw new Error(payload?.details || payload?.error || "Backend prover did not generate a proof.");
    }

    setZkRuns((current) => ({ ...current, [electionId]: payload as ZkRunResult }));

    if (payload?.proofVerified) {
      toast.success(`Proof generated and self-verified on the backend in ${payload?.genMs ?? 0} ms.`);
    } else {
      toast.warning(`Proof generated, but backend self-verification failed. ${payload?.notes ?? "Check logs."}`);
    }
  } catch (e: any) {
    console.error("[ZKTally] generate proof failed", e);
    const apiMsg = e?.message || String(e);
    toast.error(`Generate proof failed: ${apiMsg}`);
  } finally {
    setWorking(null);
    await load();
  }
};

const handleSubmitProof = async (electionId: string) => {
  setWorking(`submit-tally-proof:${electionId}`);
  try {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw sessionErr;
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      toast.error("Please sign in again before submitting the proof on-chain.");
      return;
    }

    toast.message("Submitting tally proof on-chain…");
    const response = await fetch("/api/zk/submit.ts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ electionId }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const message = payload?.details || payload?.error || `HTTP ${response.status}`;
      throw new Error(message);
    }

    toast.success(`Proof submitted on-chain. Tx: ${payload?.txHash ?? "(pending)"}`);
  } catch (e: any) {
    console.error("[ZKTally] submit proof failed", e);
    const apiMsg = e?.message || String(e);
    toast.error(`Submit proof failed: ${apiMsg}`);
  } finally {
    setWorking(null);
    await load();
  }
};

const handleVerifyProof = async (electionId: string) => {
  const toastId = toast.loading("Verifying proof...");
  setWorking(`verify-tally-proof:${electionId}`);
  try {
    console.log("[ZKTally] verify proof start", { electionId });
    const { data: proofRowData, error: proofErr } = await supabase
      .from("election_tally_proofs")
      .select("election_id,status,manifest_hash,election_vote_root,results_hash,proof_json_url,public_signals_json_url")
      .eq("election_id", electionId)
      .maybeSingle();

    if (proofErr) throw proofErr;
    const proofRow = proofRowData as VerifyProofRow | null;
    console.log("[ZKTally] verify proof row", proofRow);
    if (!proofRow) throw new Error("No proof row found for election");
    if (!proofRow.proof_json_url || !proofRow.public_signals_json_url) {
      throw new Error("Proof row is missing proof_json_url or public_signals_json_url");
    }

    const { data: manifestRow, error: manifestErr } = await supabase
      .from("election_manifests")
      .select("manifest")
      .eq("election_id", electionId)
      .maybeSingle();
    if (manifestErr) throw manifestErr;

    const artifacts = (manifestRow as any)?.manifest?.artifacts ?? {};
    const vkeyBucket = String(artifacts?.vkey?.bucket ?? "zk-artifacts");
    const vkeyKey = String(artifacts?.vkey?.key ?? `${UNIVERSAL_ARTIFACT_BASE}/verification_key.json`);
    console.log("[ZKTally] verify storage keys", {
      proof: proofRow.proof_json_url,
      publicSignals: proofRow.public_signals_json_url,
      vkeyBucket,
      vkeyKey,
    });

    const [proofBlob, publicSignalsBlob, verificationKeyBlob] = await Promise.all([
      downloadStorageBlob("zk-proofs", proofRow.proof_json_url),
      downloadStorageBlob("zk-proofs", proofRow.public_signals_json_url),
      downloadStorageBlob(vkeyBucket, vkeyKey),
    ]);

    const [proof, publicSignalsRaw, verificationKey] = await Promise.all([
      blobToJson(proofBlob),
      blobToJson(publicSignalsBlob),
      blobToJson(verificationKeyBlob),
    ]);
    console.log("[ZKTally] verify parsed artifacts", {
      publicSignalsRaw,
      proofProtocol: (proof as any)?.protocol,
      proofCurve: (proof as any)?.curve,
      hasVerificationKey: !!verificationKey,
    });

    if (!Array.isArray(publicSignalsRaw) || publicSignalsRaw.length < 4) {
      throw new Error("publicSignals.json must contain at least 4 entries");
    }

    const publicSignals = publicSignalsRaw.map((v) => normalizeField(v));
    const signalChecks = {
      electionVoteRootMatches: publicSignals[1] === normalizeField(proofRow.election_vote_root),
      manifestHashMatches: publicSignals[2] === normalizeField(proofRow.manifest_hash),
      resultsHashMatches: publicSignals[3] === normalizeField(proofRow.results_hash),
    };
    console.log("[ZKTally] verify signal checks", { publicSignals, signalChecks });

    const snarkjsMod = await import("snarkjs");
    const groth16 = (snarkjsMod as any).groth16 ?? (snarkjsMod as any).default?.groth16;
    if (!groth16?.verify) throw new Error("snarkjs.groth16.verify is unavailable in the browser runtime");

    console.log("[ZKTally] verify invoke groth16.verify");
    const verified = await Promise.race<boolean>([
      groth16.verify(verificationKey, publicSignals, proof),
      new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error("Browser proof verification timed out after 45 seconds")), 45000)),
    ]);
    console.log("[ZKTally] verify result", { verified });

    const nextStatus = verified ? "verified" : "verify_failed";
    const nextError = verified ? null : "Groth16 verification failed";
    const { data: updatedRows, error: updateErr } = await supabase
      .from("election_tally_proofs")
      .update({
        status: nextStatus,
        error_message: nextError,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("election_id", electionId)
      .select("election_id,status,updated_at");
    console.log("[ZKTally] verify update result", { updatedRows, updateErr });

    if (updateErr) {
      console.warn("[ZKTally] verify proof status update failed", updateErr);
      if (verified) toast.success("Proof verified successfully, but DB status could not be updated.", { id: toastId });
      else toast.error("Verifier rejected the proof, and DB status could not be updated.", { id: toastId });
    } else {
      if (!signalChecks.electionVoteRootMatches || !signalChecks.manifestHashMatches || !signalChecks.resultsHashMatches) {
        toast.warning("Proof cryptographically verified, but one or more stored DB fields did not match the public signals. Check the proof row before publishing.", { id: toastId });
      }
      if (verified) toast.success("Proof verified successfully.", { id: toastId });
      else toast.error("Verifier rejected the proof.", { id: toastId });
    }
  } catch (e: any) {
    console.error("[ZKTally] verify proof failed", e);
    const status = e?.context?.status ?? e?.status;
    const body = e?.context?.body ?? e?.context?.json ?? null;
    const apiMsg = (body && (body.error || body.message)) || e?.message || String(e);
    if (status === 401 || status === 403) toast.error(apiMsg || "Unauthorized", { id: toastId });
    else toast.error(`Verify proof failed: ${apiMsg}`, { id: toastId });
  } finally {
    setWorking(null);
    await load();
  }
};

  return (
    <div className="space-y-6">

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Universal tally artifacts
            </CardTitle>
            <CardDescription>
              {UNIVERSAL_CIRCUIT_VERSION} is a shared system-level circuit. These files are installed once and reused across all elections.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshArtifactPresence()} disabled={artifactChecking}>
            <RefreshCw className={`h-4 w-4 mr-2 ${artifactChecking ? "animate-spin" : ""}`} />
            Check storage
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={artifactsReady ? "default" : "destructive"}>
              {artifactsReady ? "Installed" : "Missing files"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              Expected path: zk-artifacts/{UNIVERSAL_ARTIFACT_BASE}/
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {[
              { label: "Circuit WASM", filename: "tally.wasm", key: `${UNIVERSAL_ARTIFACT_BASE}/tally_js/tally.wasm`, meta: artifactExisting.wasm },
              { label: "Final proving key", filename: "tally_final.zkey", key: `${UNIVERSAL_ARTIFACT_BASE}/tally_final.zkey`, meta: artifactExisting.zkey },
              { label: "Verification key", filename: "verification_key.json", key: `${UNIVERSAL_ARTIFACT_BASE}/verification_key.json`, meta: artifactExisting.vkey },
            ].map((artifact) => (
              <div key={artifact.filename} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{artifact.label}</div>
                    <div className="text-xs text-muted-foreground">{artifact.filename}</div>
                  </div>
                  <Badge variant={artifact.meta.exists ? "secondary" : "outline"}>
                    {artifact.meta.exists ? "Present" : "Missing"}
                  </Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground break-all">{artifact.key}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {artifact.meta.exists ? `Detected in storage${artifact.meta.size ? ` (${(artifact.meta.size / (1024*1024)).toFixed(1)} MB)` : ""}` : "Upload this file once outside the election workflow."}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Upload artifacts is no longer an election action. New manifests and future elections reuse the same universal files automatically.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              ZK Tally Actions
            </CardTitle>
            <CardDescription>
              Admin-only buttons to produce the election manifest, anchor vote chunks/root, generate witness, and export results PDF.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {errorMsg ? (
            <div className="text-sm text-red-500">{errorMsg}</div>
          ) : null}

          <div className="mb-4 flex flex-wrap gap-2 text-sm">
            <Badge variant="secondary">Finalized (active): {finalized.length}</Badge>
            <Badge variant="secondary">Manifests: {Object.keys(manifests).length}</Badge>
            <Badge variant="secondary">
              With chunks: {Object.values(chunkStats).filter((s) => (s?.chunkCount ?? 0) > 0).length}
            </Badge>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Election</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Manifest</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Root</TableHead>
                  <TableHead>Proof</TableHead>
                  <TableHead>Diagnostics</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : finalized.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      No finalized elections found.
                    </TableCell>
                  </TableRow>
                ) : (
                  finalized.map((e) => {
                    const manifest = manifests[e.id];
                    const chunks = chunkStats[e.id];
                    const root = roots[e.id];
                    const hasManifest = !!manifest;
                    const hasRoot = !!root;
                    const proof = proofs[e.id];
                    const run = zkRuns[e.id];
                    const proofStatus = String(proof?.status ?? "").toLowerCase();
                    const proofExists = !!proof;
                    const proofOk = !!proof && ["proved", "submitted", "confirmed", "verified"].includes(proofStatus);
                    const proofVerified = proofStatus === "verified";
                    const txOk = !!proof?.tx_hash;
                    const submitReady = !!proof && proofVerified && !txOk;

                    const hasArtifacts = artifactsReady;

                    const busy =
                      working?.endsWith(`:${e.id}`) ||
                      working === `pdf:${e.id}`;

                    return (
                      <TableRow key={e.id}>
                        <TableCell>
                          <div className="font-medium">{e.title}</div>
                          <div className="text-xs text-muted-foreground">{e.id}</div>
                        </TableCell>

                        <TableCell>
                          <div className="space-y-1">
                            <StatusPill
                              isFinal={Boolean(e.is_final)}
                              hasManifest={hasManifest}
                              hasChunks={Boolean(chunks?.chunkCount)}
                              hasRoot={hasRoot}
                              artifactsReady={hasArtifacts}
                              proofOk={proofOk}
                            />
                            {proofExists ? (
                              <div className="text-xs text-muted-foreground">
                                Proof status: <span className="font-medium">{proofVerified ? "verified" : proof.status ?? "queued"}</span>
                                {proof?.updated_at ? ` • ${new Date(proof.updated_at).toLocaleString()}` : ""}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>

                        <TableCell>
                          {manifest ? (
                            <div className="text-xs">
                              <div className="font-mono">{shortHex(manifest.manifest_hash)}</div>
                              <div className="text-muted-foreground">{new Date(manifest.updated_at).toLocaleString()}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell>
                          {chunks?.chunkCount ? (
                            <div className="text-xs">
                              <div>{chunks.chunkCount} chunks</div>
                              <div className="text-muted-foreground">{chunks.totalLeaves} leaves</div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>


                        <TableCell>
                          {hasRoot ? (
                            <div className="text-xs">
                              <div className="font-mono">{shortHex(root.election_vote_root)}</div>
                              <div className="text-muted-foreground">{root.chunk_count} chunks</div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell>
                          <div className="space-y-1 text-xs">
                            <div>
                              {run ? (
                                <Badge variant={run.proofVerified ? "default" : "secondary"}>
                                  {run.proofVerified ? "Verified" : run.proofGenerated ? "Generated" : "Failed"}
                                </Badge>
                              ) : proofExists ? (
                                <Badge variant={proofVerified ? "default" : "secondary"}>
                                  {proofVerified ? "Verified" : proof.status ?? "Stored"}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">No local run yet</span>
                              )}
                            </div>
                            <div className="text-muted-foreground">
                              {run?.positionsMatched != null && run?.positionsTotal != null
                                ? `${run.positionsMatched}/${run.positionsTotal} positions matched`
                                : proofExists
                                  ? `DB status: ${proof.status ?? "stored"}`
                                  : "Generate a proof to capture diagnostics."}
                            </div>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="space-y-1 text-xs">
                            <div>Accuracy: {run?.accuracy != null ? `${run.accuracy.toFixed(2)}%` : "—"}</div>
                            <div>Timing: {run ? `${fmtTiming(run.genMs)} / ${fmtTiming(run.verifyMs)}` : "—"}</div>
                            <div className="text-muted-foreground">Mismatches: {run?.mismatchCount ?? "—"}</div>
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Keep the most important output visible, everything else in a menu */}
                            <Button
                              size="sm"
                              variant={txOk ? "default" : "outline"}
                              disabled={busy || !txOk}
                              onClick={() => downloadResultsPdf(e.id, "final")}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Final PDF
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" disabled={busy}>
                                  <MoreHorizontal className="h-4 w-4 mr-2" />
                                  Actions
                                </Button>
                              </DropdownMenuTrigger>

                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel>Generate</DropdownMenuLabel>
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    disabled={busy || hasManifest}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      runFn(e.id, "generate-election-manifest");
                                    }}
                                  >
                                    <FileText className="h-4 w-4 mr-2" />
                                    Manifest
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    disabled={busy || !hasManifest || hasRoot}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      runFn(e.id, "anchor-election-root");
                                    }}
                                  >
                                    <Layers className="h-4 w-4 mr-2" />
                                    Anchor root
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    disabled={busy || !hasManifest || !hasRoot}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      runFn(e.id, "generate-zk-tally-witness");
                                    }}
                                  >
                                    <ShieldCheck className="h-4 w-4 mr-2" />
                                    Witness
                                  </DropdownMenuItem>

<DropdownMenuItem
  disabled={busy || !hasManifest || !hasRoot || !artifactsReady || proofExists}
  onSelect={(eSelect) => {
    eSelect.preventDefault();
    void handleGenerateProof(e.id);
  }}
>
  <ShieldCheck className="h-4 w-4 mr-2" />
  Proof
</DropdownMenuItem>


                                  <DropdownMenuItem
                                    disabled={busy || !proofExists}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      void handleVerifyProof(e.id);
                                    }}
                                  >
                                    <ShieldCheck className="h-4 w-4 mr-2" />
                                    Verify proof
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    disabled={busy || !submitReady}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      void handleSubmitProof(e.id);
                                    }}
                                  >
                                    <Play className="h-4 w-4 mr-2" />
                                    Submit proof
                                  </DropdownMenuItem>

                                </DropdownMenuGroup>

                                <DropdownMenuSeparator />

                                <DropdownMenuLabel>Inspect</DropdownMenuLabel>
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    disabled={busy || !hasManifest}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      void downloadManifestJson(e.id);
                                    }}
                                  >
                                    <FileJson className="h-4 w-4 mr-2" />
                                    Manifest JSON
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    disabled={busy || !proof}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      void downloadProofJson(e.id);
                                    }}
                                  >
                                    <FileJson className="h-4 w-4 mr-2" />
                                    Proof JSON
                                  </DropdownMenuItem>


                                  <DropdownMenuItem
                                    disabled={busy || !proof?.public_signals_json_url}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      void downloadPublicSignalsJson(e.id);
                                    }}
                                  >
                                    <FileJson className="h-4 w-4 mr-2" />
                                    Public Signals JSON
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>

                                <DropdownMenuSeparator />

                                <DropdownMenuLabel>Download</DropdownMenuLabel>
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    disabled={busy || !proofOk}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      downloadResultsPdf(e.id, "draft");
                                    }}
                                  >
                                    <Download className="h-4 w-4 mr-2" />
                                    Draft PDF
                                  </DropdownMenuItem>

                                  <DropdownMenuItem
                                    disabled={busy || !txOk}
                                    onSelect={(eSelect) => {
                                      eSelect.preventDefault();
                                      downloadResultsPdf(e.id, "final");
                                    }}
                                  >
                                    <Download className="h-4 w-4 mr-2" />
                                    Final PDF
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            ZK testing table data
          </CardTitle>
          <CardDescription>
            This mirrors the fields typically needed for thesis, QA, or acceptance-test result tables. The “ZKP Generated Tally” column is filled after running a proof from this page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test Case</TableHead>
                  <TableHead>Election / Position</TableHead>
                  <TableHead>No. of Votes</TableHead>
                  <TableHead>Expected Tally</TableHead>
                  <TableHead>ZKP Generated Tally</TableHead>
                  <TableHead>Proof Verification</TableHead>
                  <TableHead>Privacy Preserved</TableHead>
                  <TableHead>Finalization Status</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : testingRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      No finalized tally rows yet. Finalize an election and refresh to populate this table.
                    </TableCell>
                  </TableRow>
                ) : (
                  testingRows.map((row, index) => (
                    <TableRow key={toTestingRowKey(row.electionId, row.position)}>
                      <TableCell className="text-xs">{index + 1}</TableCell>
                      <TableCell>
                        <div className="text-xs">
                          <div className="font-medium">{row.position}</div>
                          <div className="text-muted-foreground">{row.electionTitle}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{row.votesCount}</TableCell>
                      <TableCell className="text-xs">{row.expectedTally}</TableCell>
                      <TableCell className="text-xs">{row.generatedTally}</TableCell>
                      <TableCell className="text-xs">{row.proofVerification}</TableCell>
                      <TableCell className="text-xs">{row.privacyPreserved}</TableCell>
                      <TableCell className="text-xs">{row.finalizationStatus}</TableCell>
                      <TableCell>
                        <Badge variant={row.remarks === "PASS" ? "default" : row.remarks === "PENDING" ? "secondary" : "outline"}>
                          {row.remarks}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
