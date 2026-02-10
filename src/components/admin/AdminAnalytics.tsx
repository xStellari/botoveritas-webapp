import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/types/supabase";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription as DialogDesc } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, CircleMinus, Download, RefreshCcw } from "lucide-react";

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

  // Actionable signals based on known failure event_type values
  failureEvents60m: number;
  failureRate60m: number;
  topFailureTypes: Array<{ event_type: string; count: number }>;
};

type SessionHealth = {
  activeSessions: number;
  expiringSoon: number;
  topActions60m: Array<{ action: string; count: number }>;

  // Stuck sessions = session exists but no session_end and older than threshold
  stuckSessions: number;
  stuckSample: Array<{ voter_id: string; created_at: string; last_action: string | null }>;
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

function parseNoTz(ts: string) {
  // Supabase may return timestamp without timezone; treat as UTC for consistent comparisons.
  const clean = ts.includes("Z") ? ts : `${ts}Z`;
  return new Date(clean);
}

function maskId(id: string | null | undefined, visible = 8) {
  if (!id) return "—";
  const s = String(id);
  if (s.length <= visible) return s;
  return `${s.slice(0, visible)}…`;
}

function maskText(v: string | null | undefined, visible = 6) {
  if (!v) return "—";
  const s = String(v);
  if (s.length <= visible) return s;
  return `${s.slice(0, visible)}…`;
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
const [snapshot, setSnapshot] = useState<OpsSnapshot>({
    proof: [],
    artifacts: [],
    auth: { totalEvents60m: 0, topEventTypes: [], failureEvents60m: 0, failureRate60m: 0, topFailureTypes: [] },
    sessions: { activeSessions: 0, expiringSoon: 0, topActions60m: [], stuckSessions: 0, stuckSample: [] },
  });

  const [inspectAuthOpen, setInspectAuthOpen] = useState(false);
  const [inspectAuthLoading, setInspectAuthLoading] = useState(false);
  const [inspectAuthRows, setInspectAuthRows] = useState<
    Array<{ created_at: string | null; event_type: string | null; voter_id: string | null; rfid_tag: string | null; distance_score: number | null }>
  >([]);

  const [inspectSessionsOpen, setInspectSessionsOpen] = useState(false);
  const [inspectSessionsLoading, setInspectSessionsLoading] = useState(false);
  const [inspectSessionsRows, setInspectSessionsRows] = useState<
    Array<{ voter_id: string; created_at: string; expires_at: string; last_action: string | null; last_action_at: string | null; kiosk_id: string | null }>
  >([]); 
useEffect(() => {
    void loadOps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
const scoped = electionRows;
      // Helper: count rows with filters using head:true for lightweight queries
      // NOTE: supabase.from() is strongly typed to known table names; use the Database type for safety.
      type TableName = keyof Database["public"]["Tables"];
      const countWhere = async (table: TableName, apply: (q: any) => any) => {
        const { count, error } = await apply(
          supabase.from(table).select("*", { head: true, count: "exact" })
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
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19); // timestamp (no tz)
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

      // Known auth failure taxonomy (from your DB): EMAIL_NOT_VERIFIED, RFID_NOT_REGISTERED, FACE_MISMATCH
      const failureTypeSet = new Set(["EMAIL_NOT_VERIFIED", "RFID_NOT_REGISTERED", "FACE_MISMATCH"]);
      let failureEvents60m = 0;
      const failureCounts = new Map<string, number>();

      for (const r of authEvents) {
        const t = (r.event_type || "unknown").trim() || "unknown";
        if (failureTypeSet.has(t)) {
          failureEvents60m += 1;
          failureCounts.set(t, (failureCounts.get(t) ?? 0) + 1);
        }
      }

      const failureRate60m = authEvents.length === 0 ? 0 : failureEvents60m / authEvents.length;

      const topFailureTypes = [...failureCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([event_type, count]) => ({ event_type, count }));

      // 5) Session health
      const nowISO = new Date().toISOString();
      const soonISO = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const activeSessions = await countWhere("voter_sessions", (q) => q.gt("expires_at", nowISO));
      const expiringSoon = await countWhere("voter_sessions", (q) => q.gt("expires_at", nowISO).lte("expires_at", soonISO));

      // Detect "stuck" sessions:
      // - session exists (active)
      // - created_at older than 5 minutes
      // - latest session log action is not "session_end"
      const stuckThresholdISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const { data: activeSessionRows, error: activeSessionRowsError } = await supabase
        .from("voter_sessions")
        .select("voter_id, created_at, expires_at")
        .gt("expires_at", nowISO)
        .order("created_at", { ascending: true })
        .limit(50);

      if (activeSessionRowsError) throw activeSessionRowsError;

      const activeRows = (activeSessionRows || []) as Array<{ voter_id: string; created_at: string; expires_at: string }>;
      const olderActive = activeRows.filter((s) => s.created_at < stuckThresholdISO);

      const voterIds = Array.from(new Set(olderActive.map((s) => s.voter_id))).filter(Boolean);

      // Pull recent logs for these voters and compute latest action per voter
      let stuckSessions = 0;
      const stuckSample: Array<{ voter_id: string; created_at: string; last_action: string | null }> = [];

      if (voterIds.length > 0) {
        const { data: recentLogs, error: recentLogsError } = await supabase
          .from("voter_session_logs")
          .select("voter_id, action, created_at")
          .in("voter_id", voterIds)
          .order("created_at", { ascending: false })
          .limit(500);

        if (recentLogsError) throw recentLogsError;

        const latestByVoter = new Map<string, { action: string | null; created_at: string }>();
        for (const row of (recentLogs || []) as Array<{ voter_id: string; action: string | null; created_at: string }>) {
          if (!latestByVoter.has(row.voter_id)) {
            latestByVoter.set(row.voter_id, { action: row.action, created_at: row.created_at });
          }
        }

        for (const s of olderActive) {
          const latest = latestByVoter.get(s.voter_id);
          const lastAction = latest?.action ?? null;

          if (lastAction !== "session_end") {
            stuckSessions += 1;

            if (stuckSample.length < 5) {
              stuckSample.push({
                voter_id: s.voter_id,
                created_at: s.created_at,
                last_action: lastAction,
              });
            }
          }
        }
      }

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
        auth: { totalEvents60m: authEvents.length, topEventTypes, failureEvents60m, failureRate60m, topFailureTypes },
        sessions: { activeSessions, expiringSoon, topActions60m, stuckSessions, stuckSample },
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
    if (snapshot.sessions.stuckSessions >= 5) return "bad";
    if (snapshot.sessions.stuckSessions >= 1) return "warn";
    if (snapshot.sessions.expiringSoon >= 10) return "warn";
    return "ok";
  }, [snapshot.sessions.activeSessions, snapshot.sessions.expiringSoon, snapshot.sessions.stuckSessions]);

  const authStatus: Status = useMemo(() => {
    if (snapshot.auth.totalEvents60m === 0) return "na";

    // Actionable thresholds based on failure taxonomy
    if (snapshot.auth.failureRate60m >= 0.15 || snapshot.auth.failureEvents60m >= 15) return "bad";
    if (snapshot.auth.failureRate60m >= 0.05 || snapshot.auth.failureEvents60m >= 5) return "warn";
    return "ok";
  }, [snapshot.auth.totalEvents60m, snapshot.auth.failureRate60m, snapshot.auth.failureEvents60m]);

  
  const loadInspectAuthFailures = async () => {
    setInspectAuthLoading(true);
    try {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19); // timestamp (no tz)
      const failureTypes = ["EMAIL_NOT_VERIFIED", "RFID_NOT_REGISTERED", "FACE_MISMATCH"];

      const { data, error } = await supabase
        .from("auth_logs")
        .select("created_at, event_type, voter_id, rfid_tag, distance_score")
        .gte("created_at", since)
        .in("event_type", failureTypes)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      setInspectAuthRows(
        (data || []) as Array<{
          created_at: string | null;
          event_type: string | null;
          voter_id: string | null;
          rfid_tag: string | null;
          distance_score: number | null;
        }>
      );
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to load auth failure details");
    } finally {
      setInspectAuthLoading(false);
    }
  };

  const loadInspectStuckSessions = async () => {
    setInspectSessionsLoading(true);
    try {
      // Pull active sessions and their latest log event; identify sessions that look "stuck"
      const { data: sessionsRaw, error: sessionsErr } = await supabase
        .from("voter_sessions")
        .select("voter_id, created_at, expires_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (sessionsErr) throw sessionsErr;

      const sessions = (sessionsRaw || []) as Array<{ voter_id: string; created_at: string; expires_at: string }>;
      const now = new Date();
      const activeSessions = sessions.filter((s) => parseNoTz(s.expires_at) > now);
      const voterIds = activeSessions.map((s) => s.voter_id);

      let latestByVoter = new Map<string, { action: string | null; created_at: string | null; kiosk_id: string | null }>();
      if (voterIds.length > 0) {
        const { data: logsRaw, error: logsErr } = await supabase
          .from("voter_session_logs")
          .select("voter_id, action, created_at, kiosk_id")
          .in("voter_id", voterIds)
          .order("created_at", { ascending: false })
          .limit(1000);

        if (logsErr) throw logsErr;

        const logs = (logsRaw || []) as Array<{ voter_id: string; action: string; created_at: string; kiosk_id: string | null }>;
        for (const l of logs) {
          if (!latestByVoter.has(l.voter_id)) {
            latestByVoter.set(l.voter_id, { action: l.action ?? null, created_at: l.created_at ?? null, kiosk_id: l.kiosk_id ?? null });
          }
        }
      }

      const stuck: Array<{ voter_id: string; created_at: string; expires_at: string; last_action: string | null; last_action_at: string | null; kiosk_id: string | null }> = [];
      const STUCK_AFTER_MS = 5 * 60 * 1000;

      for (const s of activeSessions) {
        const ageMs = now.getTime() - parseNoTz(s.created_at).getTime();
        const last = latestByVoter.get(s.voter_id);
        const lastAction = last?.action ?? null;

        // consider stuck if older than threshold and we haven't seen a session_end
        if (ageMs >= STUCK_AFTER_MS && lastAction !== "session_end") {
          stuck.push({
            voter_id: s.voter_id,
            created_at: s.created_at,
            expires_at: s.expires_at,
            last_action: lastAction,
            last_action_at: last?.created_at ?? null,
            kiosk_id: last?.kiosk_id ?? null,
          });
        }
      }

      setInspectSessionsRows(stuck.slice(0, 50));
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to load stuck session details");
    } finally {
      setInspectSessionsLoading(false);
    }
  };

  const openInspectAuth = async () => {
    setInspectAuthOpen(true);
    if (inspectAuthRows.length === 0) await loadInspectAuthFailures();
  };

  const openInspectSessions = async () => {
    setInspectSessionsOpen(true);
    if (inspectSessionsRows.length === 0) await loadInspectStuckSessions();
  };

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
    downloadCSV(`proof_coverage_all.csv`, rows);
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
                <div className="text-sm text-muted-foreground">No elections found.</div>
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
            {(snapshot.auth.totalEvents60m === 0 && snapshot.sessions.activeSessions === 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <div className="font-medium">No recent health signals detected.</div>
                <div className="mt-1 text-amber-800">
                  If you just tested authentication or have active sessions but still see zeros here, this is usually caused by Row Level Security
                  policies blocking reads on <code className="px-1">auth_logs</code>, <code className="px-1">voter_sessions</code>, or <code className="px-1">voter_session_logs</code>.
                </div>
              </div>
            )}

            <div className="rounded-lg border p-3">
              <div className="flex items-start gap-3">
                {statusIcon(authStatus)}
                <div className="min-w-0">
                  <div className="text-sm font-medium">Authentication</div>
                  <div className="text-xs text-muted-foreground">
                    {statusLabel(authStatus)} • Events (60m): {snapshot.auth.totalEvents60m} • Failures: {snapshot.auth.failureEvents60m} ({(snapshot.auth.failureRate60m * 100).toFixed(1)}%)
                  </div>
                </div>
              </div>

              
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openInspectAuth}
                  disabled={inspectAuthLoading || snapshot.auth.failureEvents60m === 0}
                >
                  Inspect failures
                </Button>
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

              {snapshot.auth.topFailureTypes.length > 0 && (
                <div className="mt-3 rounded-md border bg-muted/30 p-2">
                  <div className="text-xs font-medium">Failure breakdown (60m)</div>
                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {snapshot.auth.topFailureTypes.map((t) => (
                      <div key={t.event_type} className="flex items-center justify-between gap-2">
                        <span className="truncate">{t.event_type}</span>
                        <span className="tabular-nums">{t.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            <div className="rounded-lg border p-3">
              <div className="flex items-start gap-3">
                {statusIcon(sessionStatus)}
                <div className="min-w-0">
                  <div className="text-sm font-medium">Sessions</div>
                  <div className="text-xs text-muted-foreground">
                    {statusLabel(sessionStatus)} • Active: {snapshot.sessions.activeSessions} • Expiring soon:{" "}
                    {snapshot.sessions.expiringSoon} • Stuck: {snapshot.sessions.stuckSessions}
                  </div>
                </div>
              </div>

              
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openInspectSessions}
                  disabled={inspectSessionsLoading || snapshot.sessions.stuckSessions === 0}
                >
                  Inspect stuck sessions
                </Button>
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

              {snapshot.sessions.stuckSample.length > 0 && (
                <div className="mt-3 rounded-md border bg-muted/30 p-2">
                  <div className="text-xs font-medium">Stuck sessions (sample)</div>
                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {snapshot.sessions.stuckSample.map((s) => (
                      <div key={s.voter_id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{s.voter_id.slice(0, 8)}…</span>
                        <span className="truncate">{s.last_action ?? "unknown"}</span>
                      </div>
                    ))}
                  </div>
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
            Minimal indicator only (full details live in the ZK tab). Scope: All elections.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : snapshot.artifacts.length === 0 ? (
              <div className="text-sm text-muted-foreground">No elections found.</div>
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

      
      {/* Inspect: Auth failures */}
      <Dialog open={inspectAuthOpen} onOpenChange={setInspectAuthOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Authentication failures (last 60 minutes)</DialogTitle>
            <DialogDesc>
              These are the most actionable auth exceptions. If this spikes, check roster data, RFID registration, or
              biometric capture conditions.
            </DialogDesc>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-muted-foreground">
              Showing up to 50 most recent failure events.
            </div>
            <Button variant="outline" size="sm" onClick={loadInspectAuthFailures} disabled={inspectAuthLoading}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="max-h-[420px] overflow-auto rounded-lg border">
            {inspectAuthLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : inspectAuthRows.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No failures found in the last 60 minutes.</div>
            ) : (
              <div className="divide-y">
                {inspectAuthRows.map((r, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{r.event_type ?? "unknown"}</div>
                      <div className="text-xs text-muted-foreground">
                        voter: {maskId(r.voter_id)} • rfid: {maskText(r.rfid_tag)} • score:{" "}
                        {r.distance_score == null ? "—" : r.distance_score.toFixed(3)}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                      {r.created_at ? parseNoTz(r.created_at).toLocaleString() : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Inspect: Stuck sessions */}
      <Dialog open={inspectSessionsOpen} onOpenChange={setInspectSessionsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Stuck sessions</DialogTitle>
            <DialogDesc>
              Sessions older than 5 minutes without a <code className="rounded bg-muted px-1">session_end</code>. These
              often indicate kiosk interruptions or network hiccups.
            </DialogDesc>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-muted-foreground">Showing up to 50 stuck sessions.</div>
            <Button variant="outline" size="sm" onClick={loadInspectStuckSessions} disabled={inspectSessionsLoading}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="max-h-[420px] overflow-auto rounded-lg border">
            {inspectSessionsLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : inspectSessionsRows.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No stuck sessions detected.</div>
            ) : (
              <div className="divide-y">
                {inspectSessionsRows.map((r, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">voter: {maskId(r.voter_id)}</div>
                      <div className="text-xs text-muted-foreground">
                        last: {r.last_action ?? "—"} • kiosk: {maskText(r.kiosk_id)} • started:{" "}
                        {parseNoTz(r.created_at).toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        expires: {parseNoTz(r.expires_at).toLocaleString()} • last at:{" "}
                        {r.last_action_at ? parseNoTz(r.last_action_at).toLocaleString() : "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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