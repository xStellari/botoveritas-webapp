import { Buffer } from "buffer";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RefreshCw, FileText, Layers, ShieldCheck, Download,
  CheckCircle2, Circle, Play, FileJson, MoreHorizontal,
  Cpu, AlertCircle, Activity, Zap, ChevronDown, ChevronUp,
  Search, X, Lock,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ElectionRow = {
  id: string;
  title: string;
  end_date: string;
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

type TallyPreviewPosition = {
  title: string;
  abstain: number;
  totalBallots: number;
  candidates: Array<{ id: string; name: string; votes: number }>;
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

type VerifyProofRow = {
  election_id: string;
  status: string | null;
  manifest_hash: string;
  election_vote_root: string;
  results_hash: string;
  proof_json_url: string | null;
  public_signals_json_url: string | null;
};

if (!(globalThis as any).Buffer) (globalThis as any).Buffer = Buffer;

const UNIVERSAL_CIRCUIT_VERSION = "BV_TALLY_UNIVERSAL_V1";
const UNIVERSAL_ARTIFACT_BASE = `tally/${UNIVERSAL_CIRCUIT_VERSION}`;

// ─── Utilities ────────────────────────────────────────────────────────────────

function shortHex(hex: string, keep = 8) {
  const h = String(hex || "");
  if (!h) return "—";
  if (h.length <= keep * 2) return h;
  return `${h.slice(0, keep)}…${h.slice(-6)}`;
}

function fmtMs(ms?: number) {
  if (typeof ms !== "number" || Number.isNaN(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
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

async function downloadStorageBlob(bucket: string, key: string) {
  const { data, error } = await supabase.storage.from(bucket).download(key);
  if (error) throw error;
  return data;
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

async function downloadManifestJson(electionId: string) {
  const { data, error } = await supabase.from("election_manifests").select("*").eq("election_id", electionId).maybeSingle();
  if (error) { toast.error(`Failed to load manifest row: ${error.message}`); return; }
  if (!data) { toast.error("No manifest row found for this election."); return; }
  downloadJson(`manifest.${electionId}.${Date.now()}.json`, data);
}

async function downloadProofJson(electionId: string) {
  const { data, error } = await supabase.from("election_tally_proofs").select("*").eq("election_id", electionId).maybeSingle();
  if (error) { toast.error(`Failed to load proof row: ${error.message}`); return; }
  if (!data) { toast.error("No proof row found for this election."); return; }
  if (data.proof_json_url) {
    try {
      const blob = await downloadStorageBlob("zk-proofs", String(data.proof_json_url));
      downloadBlob(`proof.${electionId}.${Date.now()}.json`, blob);
      return;
    } catch (e: any) { toast.error(`Failed to download proof.json: ${e?.message}`); return; }
  }
  downloadJson(`proof-row.${electionId}.${Date.now()}.json`, data);
}

async function downloadPublicSignalsJson(electionId: string) {
  const { data, error } = await supabase.from("election_tally_proofs").select("*").eq("election_id", electionId).maybeSingle();
  if (error) { toast.error(`Failed to load proof row: ${error.message}`); return; }
  if (!data?.public_signals_json_url) { toast.error("No publicSignals.json path found."); return; }
  try {
    const blob = await downloadStorageBlob("zk-proofs", String(data.public_signals_json_url));
    downloadBlob(`publicSignals.${electionId}.${Date.now()}.json`, blob);
  } catch (e: any) { toast.error(`Failed to download publicSignals.json: ${e?.message}`); }
}

// ─── Pipeline Step indicator ──────────────────────────────────────────────────

const PIPELINE_STEPS = ["Finalized", "Manifest", "Chunks", "Root", "Proof", "Verified", "On-chain"] as const;

function PipelineRail(props: {
  isFinal: boolean; hasManifest: boolean; hasChunks: boolean; hasRoot: boolean;
  artifactsReady: boolean; proofOk: boolean; proofVerified: boolean; txOk: boolean;
}) {
  const states = [
    props.isFinal,
    props.hasManifest,
    props.hasChunks,
    props.hasRoot,
    props.proofOk,
    props.proofVerified,
    props.txOk,
  ];

  // Find the first incomplete step — that's "active"
  const activeIndex = states.findIndex((s) => !s);

  return (
    <div className="flex items-center gap-0">
      {PIPELINE_STEPS.map((label, i) => {
        const done = states[i];
        const active = i === activeIndex;
        const isLast = i === PIPELINE_STEPS.length - 1;

        return (
          <div key={label} className="flex items-center">
            {/* Node */}
            <div className="flex items-center gap-1.5">
              {done ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
              ) : (
                <Circle className={`h-3.5 w-3.5 shrink-0 ${active ? "text-muted-foreground" : "text-muted-foreground/25"}`} />
              )}
              <span className={`text-xs whitespace-nowrap ${
                done ? "text-foreground font-medium"
                : active ? "text-muted-foreground"
                : "text-muted-foreground/40"
              }`}>
                {label}
              </span>
            </div>
            {/* Connector */}
            {!isLast && (
              <div className={`w-5 h-px mx-1.5 ${done ? "bg-border" : "bg-border/40"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Election Card ────────────────────────────────────────────────────────────

type ElectionCardProps = {
  e: ElectionRow;
  manifest: ManifestRow | undefined;
  chunks: { chunkCount: number; totalLeaves: number; lastChunkAt: string | null } | undefined;
  root: RootRow | undefined;
  proof: ProofRow | undefined;
  run: ZkRunResult | undefined;
  artifactsReady: boolean;
  busy: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onAction: (fn: string) => void;
  onGenerateProof: () => void;
  onVerifyProof: () => void;
  onSubmitProof: () => void;
  onDownloadManifest: () => void;
  onDownloadProof: () => void;
  onDownloadSignals: () => void;
  onDraftPdf: () => void;
  onFinalPdf: () => void;
};

function ElectionCard({
  e, manifest, chunks, root, proof, run,
  artifactsReady, busy, expanded, onToggleExpand,
  onAction, onGenerateProof, onVerifyProof, onSubmitProof,
  onDownloadManifest, onDownloadProof, onDownloadSignals,
  onDraftPdf, onFinalPdf,
}: ElectionCardProps) {
  const hasManifest = !!manifest;
  const hasRoot = !!root;
  const proofExists = !!proof;
  const proofStatus = String(proof?.status ?? "").toLowerCase();
  const proofOk = !!proof && ["proved", "submitted", "confirmed", "verified"].includes(proofStatus);
  const proofVerified = proofStatus === "verified";
  const txOk = !!proof?.tx_hash;
  const submitReady = proofExists && proofVerified && !txOk;

  // Overall health for left accent
  const health = txOk ? "complete" : proofVerified ? "verified" : proofOk ? "partial" : proofExists && !proofOk ? "error" : "pending";
  const accentClass = {
    complete: "border-l-primary",
    verified: "border-l-primary/60",
    partial: "border-l-yellow-500/60",
    error: "border-l-destructive/60",
    pending: "border-l-border",
  }[health];

  return (
    <div className={`rounded-lg border border-l-4 bg-card overflow-hidden transition-all ${accentClass}`}>

      {/* ── Header (always visible) ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors select-none"
        onClick={onToggleExpand}
      >
        {/* Expand toggle */}
        <div className="text-muted-foreground/50 shrink-0">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>

        {/* Title + ID */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{e.title}</span>
            {busy && <Activity className="h-3.5 w-3.5 text-muted-foreground animate-pulse shrink-0" />}
            {proofExists && (
              <Badge
                variant={proofVerified ? "default" : proofStatus === "verify_failed" ? "destructive" : "secondary"}
                className="text-xs"
              >
                {txOk ? "On-chain" : proofVerified ? "Verified" : proof.status ?? "Stored"}
              </Badge>
            )}
          </div>
          {/* Pipeline rail inline in collapsed state */}
          {!expanded && (
            <div className="mt-1.5 overflow-x-auto">
              <PipelineRail
                isFinal={Boolean(e.is_final)}
                hasManifest={hasManifest}
                hasChunks={Boolean(chunks?.chunkCount)}
                hasRoot={hasRoot}
                artifactsReady={artifactsReady}
                proofOk={proofOk}
                proofVerified={proofVerified}
                txOk={txOk}
              />
            </div>
          )}
        </div>

        {/* Actions — stop propagation so clicking buttons doesn't toggle card */}
        <div className="flex items-center gap-2 shrink-0" onClick={(ev) => ev.stopPropagation()}>
          {txOk && (
            <Button size="sm" disabled={busy} onClick={onFinalPdf}>
              <Download className="h-4 w-4 mr-2" />
              Final PDF
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={busy}>
                <MoreHorizontal className="h-4 w-4 mr-1.5" />
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Generate</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={busy || hasManifest} onSelect={(ev) => { ev.preventDefault(); onAction("generate-election-manifest"); }}>
                  <FileText className="h-4 w-4 mr-2" /> Manifest
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || !hasManifest || hasRoot} onSelect={(ev) => { ev.preventDefault(); onAction("anchor-election-root"); }}>
                  <Layers className="h-4 w-4 mr-2" /> Anchor Root
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || !hasManifest || !hasRoot} onSelect={(ev) => { ev.preventDefault(); onAction("generate-zk-tally-witness"); }}>
                  <ShieldCheck className="h-4 w-4 mr-2" /> Witness
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || !hasManifest || !hasRoot || !artifactsReady || proofExists} onSelect={(ev) => { ev.preventDefault(); onGenerateProof(); }}>
                  <Zap className="h-4 w-4 mr-2" /> Generate Proof
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || !proofExists} onSelect={(ev) => { ev.preventDefault(); onVerifyProof(); }}>
                  <ShieldCheck className="h-4 w-4 mr-2" /> Verify Proof
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || !submitReady} onSelect={(ev) => { ev.preventDefault(); onSubmitProof(); }}>
                  <Play className="h-4 w-4 mr-2" /> Submit On-chain
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Inspect</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={busy || !hasManifest} onSelect={(ev) => { ev.preventDefault(); onDownloadManifest(); }}>
                  <FileJson className="h-4 w-4 mr-2" /> Manifest JSON
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || !proofExists} onSelect={(ev) => { ev.preventDefault(); onDownloadProof(); }}>
                  <FileJson className="h-4 w-4 mr-2" /> Proof JSON
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || !proof?.public_signals_json_url} onSelect={(ev) => { ev.preventDefault(); onDownloadSignals(); }}>
                  <FileJson className="h-4 w-4 mr-2" /> Public Signals JSON
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Export</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={busy || !proofOk} onSelect={(ev) => { ev.preventDefault(); onDraftPdf(); }}>
                  <Download className="h-4 w-4 mr-2" /> Draft PDF
                </DropdownMenuItem>
                <DropdownMenuItem disabled={busy || !txOk} onSelect={(ev) => { ev.preventDefault(); onFinalPdf(); }}>
                  <Download className="h-4 w-4 mr-2" /> Final PDF
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Expanded content ── */}
      {expanded && (
        <>
          {/* Pipeline rail (larger, full width) */}
          <div className="px-4 py-3 bg-muted/20 border-t overflow-x-auto">
            <PipelineRail
              isFinal={Boolean(e.is_final)}
              hasManifest={hasManifest}
              hasChunks={Boolean(chunks?.chunkCount)}
              hasRoot={hasRoot}
              artifactsReady={artifactsReady}
              proofOk={proofOk}
              proofVerified={proofVerified}
              txOk={txOk}
            />
          </div>

          {/* Election ID */}
          <div className="px-4 py-2 border-t bg-muted/10">
            <span className="text-xs text-muted-foreground font-mono">{e.id}</span>
            {e.finalized_at && (
              <span className="text-xs text-muted-foreground ml-3">
                Finalized {new Date(e.finalized_at).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Data columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 border-t">
            <div className="px-4 py-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Manifest hash</p>
              {manifest ? (
                <>
                  <p className="font-mono text-xs font-medium">{shortHex(manifest.manifest_hash)}</p>
                  <p className="text-xs text-muted-foreground">{new Date(manifest.updated_at).toLocaleDateString()}</p>
                </>
              ) : <p className="text-xs text-muted-foreground">Not generated</p>}
            </div>

            <div className="px-4 py-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Chunks / Leaves</p>
              {chunks?.chunkCount ? (
                <>
                  <p className="text-xs font-medium">{chunks.chunkCount} chunk{chunks.chunkCount !== 1 ? "s" : ""}</p>
                  <p className="text-xs text-muted-foreground">{chunks.totalLeaves} leaves</p>
                </>
              ) : <p className="text-xs text-muted-foreground">No chunks yet</p>}
            </div>

            <div className="px-4 py-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Vote root</p>
              {root ? (
                <>
                  <p className="font-mono text-xs font-medium">{shortHex(root.election_vote_root)}</p>
                  <p className="text-xs text-muted-foreground">{root.chunk_count} chunk{root.chunk_count !== 1 ? "s" : ""} anchored</p>
                </>
              ) : <p className="text-xs text-muted-foreground">Not anchored</p>}
            </div>

            <div className="px-4 py-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">On-chain tx</p>
              {txOk ? (
                <>
                  <p className="font-mono text-xs font-medium">{shortHex(proof!.tx_hash!)}</p>
                  <p className="text-xs text-muted-foreground">{proof?.chain ?? "—"}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{proof ? "Not submitted yet" : "No proof yet"}</p>
              )}
            </div>
          </div>

          {/* Run diagnostics */}
          {run && (
            <div className="flex items-center flex-wrap gap-x-5 gap-y-1 px-4 py-2.5 border-t bg-muted/10 text-xs text-muted-foreground">
              <span>Gen <span className="text-foreground font-medium">{fmtMs(run.genMs)}</span></span>
              <span>Verify <span className="text-foreground font-medium">{fmtMs(run.verifyMs)}</span></span>
              {run.accuracy != null && (
                <span>Accuracy <span className="text-foreground font-medium">{run.accuracy.toFixed(1)}%</span></span>
              )}
              {run.positionsTotal != null && (
                <span>Positions <span className="text-foreground font-medium">{run.positionsMatched}/{run.positionsTotal}</span></span>
              )}
              {(run.mismatchCount ?? 0) > 0 && (
                <Badge variant="destructive" className="text-xs py-0 h-5">
                  {run.mismatchCount} mismatch{(run.mismatchCount ?? 0) !== 1 ? "es" : ""}
                </Badge>
              )}
            </div>
          )}

          {/* Error */}
          {proof?.error_message && (
            <div className="flex items-center gap-2 px-4 py-2 border-t bg-destructive/5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {proof.error_message}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ZKTally() {
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [manifests, setManifests] = useState<Record<string, ManifestRow>>({});
  const [chunkStats, setChunkStats] = useState<Record<string, { chunkCount: number; totalLeaves: number; lastChunkAt: string | null }>>({});
  const [roots, setRoots] = useState<Record<string, RootRow>>({});
  const [proofs, setProofs] = useState<Record<string, ProofRow>>({});
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

  const filteredElections = useMemo(() => {
    if (!search.trim()) return finalized;
    const q = search.toLowerCase();
    return finalized.filter((e) =>
      e.title.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
    );
  }, [finalized, search]);

  // Elections that have ended but not yet been finalized — shown in the "Ready to Finalize" card
  const readyToFinalize = useMemo(
    () => elections.filter((e) => !e.is_final && !e.is_archived && new Date(e.end_date) < new Date()),
    [elections],
  );

  const [finalizing, setFinalizing] = useState<string | null>(null);

  const finalizeElection = async (electionId: string) => {
    setFinalizing(electionId);
    try {
      const { error } = await supabase
        .from("elections")
        .update({ is_final: true, finalized_at: new Date().toISOString() })
        .eq("id", electionId);
      if (error) throw error;
      toast.success("Election finalized and moved to ZK pipeline.");
      await load();
    } catch (e: any) {
      toast.error(`Finalization failed: ${e?.message ?? String(e)}`);
    } finally {
      setFinalizing(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedIds(new Set(filteredElections.map((e) => e.id)));
  const collapseAll = () => setExpandedIds(new Set());

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
      toast.error(`Artifact check failed: ${e?.message ?? String(e)}`);
    } finally {
      setArtifactChecking(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data: eData, error: eErr } = await supabase.from("elections").select("id,title,end_date,is_final,is_archived,finalized_at").order("created_at", { ascending: false });
      if (eErr) throw eErr;
      setElections((eData ?? []) as ElectionRow[]);

      const { data: mData, error: mErr } = await supabase.from("election_manifests").select("election_id,manifest_hash,updated_at,manifest");
      if (mErr) throw mErr;
      const mMap: Record<string, ManifestRow> = {};
      for (const r of (mData ?? []) as ManifestRow[]) mMap[r.election_id] = r;
      setManifests(mMap);

      const { data: cData, error: cErr } = await supabase.from("election_vote_chunks").select("election_id,chunk_index,leaf_count,chunk_root,created_at").order("chunk_index", { ascending: true });
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

      const { data: rData, error: rErr } = await supabase.from("election_vote_roots" as any).select("election_id,election_vote_root,chunk_count,computed_at");
      if (rErr) throw rErr;
      const rMap: Record<string, RootRow> = {};
      for (const r of (rData ?? []) as unknown as RootRow[]) rMap[r.election_id] = r;
      setRoots(rMap);

      const { data: pData, error: pErr } = await supabase.from("election_tally_proofs" as any).select("election_id,status,tx_hash,registry_address,verifier_address,chain,proof_json_url,public_signals_json_url,error_message,updated_at");
      if (pErr) throw pErr;
      const pMap: Record<string, ProofRow> = {};
      for (const p of (pData ?? []) as unknown as ProofRow[]) pMap[p.election_id] = p;
      setProofs(pMap);
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshArtifactPresence();
    load();
    const channel = supabase
      .channel("admin-zk-tally")
      .on("postgres_changes", { event: "*", schema: "public", table: "elections" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "election_manifests" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "election_vote_chunks" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "election_vote_roots" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "election_tally_proofs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runFn = async (electionId: string, fnName: string) => {
    setWorking(`${fnName}:${electionId}`);
    try {
      const { data, error } = await supabase.functions.invoke(fnName, { body: { electionId } });
      if (error) throw error;
      if (fnName === "generate-zk-tally-witness" && data?.witness) {
        downloadJson(`zk-witness.${electionId}.${Date.now()}.json`, data);
        toast.success("Witness generated and downloaded");
      } else if (fnName === "generate-tally-circuit" && data?.circom) {
        if (data?.meta) downloadJson(`tally.meta.${electionId}.${Date.now()}.json`, data.meta);
        downloadText(`tally.${electionId}.${Date.now()}.circom`, String(data.circom));
        toast.success("Circuit + meta downloaded");
      } else {
        toast.success(`${fnName} completed`);
      }
      return data;
    } catch (e: any) {
      const status = e?.context?.status ?? e?.status;
      const body = e?.context?.body ?? e?.context?.json ?? null;
      const msg = (body && (body.error || body.message)) || e?.message || String(e);
      if (status === 409) { toast.info(msg); return null; }
      if (status === 401 || status === 403) { toast.error(msg || "Unauthorized"); return null; }
      toast.error(`${fnName} failed: ${msg}`);
      throw e;
    } finally {
      setWorking(null);
      await load();
    }
  };

  const handleGenerateProof = async (electionId: string) => {
    setWorking(`generate-tally-proof:${electionId}`);
    try {
      if (!manifests[electionId]?.manifest_hash) { toast.error("Generate manifest first."); return; }
      if (!artifactsReady) { toast.error("Universal tally artifacts are missing."); return; }
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) { toast.error("Please sign in again."); return; }
      toast.message("Generating ZK proof on backend…");
      const response = await fetch("/api/zk/run.ts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ electionId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
      if (!payload?.proofGenerated) throw new Error(payload?.details || payload?.error || "Backend prover did not generate a proof.");
      setZkRuns((c) => ({ ...c, [electionId]: payload as ZkRunResult }));
      if (payload?.proofVerified) toast.success(`Proof verified on backend in ${payload?.genMs ?? 0}ms`);
      else toast.warning("Proof generated, backend self-verify failed.");
    } catch (e: any) {
      toast.error(`Generate proof failed: ${e?.message || String(e)}`);
    } finally {
      setWorking(null);
      await load();
    }
  };

  const handleSubmitProof = async (electionId: string) => {
    setWorking(`submit-tally-proof:${electionId}`);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) { toast.error("Please sign in again."); return; }
      toast.message("Submitting tally proof on-chain…");
      const response = await fetch("/api/zk/submit.ts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ electionId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
      toast.success(`Proof submitted. Tx: ${payload?.txHash ?? "(pending)"}`);
    } catch (e: any) {
      toast.error(`Submit proof failed: ${e?.message || String(e)}`);
    } finally {
      setWorking(null);
      await load();
    }
  };

  const handleVerifyProof = async (electionId: string) => {
    const toastId = toast.loading("Verifying proof…");
    setWorking(`verify-tally-proof:${electionId}`);
    try {
      const { data: proofRowData, error: proofErr } = await supabase.from("election_tally_proofs").select("election_id,status,manifest_hash,election_vote_root,results_hash,proof_json_url,public_signals_json_url").eq("election_id", electionId).maybeSingle();
      if (proofErr) throw proofErr;
      const proofRow = proofRowData as VerifyProofRow | null;
      if (!proofRow) throw new Error("No proof row found");
      if (!proofRow.proof_json_url || !proofRow.public_signals_json_url) throw new Error("Proof row missing file URLs");
      const { data: manifestRow, error: manifestErr } = await supabase.from("election_manifests").select("manifest").eq("election_id", electionId).maybeSingle();
      if (manifestErr) throw manifestErr;
      const artifacts = (manifestRow as any)?.manifest?.artifacts ?? {};
      const vkeyBucket = String(artifacts?.vkey?.bucket ?? "zk-artifacts");
      const vkeyKey = String(artifacts?.vkey?.key ?? `${UNIVERSAL_ARTIFACT_BASE}/verification_key.json`);
      const [proofBlob, publicSignalsBlob, verificationKeyBlob] = await Promise.all([
        downloadStorageBlob("zk-proofs", proofRow.proof_json_url),
        downloadStorageBlob("zk-proofs", proofRow.public_signals_json_url),
        downloadStorageBlob(vkeyBucket, vkeyKey),
      ]);
      const [proof, publicSignalsRaw, verificationKey] = await Promise.all([blobToJson(proofBlob), blobToJson(publicSignalsBlob), blobToJson(verificationKeyBlob)]);
      if (!Array.isArray(publicSignalsRaw) || publicSignalsRaw.length < 4) throw new Error("publicSignals.json must contain at least 4 entries");
      const publicSignals = publicSignalsRaw.map((v) => normalizeField(v));
      const snarkjsMod = await import("snarkjs");
      const groth16 = (snarkjsMod as any).groth16 ?? (snarkjsMod as any).default?.groth16;
      if (!groth16?.verify) throw new Error("snarkjs.groth16.verify unavailable");
      const verified = await Promise.race<boolean>([
        groth16.verify(verificationKey, publicSignals, proof),
        new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error("Verification timed out after 45s")), 45000)),
      ]);
      const { error: updateErr } = await supabase.from("election_tally_proofs").update({
        status: verified ? "verified" : "verify_failed",
        error_message: verified ? null : "Groth16 verification failed",
        updated_at: new Date().toISOString(),
      } as any).eq("election_id", electionId);
      if (updateErr) console.warn("[ZKTally] status update failed", updateErr);
      if (verified) toast.success("Proof verified successfully.", { id: toastId });
      else toast.error("Verifier rejected the proof.", { id: toastId });
    } catch (e: any) {
      toast.error(`Verify failed: ${e?.message || String(e)}`, { id: toastId });
    } finally {
      setWorking(null);
      await load();
    }
  };

  const downloadResultsPdf = async (electionId: string, mode: "draft" | "final") => {
    setWorking(`pdf:${electionId}`);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Missing session token.");
      const baseUrl = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
      if (!baseUrl) throw new Error("Missing VITE_SUPABASE_URL");
      const res = await fetch(`${baseUrl}/functions/v1/generate-results-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ electionId, mode }),
      });
      if (!res.ok) { const text = await res.text(); throw new Error(text || `HTTP ${res.status}`); }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
      toast.success("PDF generated");
    } catch (e: any) {
      toast.error(`PDF failed: ${e?.message ?? String(e)}`);
    } finally {
      setWorking(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const artifactFiles = [
    { label: "Circuit WASM",     filename: "tally.wasm",            path: `${UNIVERSAL_ARTIFACT_BASE}/tally_js/tally.wasm`,   meta: artifactExisting.wasm },
    { label: "Proving Key",      filename: "tally_final.zkey",      path: `${UNIVERSAL_ARTIFACT_BASE}/tally_final.zkey`,      meta: artifactExisting.zkey },
    { label: "Verification Key", filename: "verification_key.json", path: `${UNIVERSAL_ARTIFACT_BASE}/verification_key.json`, meta: artifactExisting.vkey },
  ];

  const verifiedCount = Object.values(proofs).filter(p =>
    ["verified","submitted","confirmed"].includes(String(p.status ?? "").toLowerCase())
  ).length;

  return (
    <div className="space-y-6">

      {/* ── Artifacts Card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <div>
                <CardTitle className="text-base leading-tight">Universal Circuit Artifacts</CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  {UNIVERSAL_CIRCUIT_VERSION} — installed once, shared across all elections
                </CardDescription>
              </div>
              <Badge variant={artifactsReady ? "default" : "destructive"}>
                {artifactsReady ? "All installed" : "Incomplete"}
              </Badge>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshArtifactPresence()} disabled={artifactChecking}>
              <RefreshCw className={`h-4 w-4 mr-2 ${artifactChecking ? "animate-spin" : ""}`} />
              Check storage
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-3 gap-3">
            {artifactFiles.map((a) => (
              <div key={a.filename} className="rounded-md border bg-muted/30 px-3 py-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{a.label}</span>
                  <Badge variant={a.meta.exists ? "secondary" : "outline"}>
                    {a.meta.exists ? (a.meta.size ? `${(a.meta.size / (1024 * 1024)).toFixed(1)} MB` : "Present") : "Missing"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono truncate">{a.path}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Ready to Finalize Card ── */}
      {(readyToFinalize.length > 0 || loading) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <div>
                <CardTitle className="text-base leading-tight">Ready to Finalize</CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  These elections have ended and are awaiting finalization before entering the ZK pipeline.
                </CardDescription>
              </div>
              {readyToFinalize.length > 0 && (
                <Badge variant="destructive">{readyToFinalize.length} pending</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {loading ? (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-14 rounded-lg border bg-muted/20 animate-pulse" />
                ))}
              </div>
            ) : readyToFinalize.length === 0 ? (
              <p className="text-sm text-muted-foreground">No elections pending finalization.</p>
            ) : (
              readyToFinalize.map((e) => {
                const isBusy = finalizing === e.id;
                return (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{e.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Ended {new Date(e.end_date).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={isBusy || !!finalizing}
                      onClick={() => finalizeElection(e.id)}
                    >
                      {isBusy ? (
                        <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 mr-2" />
                      )}
                      {isBusy ? "Finalizing…" : "Finalize Election"}
                    </Button>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Pipeline Card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              <div>
                <CardTitle className="text-base leading-tight">ZK Tally Pipeline</CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  Proof generation, verification, and on-chain submission per election
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{finalized.length} finalized</Badge>
              <Badge variant="secondary">{Object.keys(manifests).length} manifests</Badge>
              <Badge variant="secondary">{verifiedCount} verified</Badge>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {errorMsg && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMsg}
            </div>
          )}

          {/* Search + expand controls */}
          {!loading && finalized.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search elections…"
                  value={search}
                  onChange={(ev) => setSearch(ev.target.value)}
                  className="pl-8 h-8 text-sm"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-8" onClick={expandAll}>
                Expand all
              </Button>
              <Button variant="ghost" size="sm" className="text-xs h-8" onClick={collapseAll}>
                Collapse all
              </Button>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 rounded-lg border bg-muted/20 animate-pulse" />
              ))}
            </div>
          ) : filteredElections.length === 0 ? (
            <div className="rounded-lg border border-dashed px-6 py-10 text-center">
              {search ? (
                <>
                  <p className="text-sm text-muted-foreground">No elections match "{search}"</p>
                  <Button variant="ghost" size="sm" className="mt-2 text-xs" onClick={() => setSearch("")}>Clear search</Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">No finalized elections found.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Finalize an election to begin the ZK proof pipeline.</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredElections.map((e) => {
                const busy = working?.endsWith(`:${e.id}`) || working === `pdf:${e.id}`;
                return (
                  <ElectionCard
                    key={e.id}
                    e={e}
                    manifest={manifests[e.id]}
                    chunks={chunkStats[e.id]}
                    root={roots[e.id]}
                    proof={proofs[e.id]}
                    run={zkRuns[e.id]}
                    artifactsReady={artifactsReady}
                    busy={busy}
                    expanded={expandedIds.has(e.id)}
                    onToggleExpand={() => toggleExpand(e.id)}
                    onAction={(fn) => runFn(e.id, fn)}
                    onGenerateProof={() => handleGenerateProof(e.id)}
                    onVerifyProof={() => handleVerifyProof(e.id)}
                    onSubmitProof={() => handleSubmitProof(e.id)}
                    onDownloadManifest={() => downloadManifestJson(e.id)}
                    onDownloadProof={() => downloadProofJson(e.id)}
                    onDownloadSignals={() => downloadPublicSignalsJson(e.id)}
                    onDraftPdf={() => downloadResultsPdf(e.id, "draft")}
                    onFinalPdf={() => downloadResultsPdf(e.id, "final")}
                  />
                );
              })}
            </div>
          )}

          {/* Result count when filtering */}
          {search && filteredElections.length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              Showing {filteredElections.length} of {finalized.length} elections
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
