import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import feuLogo from "@/assets/feu-logo.png";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  getPublicSignalMetadata,
  loadPublicTallyArtifacts,
  normalizePublicField,
  verifyPublicTallyProof,
} from "@/utils/zkTallyPublic";

type ProofRow = {
  election_id: string;
  status: string | null;
  manifest_hash: string | null;
  election_vote_root: string | null;
  results_hash: string | null;
  proof_json_url: string | null;
  public_signals_json_url: string | null;
  updated_at?: string | null;
};

type ManifestArtifacts = {
  vkey?: {
    bucket?: string | null;
    key?: string | null;
  } | null;
};

export default function VerifyTally() {
  const navigate = useNavigate();
  const { electionId = "" } = useParams();

  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<boolean | null>(null);
  const [error, setError] = useState<string>("");
  const [proofRow, setProofRow] = useState<ProofRow | null>(null);
  const [artifactPaths, setArtifactPaths] = useState<{ proofPath: string; publicSignalsPath: string; vkeyBucket: string; vkeyPath: string } | null>(null);
  const [signalMeta, setSignalMeta] = useState({
    electionIdHash: "",
    electionVoteRoot: "",
    manifestHash: "",
    resultsHash: "",
  });

  const dbChecks = useMemo(() => {
    return {
      electionVoteRootMatches:
        !!proofRow?.election_vote_root && signalMeta.electionVoteRoot === normalizePublicField(proofRow.election_vote_root),
      manifestHashMatches: !!proofRow?.manifest_hash && signalMeta.manifestHash === normalizePublicField(proofRow.manifest_hash),
      resultsHashMatches: !!proofRow?.results_hash && signalMeta.resultsHash === normalizePublicField(proofRow.results_hash),
    };
  }, [proofRow, signalMeta]);

  const runVerification = useCallback(async () => {
    if (!electionId) return;
    setLoading(true);
    setVerifying(true);
    setError("");
    setResult(null);

    try {
      const { data: proofData, error: proofErr } = await supabase
        .from("election_tally_proofs")
        .select("election_id,status,manifest_hash,election_vote_root,results_hash,proof_json_url,public_signals_json_url,updated_at")
        .eq("election_id", electionId)
        .maybeSingle();
      if (proofErr) throw proofErr;

      const row = (proofData ?? null) as ProofRow | null;
      if (!row) throw new Error("No tally proof was found for this election.");
      if (!row.proof_json_url || !row.public_signals_json_url) {
        throw new Error("This election does not have published proof.json or publicSignals.json yet.");
      }
      setProofRow(row);

      const { data: manifestData, error: manifestErr } = await supabase
        .from("election_manifests")
        .select("manifest")
        .eq("election_id", electionId)
        .maybeSingle();
      if (manifestErr) throw manifestErr;

      const artifacts = (((manifestData as any)?.manifest?.artifacts ?? {}) as ManifestArtifacts) ?? {};
      const vkeyBucket = String(artifacts?.vkey?.bucket ?? "zk-artifacts");
      const vkeyPath = String(
        artifacts?.vkey?.key ?? `tally/BV_TALLY_UNIVERSAL_V1/verification_key.json`,
      );

      const bundle = await loadPublicTallyArtifacts({
        proofPath: row.proof_json_url,
        publicSignalsPath: row.public_signals_json_url,
        vkeyBucket,
        vkeyPath,
      });

      setArtifactPaths({
        proofPath: bundle.proofPath,
        publicSignalsPath: bundle.publicSignalsPath,
        vkeyBucket: bundle.vkeyBucket,
        vkeyPath: bundle.vkeyPath,
      });
      setSignalMeta(getPublicSignalMetadata(bundle.publicSignals));

      const verified = await verifyPublicTallyProof(bundle);
      setResult(verified);

      if (verified) {
        toast.success("Proof verified successfully.");
      } else {
        toast.error("The verifier rejected this proof.");
      }
    } catch (e: any) {
      const message = e?.message || String(e);
      setError(message);
      toast.error(`Public tally verification failed: ${message}`);
    } finally {
      setVerifying(false);
      setLoading(false);
    }
  }, [electionId]);

  useEffect(() => {
    void runVerification();
  }, [runVerification]);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50 via-white to-white">
      <header className="border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={feuLogo} alt="FEU" className="h-12" />
            <div className="leading-tight">
              <div className="font-extrabold text-lg text-emerald-900">BotoVeritas</div>
              <div className="text-xs text-muted-foreground">Public ZK Tally Verification</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" className="border-emerald-200 text-emerald-800" onClick={() => navigate("/verify")}>Back</Button>
            <Button variant="outline" onClick={() => void runVerification()} disabled={verifying}>
              {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Re-verify
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
          <div className="space-y-2">
            <Link to="/verify" className="inline-flex items-center gap-2 text-sm text-emerald-800 hover:underline">
              <ArrowLeft className="h-4 w-4" />
              Back to public verification hub
            </Link>
            <h1 className="text-4xl font-bold bg-gradient-hero bg-clip-text text-transparent">Verify election tally proof</h1>
            <p className="text-sm md:text-base text-muted-foreground max-w-3xl">
              This page fetches the published tally artifacts from Supabase Storage and runs browser-side
              <span className="font-mono"> snarkjs.groth16.verify</span> so anyone can independently validate the published result.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            <Card className="p-6 rounded-2xl border-2 border-emerald-200 lg:col-span-2">
              <div className="flex items-start gap-3">
                <div className={`p-3 rounded-xl border ${result ? "bg-emerald-50 border-emerald-200" : result === false ? "bg-rose-50 border-rose-200" : "bg-slate-50 border-slate-200"}`}>
                  {verifying || loading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-slate-700" />
                  ) : result ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-700" />
                  ) : result === false ? (
                    <ShieldAlert className="h-6 w-6 text-rose-700" />
                  ) : (
                    <ShieldCheck className="h-6 w-6 text-slate-700" />
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-lg">Verification status</h2>
                    {verifying || loading ? (
                      <Badge variant="secondary">Running</Badge>
                    ) : result ? (
                      <Badge className="bg-emerald-700 hover:bg-emerald-700">VALID</Badge>
                    ) : result === false ? (
                      <Badge variant="destructive">INVALID</Badge>
                    ) : (
                      <Badge variant="secondary">Pending</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground break-all">Election ID: <span className="font-mono">{electionId}</span></p>
                  <p className="text-sm text-muted-foreground">
                    Stored proof status: <span className="font-semibold text-foreground">{proofRow?.status ?? "not loaded"}</span>
                  </p>
                  {proofRow?.updated_at ? (
                    <p className="text-xs text-muted-foreground">Last updated: {new Date(proofRow.updated_at).toLocaleString()}</p>
                  ) : null}
                  {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
                </div>
              </div>
            </Card>

            <Card className="p-6 rounded-2xl border bg-white">
              <h3 className="font-bold text-emerald-900 mb-3">Published artifacts</h3>
              <div className="space-y-3 text-xs text-muted-foreground break-all">
                <div><div className="font-semibold text-foreground">proof.json</div>{artifactPaths?.proofPath ?? proofRow?.proof_json_url ?? "—"}</div>
                <div><div className="font-semibold text-foreground">publicSignals.json</div>{artifactPaths?.publicSignalsPath ?? proofRow?.public_signals_json_url ?? "—"}</div>
                <div><div className="font-semibold text-foreground">verification_key.json</div>{artifactPaths ? `${artifactPaths.vkeyBucket}/${artifactPaths.vkeyPath}` : "—"}</div>
              </div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card className="p-6 rounded-2xl border bg-white">
              <h3 className="font-bold text-emerald-900 mb-4">Election metadata</h3>
              <div className="space-y-4 text-sm">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Manifest hash</div>
                  <div className="font-mono break-all">{signalMeta.manifestHash || normalizePublicField(proofRow?.manifest_hash) || "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vote root</div>
                  <div className="font-mono break-all">{signalMeta.electionVoteRoot || normalizePublicField(proofRow?.election_vote_root) || "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Results hash</div>
                  <div className="font-mono break-all">{signalMeta.resultsHash || normalizePublicField(proofRow?.results_hash) || "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Election ID hash (public signal)</div>
                  <div className="font-mono break-all">{signalMeta.electionIdHash || "—"}</div>
                </div>
              </div>
            </Card>

            <Card className="p-6 rounded-2xl border bg-white">
              <h3 className="font-bold text-emerald-900 mb-4">Consistency checks</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3"><span>Vote root matches stored metadata</span><Badge variant={dbChecks.electionVoteRootMatches ? "default" : "secondary"} className={dbChecks.electionVoteRootMatches ? "bg-emerald-700 hover:bg-emerald-700" : ""}>{dbChecks.electionVoteRootMatches ? "Match" : "Check"}</Badge></div>
                <div className="flex items-center justify-between gap-3"><span>Manifest hash matches stored metadata</span><Badge variant={dbChecks.manifestHashMatches ? "default" : "secondary"} className={dbChecks.manifestHashMatches ? "bg-emerald-700 hover:bg-emerald-700" : ""}>{dbChecks.manifestHashMatches ? "Match" : "Check"}</Badge></div>
                <div className="flex items-center justify-between gap-3"><span>Results hash matches stored metadata</span><Badge variant={dbChecks.resultsHashMatches ? "default" : "secondary"} className={dbChecks.resultsHashMatches ? "bg-emerald-700 hover:bg-emerald-700" : ""}>{dbChecks.resultsHashMatches ? "Match" : "Check"}</Badge></div>
              </div>
              <div className="mt-4 rounded-xl border bg-emerald-50 p-3 text-xs text-muted-foreground">
                Public verification is read-only. It does not update the proof row; it only verifies the published artifacts in the browser.
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
