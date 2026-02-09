import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/types/supabase";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, CircleMinus, Download, RefreshCcw } from "lucide-react";

type ElectionOption = { id: string; title: string };

type ElectionRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  is_active: boolean | null;
  is_final: boolean;
  is_archived: boolean;
};

type ProofCoverage = {
  election_id: string;
  title: string;
  voted: number;
  withTx: number;
  withToken: number;
};

type ArtifactReadiness = {
  election_id: string;
  title: string;
  hasManifest: boolean;
  chunkCount: number;
};

type AuthHealth = {
  totalEvents60m: number;
  topEventTypes: Array<{ event_type: string; count: number }>;
};

type SessionHealth = {
  activeSessions: number;
  expiringSoon: number;
  topActions60m: Array<{ action: string; count: number }>;
};

type OpsSnapshot = {
  proof: ProofCoverage[];
  artifacts: ArtifactReadiness[];
  auth: AuthHealth;
  sessions: SessionHealth;
};

type Status = "ok" | "warn" | "bad" | "na";

function statusLabel(s: Status) {
  switch (s) {
    case "ok":
      return "OK";
    case "warn":
      return "Needs attention";
    case "bad":
      return "Action required";
    case "na":
      return "N/A";
  }
}

function statusIcon(s: Status) {
  const cls =
    s === "ok"
      ? "text-emerald-600"
      : s === "warn"
      ? "text-amber-600"
      : s === "bad"
      ? "text-rose-600"
      : "text-muted-foreground";
  if (s === "ok") return <CheckCircle2 className={`h-5 w-5 ${cls}`} />;
  if (s === "warn") return <AlertTriangle className={`h-5 w-5 ${cls}`} />;
  if (s === "bad") return <CircleMinus className={`h-5 w-5 ${cls}`} />;
  return <CircleMinus className={`h-5 w-5 ${cls}`} />;
}

