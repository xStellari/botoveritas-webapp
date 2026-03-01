import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, FileText, Layers, ShieldCheck, Download, CheckCircle2, Circle, Upload, Play } from "lucide-react";

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
  updated_at: string | null;
};

function shortHex(hex: string, keep = 10) {
  const h = String(hex || "");
  if (!h) return "—";
  if (h.length <= keep * 2) return h;
  return `${h.slice(0, keep)}…${h.slice(-keep)}`;
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

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function StatusPill(props: { isFinal: boolean; hasManifest: boolean; hasChunks: boolean; hasRoot: boolean; hasArtifacts: boolean; proofOk: boolean }) {
  const { isFinal, hasManifest, hasChunks, hasRoot, hasArtifacts, proofOk } = props;

  // Overall state color: green-ish when ready to generate witness, otherwise neutral.
  const variant = hasManifest && hasRoot && hasArtifacts ? "default" : "secondary";

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
      <Item label="Artifacts" ok={hasArtifacts} />
      <span className="opacity-60">•</span>
      <Item label="Proof" ok={proofOk} />
      <span className="opacity-60">•</span>
      <Item label="Artifacts" ok={hasArtifacts} />
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

  const [artifactTarget, setArtifactTarget] = useState<string | null>(null);
  const artifactInputRef = useRef<HTMLInputElement | null>(null);


  const finalized = useMemo(
    () => elections.filter((e) => Boolean(e.is_final) && !Boolean(e.is_archived)),
    [elections],
  );

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
  .select("election_id,status,tx_hash,updated_at");

if (pErr) throw pErr;

const pMap: Record<string, ProofRow> = {};
for (const p of (pData ?? []) as unknown as ProofRow[]) pMap[p.election_id] = p;
setProofs(pMap);

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
        body: JSON.stringify({ electionId }),
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


const pickArtifacts = (electionId: string) => {
  setArtifactTarget(electionId);
  artifactInputRef.current?.click();
};

const handleArtifactInput = async (files: FileList | null) => {
  const electionId = artifactTarget;
  setArtifactTarget(null);
  if (!electionId || !files || files.length === 0) return;

  const manifestHash = manifests[electionId]?.manifest_hash;
  if (!manifestHash) {
    toast.error("Generate manifest first (needed to pin artifacts by manifest hash).");
    return;
  }

  const wasmFile = Array.from(files).find((f) => f.name.endsWith("tally.wasm"));
  const zkeyFile = Array.from(files).find((f) => f.name.endsWith("tally_final.zkey"));
  const vkeyFile = Array.from(files).find((f) => f.name.endsWith("verification_key.json"));

  if (!wasmFile || !zkeyFile || !vkeyFile) {
    toast.error("Select 3 files: tally.wasm, tally_final.zkey, verification_key.json");
    return;
  }

  const base = `tally/BV_TALLY_V1/${manifestHash}`;
  const wasmKey = `${base}/tally_js/tally.wasm`;
  const zkeyKey = `${base}/tally_final.zkey`;
  const vkeyKey = `${base}/verification_key.json`;

  setWorking(`artifacts:${electionId}`);
  try {
    // Upload pinned artifacts (admin-only bucket). Hashing is verified server-side via attach-zk-artifacts.
    const up1 = await supabase.storage.from("zk-artifacts").upload(wasmKey, wasmFile, { upsert: true, contentType: "application/wasm" });
    if (up1.error) throw up1.error;
    const up2 = await supabase.storage.from("zk-artifacts").upload(zkeyKey, zkeyFile, { upsert: true, contentType: "application/octet-stream" });
    if (up2.error) throw up2.error;
    const up3 = await supabase.storage.from("zk-artifacts").upload(vkeyKey, vkeyFile, { upsert: true, contentType: "application/json" });
    if (up3.error) throw up3.error;

    const { data, error } = await supabase.functions.invoke("attach-zk-artifacts", {
      body: { electionId, wasmKey, zkeyKey, vkeyKey },
    });
    if (error) throw error;

    toast.success("Artifacts uploaded + pinned to manifest");
    console.log("attach-zk-artifacts", data);
  } catch (e: any) {
    console.error("[ZKTally] artifact upload failed", e);
    toast.error(`Artifacts failed: ${e?.message ?? String(e)}`);
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
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : finalized.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
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
                    const proofOk = !!proof && ["proved", "submitted", "confirmed"].includes(String(proof.status));
                    const txOk = !!proof?.tx_hash;

                    const artifacts = (manifest as any)?.manifest?.artifacts;
                    const hasArtifacts = Boolean(
                      artifacts?.wasm?.key && artifacts?.zkey?.key && artifacts?.vkey?.key,
                    );


                    const busy =
                      working?.endsWith(`:${e.id}`) ||
                      working === `pdf:${e.id}` || working === `artifacts:${e.id}`;

                    return (
                      <TableRow key={e.id}>
                        <TableCell>
                          <div className="font-medium">{e.title}</div>
                          <div className="text-xs text-muted-foreground">{e.id}</div>
                        </TableCell>

                        <TableCell>
                          <StatusPill
                            isFinal={Boolean(e.is_final)}
                            hasManifest={hasManifest}
                            hasChunks={Boolean(chunks?.chunkCount)}
                            hasRoot={hasRoot}
                            hasArtifacts={hasArtifacts}
                            proofOk={proofOk}
                          />
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

                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || hasManifest}
                              onClick={() => runFn(e.id, "generate-election-manifest")}
                            >
                              <FileText className="h-4 w-4 mr-2" />
                              Manifest
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || !hasManifest || hasRoot}
                              onClick={() => runFn(e.id, "anchor-election-root")}
                            >
                              <Layers className="h-4 w-4 mr-2" />
                              Anchor root
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || !hasManifest || !hasRoot}
                              onClick={() => runFn(e.id, "generate-zk-tally-witness")}
                            >
                              <ShieldCheck className="h-4 w-4 mr-2" />
                              Witness
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || !hasManifest}
                              onClick={() => runFn(e.id, "generate-tally-circuit")}
                            >
                              <FileText className="h-4 w-4 mr-2" />
                              Circuit
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || !proofOk}
                              onClick={() => downloadResultsPdf(e.id, "draft")}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Draft PDF
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy || !txOk}
                              onClick={() => downloadResultsPdf(e.id, "final")}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Final PDF
                            </Button>
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
    </div>
  );
}