function downloadCSV(filename: string, rows: Array<Record<string, any>>) {
  if (!rows.length) {
    toast.message("Nothing to export.");
    return;
  }

  const headerSet = new Set<string>();
  for (const r of rows) Object.keys(r).forEach((k) => headerSet.add(k));
  const headers = [...headerSet];

  const escape = (val: any) => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [elections, setElections] = useState<ElectionOption[]>([]);
  const [selectedElectionId, setSelectedElectionId] = useState<string>("ALL");

  const [snapshot, setSnapshot] = useState<OpsSnapshot>({
    proof: [],
    artifacts: [],
    auth: { totalEvents60m: 0, topEventTypes: [] },
    sessions: { activeSessions: 0, expiringSoon: 0, topActions60m: [] },
  });

  const selectedLabel = useMemo(() => {
    if (selectedElectionId === "ALL") return "All elections";
    return elections.find((e) => e.id === selectedElectionId)?.title ?? "Selected election";
  }, [selectedElectionId, elections]);

  useEffect(() => {
    void loadOps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElectionId]);

  const loadOps = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      // 1) Elections list for scoping + labels
      const { data: electionsRaw, error: electionsError } = await supabase
        .from("elections")
        .select("id, title, start_date, end_date, is_active, is_final, is_archived")
        .order("start_date", { ascending: false });

      if (electionsError) throw electionsError;

      const electionRows = (electionsRaw || []) as unknown as ElectionRow[];
      setElections(electionRows.map((e) => ({ id: e.id, title: e.title })));

      const scoped = selectedElectionId === "ALL" ? electionRows : electionRows.filter((e) => e.id === selectedElectionId);
      // Helper: count rows with filters using head:true for lightweight queries
      // NOTE: supabase.from() is strongly typed to known table names; use the Database type for safety.
      type TableName = keyof Database["public"]["Tables"];
      const countWhere = async (table: TableName, apply: (q: any) => any) => {
        const { count, error } = await apply(
          supabase.from(table).select("id", { head: true, count: "exact" })
        );
        if (error) throw error;
        return count ?? 0;
      };

      // 2) Proof-of-vote coverage (voter_election_status)
      const proofRows: ProofCoverage[] = await Promise.all(
        scoped.map(async (e) => {
          const voted = await countWhere("voter_election_status", (q) =>
            q.eq("election_id", e.id).eq("has_voted", true)
          );
          const withTx = await countWhere("voter_election_status", (q) =>
            q.eq("election_id", e.id).eq("has_voted", true).not("tx_hash", "is", null)
          );
          const withToken = await countWhere("voter_election_status", (q) =>
            q.eq("election_id", e.id).eq("has_voted", true).not("nft_token_id", "is", null)
          );

          return { election_id: e.id, title: e.title, voted, withTx, withToken };
        })
      );

      // 3) ZK artifacts readiness (minimal signal only)
      const artifactRows: ArtifactReadiness[] = await Promise.all(
        scoped.map(async (e) => {
          const { data: manifest, error: manifestError } = await supabase
            .from("election_manifests")
            .select("id")
            .eq("election_id", e.id)
            .maybeSingle();

          if (manifestError) throw manifestError;

          const chunkCount = await countWhere("election_vote_chunks", (q) => q.eq("election_id", e.id));

          return { election_id: e.id, title: e.title, hasManifest: !!manifest?.id, chunkCount };
        })
      );

      // 4) Auth health (last 60 minutes): compute top event types client-side
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: authRaw, error: authError } = await supabase
        .from("auth_logs")
        .select("event_type, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);

      if (authError) throw authError;

      const authEvents = (authRaw || []) as Array<{ event_type: string | null }>;
      const authCounts = new Map<string, number>();
      for (const r of authEvents) {
        const t = (r.event_type || "unknown").trim() || "unknown";
        authCounts.set(t, (authCounts.get(t) ?? 0) + 1);
      }
      const topEventTypes = [...authCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([event_type, count]) => ({ event_type, count }));

      // 5) Session health
      const nowISO = new Date().toISOString();
      const soonISO = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const activeSessions = await countWhere("voter_sessions", (q) => q.gt("expires_at", nowISO));
      const expiringSoon = await countWhere("voter_sessions", (q) => q.gt("expires_at", nowISO).lte("expires_at", soonISO));

      const { data: logsRaw, error: logsError } = await supabase
        .from("voter_session_logs")
        .select("action, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500);

      if (logsError) throw logsError;

      const logs = (logsRaw || []) as Array<{ action: string | null }>;
      const actionCounts = new Map<string, number>();
      for (const r of logs) {
        const a = (r.action || "unknown").trim() || "unknown";
        actionCounts.set(a, (actionCounts.get(a) ?? 0) + 1);
      }
      const topActions60m = [...actionCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([action, count]) => ({ action, count }));

      setSnapshot({
        proof: proofRows,
        artifacts: artifactRows,
        auth: { totalEvents60m: authEvents.length, topEventTypes },
        sessions: { activeSessions, expiringSoon, topActions60m },
      });
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Failed to load operations snapshot.");
    } finally {
      setLoading(false);
    }
  };

  const proofStatus = (r: ProofCoverage): Status => {
    if (r.voted === 0) return "na";
    const missingTx = Math.max(0, r.voted - r.withTx);
    const missingToken = Math.max(0, r.voted - r.withToken);
    const missing = Math.max(missingTx, missingToken);

    if (missing === 0) return "ok";
    // Conservative thresholds: 1–2 missing is warn, more is bad
    if (missing <= 2) return "warn";
    return "bad";
  };

  const artifactsStatus = (r: ArtifactReadiness): Status => {
    // If no voting happened yet, artifacts may not be required; keep as warn only when missing manifest AND chunks.
    if (!r.hasManifest && r.chunkCount === 0) return "warn";
    if (r.hasManifest && r.chunkCount > 0) return "ok";
    return "warn";
  };

  const sessionStatus: Status = useMemo(() => {
    if (snapshot.sessions.activeSessions === 0) return "na";
    if (snapshot.sessions.expiringSoon >= 10) return "warn";
    return "ok";
  }, [snapshot.sessions.activeSessions, snapshot.sessions.expiringSoon]);

  const authStatus: Status = useMemo(() => {
    if (snapshot.auth.totalEvents60m === 0) return "na";
    // Without an explicit failure taxonomy, keep this informational unless clearly dominated by "fail"/"error" keywords.
    const top = snapshot.auth.topEventTypes[0]?.event_type?.toLowerCase?.() ?? "";
    if (/(fail|error|denied|mismatch)/.test(top)) return "warn";
    return "ok";
  }, [snapshot.auth.totalEvents60m, snapshot.auth.topEventTypes]);

  const exportProofCSV = () => {
    const rows = snapshot.proof.map((r) => ({
      election_id: r.election_id,
      election_title: r.title,
      voted: r.voted,
      with_tx_hash: r.withTx,
      with_nft_token_id: r.withToken,
      missing_tx: Math.max(0, r.voted - r.withTx),
      missing_token: Math.max(0, r.voted - r.withToken),
    }));
    downloadCSV(`proof_coverage_${selectedElectionId === "ALL" ? "all" : selectedElectionId}.csv`, rows);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Operations</h2>
          <p className="text-sm text-muted-foreground">
            Procedural truth: guarantees, exceptions, and system health (not turnout).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={selectedElectionId}
            onChange={(e) => setSelectedElectionId(e.target.value)}
            aria-label="Select election scope"
          >
            <option value="ALL">All elections</option>
            {elections.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>

          <Button variant="outline" onClick={loadOps} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error */}
      {errorMsg && (
        <Card className="border-rose-200">
          <CardHeader>
            <CardTitle className="text-rose-700">Couldn&apos;t load operations snapshot</CardTitle>
            <CardDescription className="text-rose-700/80">{errorMsg}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Section 2: Guarantees & Exceptions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Guarantee: Proof-of-vote pointers issued</CardTitle>
              <CardDescription>
                For each election, compares voters who have voted vs those with tx_hash and nft_token_id recorded.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={exportProofCSV} disabled={loading || snapshot.proof.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </CardHeader>

          <CardContent>
            <div className="space-y-3">
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : snapshot.proof.length === 0 ? (
                <div className="text-sm text-muted-foreground">No elections found for scope: {selectedLabel}.</div>
              ) : (
                snapshot.proof.map((r) => {
                  const s = proofStatus(r);
                  return (
                    <div
                      key={r.election_id}
                      className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-3">
                        {statusIcon(s)}
                        <div>
                          <div className="font-medium">{r.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {statusLabel(s)} • Voted: {r.voted} • tx_hash: {r.withTx} • token_id: {r.withToken}
                          </div>
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Missing tx: {Math.max(0, r.voted - r.withTx)} • Missing token: {Math.max(0, r.voted - r.withToken)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Health</CardTitle>
            <CardDescription>Signals for the last 60 minutes.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="rounded-lg border p-3">
              <div className="flex items-start gap-3">
                {statusIcon(authStatus)}
                <div className="min-w-0">
                  <div className="text-sm font-medium">Authentication</div>
                  <div className="text-xs text-muted-foreground">
                    {statusLabel(authStatus)} • Events (60m): {snapshot.auth.totalEvents60m}
                  </div>
                </div>
              </div>

              {snapshot.auth.topEventTypes.length > 0 && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {snapshot.auth.topEventTypes.map((t) => (
                    <div key={t.event_type} className="flex items-center justify-between gap-2">
                      <span className="truncate">{t.event_type}</span>
                      <span className="tabular-nums">{t.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border p-3">
              <div className="flex items-start gap-3">
                {statusIcon(sessionStatus)}
                <div className="min-w-0">
                  <div className="text-sm font-medium">Sessions</div>
                  <div className="text-xs text-muted-foreground">
                    {statusLabel(sessionStatus)} • Active: {snapshot.sessions.activeSessions} • Expiring soon:{" "}
                    {snapshot.sessions.expiringSoon}
                  </div>
                </div>
              </div>

              {snapshot.sessions.topActions60m.length > 0 && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {snapshot.sessions.topActions60m.map((a) => (
                    <div key={a.action} className="flex items-center justify-between gap-2">
                      <span className="truncate">{a.action}</span>
                      <span className="tabular-nums">{a.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Minimal readiness signal (no deep ZK UI) */}
      <Card>
        <CardHeader>
          <CardTitle>Readiness: Verification artifacts present</CardTitle>
          <CardDescription>
            Minimal indicator only (full details live in the ZK tab). Scope: {selectedLabel}.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : snapshot.artifacts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No elections found for scope: {selectedLabel}.</div>
            ) : (
              snapshot.artifacts.map((r) => {
                const s = artifactsStatus(r);
                return (
                  <div key={r.election_id} className="flex items-start gap-3 rounded-lg border p-3">
                    {statusIcon(s)}
                    <div className="min-w-0">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {statusLabel(s)} • Manifest: {r.hasManifest ? "yes" : "no"} • Chunks: {r.chunkCount}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Note about interventions */}
      <Card>
        <CardHeader>
          <CardTitle>Manual interventions</CardTitle>
          <CardDescription>
            Destructive actions (e.g., voter reset) remain in the Operations tab container (Admin.tsx) under a separate
            &quot;Danger Zone&quot; section.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            This page focuses on procedural truth signals. Actions are intentionally separated to reduce accidental use.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}