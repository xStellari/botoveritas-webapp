import feuLogo from "@/assets/feu-logo.png";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BarChart, Users, Vote, Shield, LogOut, Inbox, ListPlus, RotateCcw, UserPlus, Activity } from "lucide-react";

import ControlPanel from "@/components/admin/ControlPanel";
import VoterManagement from "@/components/admin/VoterManagement";
import ElectionManagement from "@/components/admin/ElectionManagement";
import ZKVerification from "@/components/admin/ZKVerification";
import OrgMembershipRequests from "@/components/admin/OrgMembershipRequests";
import RostersManagement from "@/components/admin/RostersManagement";

const APP_SETTING_KEYS = {
  registrationEnabled: "registration_enabled",
} as const;

// Stable UUIDs to group audit log entries for non-UUID entities (e.g., app_settings.key)
const APP_SETTING_AUDIT_ENTITY_IDS = {
  // Must satisfy UUID validator in admin-audit-log Edge Function.
  // This is a stable, version-4-shaped UUID to represent the singleton app setting.
  registrationEnabled: "00000000-0000-0000-0000-000000000001",
} as const;

type AuditLogPayload = {
  action: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, unknown>;
};

async function writeAdminAuditLog(payload: AuditLogPayload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error("Not authenticated: missing access token");
  }

  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!baseUrl || !anonKey) {
    throw new Error("Supabase env missing: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/functions/v1/admin-audit-log`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  // eslint-disable-next-line no-console
  console.log("[admin-audit-log] result", { status: resp.status, data });

  if (!resp.ok) {
    throw new Error(`admin-audit-log HTTP ${resp.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }

  return data;
}




export default function Admin() {
  const navigate = useNavigate();

  const [resetElectionId, setResetElectionId] = useState("");
  const [resetVoterId, setResetVoterId] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  
  const [resetAuditLoading, setResetAuditLoading] = useState(true);
  const [recentResets, setRecentResets] = useState<
    Array<{
      id: number;
      created_at: string;
      admin_id: string | null;
      entity_id: string;
      details: any;
    }>
  >([]);


  const [opsAuditLoading, setOpsAuditLoading] = useState(true);
  const [opsAuditEntries, setOpsAuditEntries] = useState<
    Array<{
      id: number;
      created_at: string;
      admin_id: string | null;
      action: string;
      entity_type: string;
      entity_id: string;
      details: any;
    }>
  >([]);

  const [registrationEnabled, setRegistrationEnabled] = useState<boolean>(false);
  const [registrationLoading, setRegistrationLoading] = useState(true);
  const [registrationSaving, setRegistrationSaving] = useState(false);
  const registrationSaveInFlight = useRef(false);

  const [registrationAuditLoading, setRegistrationAuditLoading] = useState(true);
  const [registrationLastChangedAt, setRegistrationLastChangedAt] = useState<string | null>(null);
  const [registrationLastChangedBy, setRegistrationLastChangedBy] = useState<string | null>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const refreshRegistrationSetting = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setRegistrationLoading(true);
      setRegistrationAuditLoading(true);
    }
    try {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", APP_SETTING_KEYS.registrationEnabled)
        .maybeSingle();

      if (error) throw error;

      const value = data?.value ?? false;
      setRegistrationEnabled(Boolean(value));

      // Attribution from audit logs (best-effort)
      const { data: auditRow, error: auditErr } = await supabase
        .from("admin_audit_logs")
        .select("created_at, details")
        .eq("entity_type", "app_settings")
        .eq("action", "APP_SETTING_UPDATE")
        // Don't rely on entity_id for singleton settings: the audit function may coerce non-UUID or non-v4 UUIDs.
        // Use the semantic key stored in details instead.
        // PostgREST JSON path filter: details->>key
        .eq("details->>key", APP_SETTING_KEYS.registrationEnabled)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (auditErr) throw auditErr;

      setRegistrationLastChangedAt(auditRow?.created_at ?? null);
      const email = (auditRow?.details as unknown as { admin_email?: string } | null)?.admin_email ?? null;
      setRegistrationLastChangedBy(email);
    } catch (e) {
      toast.error("Failed to load registration setting", {
        description: e instanceof Error ? e.message : String(e),
      });
      setRegistrationEnabled(false);
      setRegistrationLastChangedAt(null);
      setRegistrationLastChangedBy(null);
    } finally {
      if (!opts?.silent) {
        setRegistrationLoading(false);
        setRegistrationAuditLoading(false);
      }
    }
  };



  const loadRecentResets = async () => {
    setResetAuditLoading(true);
    try {
      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("id, created_at, admin_id, entity_id, details")
        .eq("action", "RESET_VOTER_FOR_ELECTION")
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;
      setRecentResets(data ?? []);
    } catch (e) {
      // Silent: this is a convenience panel, not a blocker.
      setRecentResets([]);
    } finally {
      setResetAuditLoading(false);
    }
  };

  const loadOpsAuditFeed = async () => {
    setOpsAuditLoading(true);
    try {
      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("id, created_at, admin_id, action, entity_type, entity_id, details")
        .in("action", ["APP_SETTING_UPDATE", "RESET_VOTER_FOR_ELECTION"])
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      setOpsAuditEntries(data ?? []);
    } catch {
      // Silent: convenience feed, not a blocker.
      setOpsAuditEntries([]);
    } finally {
      setOpsAuditLoading(false);
    }
  };


  useEffect(() => {
    void loadRecentResets();
    void loadOpsAuditFeed();
  }, []);

  useEffect(() => {
    // Load once on mount.
    void refreshRegistrationSetting();
  }, []);

  const handleToggleRegistration = (next: boolean) => {
    if (registrationSaveInFlight.current || registrationLoading) return;

    const prev = registrationEnabled;
    setRegistrationEnabled(next); // optimistic
    setRegistrationSaving(true);
    registrationSaveInFlight.current = true;

    // Fire-and-forget: do not keep UI in "Saving…" while best-effort audit logging runs.
    void (async () => {
      try {
        // Main write (should be fast). If this hangs, we time out and roll back.
        const writePromise = supabase
          .from("app_settings")
          .upsert(
            {
              key: APP_SETTING_KEYS.registrationEnabled,
              value: next,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "key" }
          );

        const { error } = await Promise.race([
          writePromise,
          new Promise<{ error: Error }>((resolve) =>
            window.setTimeout(() => resolve({ error: new Error("Write timeout") }), 3000)
          ),
        ]);

        if (error) throw error;

        toast.success(`Registration ${next ? "enabled" : "disabled"}`, {
          description: next
            ? "Voters can now start registering for the upcoming election."
            : "Registration is now closed. Voters will be blocked from starting registration.",
        });
      } catch (e) {
        // rollback
        setRegistrationEnabled(prev);
        toast.error("Failed to update registration setting", {
          description: e instanceof Error ? e.message : String(e),
        });
      } finally {
        // Always clear UI quickly.
        setRegistrationSaving(false);
        registrationSaveInFlight.current = false;
        // Sync UI from DB (silent) without blocking.
        void refreshRegistrationSetting({ silent: true });
      }

      // Best-effort audit logging (never blocks UI)
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const adminEmail = sessionData.session?.user?.email ?? null;

        const auditResult = await writeAdminAuditLog({
          action: "APP_SETTING_UPDATE",
          entity_type: "app_settings",
          entity_id: APP_SETTING_AUDIT_ENTITY_IDS.registrationEnabled,
          details: {
            key: APP_SETTING_KEYS.registrationEnabled,
            from: prev,
            to: next,
            admin_email: adminEmail,
          },
        });

        // Best-effort local attribution update
        const insertedAt =
          (auditResult as any)?.inserted?.created_at ?? (auditResult as any)?.created_at ?? new Date().toISOString();
        setRegistrationLastChangedAt(insertedAt);
        setRegistrationLastChangedBy(adminEmail);

        // Ensure the "Last changed" line reflects the latest audit row (handles races with the silent refresh above).
        void refreshRegistrationSetting({ silent: true });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Failed to write ops audit entry for registration toggle:", e);
        toast.warning("Audit log not saved", { description: e instanceof Error ? e.message : String(e) });
      }
    })();
  };


  const handleAdminResetVoter = async () => {
    const electionId = resetElectionId.trim();
    const voterId = resetVoterId.trim();

    if (!electionId || !voterId) {
      toast.error("Missing fields", { description: "Please provide both electionId and voterId." });
      return;
    }

    const confirmed = window.confirm(
      "This will DELETE the voter's votes and voter_election_status for the given election (even if FINAL).\n\nProceed?"
    );
    if (!confirmed) return;

    setResetBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-reset-voter", {
        body: { electionId, voterId },
      });

      if (error) {
        toast.error("Reset failed", { description: error.message });
        return;
      }

      if (!data?.ok) {
        toast.error("Reset failed", { description: data?.error ?? "Unknown error." });
        return;
      }

      toast.success("Voter reset complete", {
        description: `Cleared vote state for voter ${voterId} in election ${electionId}.`,
      });


      // Best-effort audit trail (do not block success UX)
      try {
        const { data: authData } = await supabase.auth.getUser();
        const admin = authData.user;
        const adminEmail = admin?.email ?? null;

        await writeAdminAuditLog({
          action: "RESET_VOTER_FOR_ELECTION",
          entity_type: "election",
          entity_id: electionId,
          details: {
            voter_id: voterId,
            election_id: electionId,
            admin_email: adminEmail,
          },
        });

        await loadRecentResets();
        void loadOpsAuditFeed();
      } catch {
        // ignore
      }
    } catch (e) {
      toast.error("Reset failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-feu-green/10 via-background to-feu-gold/10 animate-fade-in-up">

<style>{`
@keyframes blobDance1 {
  0%   { transform: translate(-20px, 10px) scale(1) rotate(0deg); }
  25%  { transform: translate(55px, -35px) scale(1.18) rotate(8deg); }
  50%  { transform: translate(15px, -70px) scale(0.96) rotate(-10deg); }
  75%  { transform: translate(-50px, -15px) scale(1.12) rotate(14deg); }
  100% { transform: translate(-20px, 10px) scale(1) rotate(0deg); }
}

@keyframes blobDance2 {
  0%   { transform: translate(25px, -10px) scale(1) rotate(0deg); }
  25%  { transform: translate(-60px, 25px) scale(1.16) rotate(-10deg); }
  50%  { transform: translate(-20px, 70px) scale(0.98) rotate(12deg); }
  75%  { transform: translate(65px, 30px) scale(1.12) rotate(-16deg); }
  100% { transform: translate(25px, -10px) scale(1) rotate(0deg); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(18px); filter: blur(2px); }
  to   { opacity: 1; transform: translateY(0);   filter: blur(0); }
}

@keyframes floatPunch {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50%      { transform: translateY(-10px) rotate(3deg); }
}

@keyframes shimmer {
  0%   { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}

.animate-blob-1 { animation: blobDance1 7.5s cubic-bezier(.2,.9,.2,1) infinite; }
.animate-blob-2 { animation: blobDance2 9s cubic-bezier(.2,.9,.2,1) infinite; }
.animate-fade-in-up { animation: fadeInUp 560ms cubic-bezier(.2,.8,.2,1) both; }
.animate-float { animation: floatPunch 2.4s ease-in-out infinite; transform-origin: center; }

.lift-hover { transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease; }
.lift-hover:hover { transform: translateY(-4px) scale(1.01); box-shadow: 0 18px 55px rgba(0,0,0,0.16); border-color: rgba(0,0,0,0.08); }

.shimmer-border {
  background: linear-gradient(90deg, rgba(255,255,255,0.12), rgba(255,255,255,0.35), rgba(255,255,255,0.12));
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}
`}</style>

{/* Depth / motion background blobs */}
<div className="pointer-events-none absolute -top-28 -left-28 h-96 w-96 rounded-full bg-feu-green/15 blur-3xl animate-blob-1 animate-float" />
<div className="pointer-events-none absolute -bottom-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-feu-gold/15 blur-3xl animate-blob-2" />
<div className="pointer-events-none absolute top-28 right-24 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl animate-blob-1" />

      <header className="bg-background/80 backdrop-blur border-b border-border p-4 shimmer-border">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src={feuLogo} alt="FEU" className="h-12" />
            <div>
              <h1 className="text-2xl font-bold text-feu-green">Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">BotoVeritas Election Management</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate("/results")}>
              View Results
            </Button>
            <Button variant="ghost" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 animate-fade-in-up">
        <Tabs defaultValue="analytics" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="analytics">
              <BarChart className="h-4 w-4 mr-2" />
              Operations
            </TabsTrigger>

            <TabsTrigger value="elections">
              <Vote className="h-4 w-4 mr-2" />
              Elections
            </TabsTrigger>

            <TabsTrigger value="voters">
              <Users className="h-4 w-4 mr-2" />
              Voters
            </TabsTrigger>

            <TabsTrigger value="requests">
              <Inbox className="h-4 w-4 mr-2" />
              Requests
            </TabsTrigger>

            <TabsTrigger value="rosters">
              <ListPlus className="h-4 w-4 mr-2" />
              Rosters
            </TabsTrigger>

            <TabsTrigger value="zk">
              <Shield className="h-4 w-4 mr-2" />
              ZK
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analytics">
            <ControlPanel />

            <div className="mt-6 space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    Registration Phase
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border bg-background p-4">
                    <div className="space-y-1">
                      <div className="font-semibold leading-none">
                        {registrationEnabled ? "Registration is OPEN" : "Registration is CLOSED"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {registrationEnabled
                          ? "Voters can proceed to identity verification and complete registration."
                          : "Voters will be blocked at the start of registration."}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {registrationLoading ? "Loading…" : registrationSaving ? "Saving…" : ""}
                      </span>
                      <Switch
                        checked={registrationEnabled}
                        disabled={registrationLoading || registrationSaving}
                        onCheckedChange={handleToggleRegistration}
                        aria-label="Toggle registration"
                      />
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Last changed:{" "}
                    {registrationAuditLoading
                      ? "Loading…"
                      : registrationLastChangedAt
                        ? new Date(registrationLastChangedAt).toLocaleString()
                        : "—"}
                    {registrationLastChangedBy ? ` by ${registrationLastChangedBy}` : ""}
                  </p>
                </CardContent>
              </Card>

              
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      Operations Audit Feed
                    </CardTitle>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void loadOpsAuditFeed();
                      }}
                      disabled={opsAuditLoading}
                      className="gap-2"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Recent high-impact Operations actions (registration toggles and voter resets).
                  </p>

                  {opsAuditLoading ? (
                    <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
                  ) : opsAuditEntries.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No recent Operations actions.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {opsAuditEntries.map((row) => {
                        const actionLabel =
                          row.action === "APP_SETTING_UPDATE" && row.details?.key === "registration_enabled"
                            ? `Registration ${row.details?.to ? "opened" : "closed"}`
                            : row.action === "RESET_VOTER_FOR_ELECTION"
                              ? "Reset voter for election"
                              : row.action;

                        const meta =
                          row.action === "RESET_VOTER_FOR_ELECTION"
                            ? `Election: ${row.entity_id} • Voter: ${row.details?.voter_id ?? "—"}`
                            : row.action === "APP_SETTING_UPDATE"
                              ? `Setting: ${row.details?.key ?? row.entity_type}`
                              : `${row.entity_type}: ${row.entity_id}`;

                        return (
                          <div key={row.id} className="rounded-lg border bg-background p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-foreground">{actionLabel}</p>
                                <p className="text-xs text-muted-foreground mt-1">{meta}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-muted-foreground">
                                  {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                                </p>
                                {row.details?.admin_email ? (
                                  <p className="text-xs text-muted-foreground mt-1">{row.details.admin_email}</p>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

<Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Testing / Maintenance: Reset Voter for an Election
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    This is intended for test resets only. It clears the selected voter's vote state for the given election
                    (votes + voter_election_status) via the secure{" "}
                    <code className="px-1 py-0.5 rounded bg-muted">admin-reset-voter</code> Edge Function.
                  </p>

                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                    <p className="text-xs font-medium text-destructive">Danger Zone</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Use only for testing/maintenance. This action removes recorded vote state for a voter in a specific election.
                    </p>

                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-medium text-foreground">Recent resets</p>
                      {resetAuditLoading ? (
                        <p className="text-xs text-muted-foreground">Loading…</p>
                      ) : recentResets.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No recent reset actions logged.</p>
                      ) : (
                        <div className="space-y-1">
                          {recentResets.map((r) => (
                            <div key={r.id} className="text-xs text-muted-foreground">
                              <span className="text-foreground">
                                {new Date(r.created_at).toLocaleString()}
                              </span>{" "}
                              — election <code className="px-1 py-0.5 rounded bg-muted">{r.entity_id}</code>, voter{" "}
                              <code className="px-1 py-0.5 rounded bg-muted">{r.details?.voter_id ?? "—"}</code>
                              {r.details?.admin_email ? ` (by ${r.details.admin_email})` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="reset-election-id">Election ID (UUID)</Label>
                      <Input
                        id="reset-election-id"
                        value={resetElectionId}
                        onChange={(e) => setResetElectionId(e.target.value)}
                        placeholder="e.g. 2f2d7c7a-...."
                        autoComplete="off"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reset-voter-id">Voter ID (UUID)</Label>
                      <Input
                        id="reset-voter-id"
                        value={resetVoterId}
                        onChange={(e) => setResetVoterId(e.target.value)}
                        placeholder="e.g. 9a61a3b1-...."
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end">
                    <Button onClick={handleAdminResetVoter} disabled={resetBusy}>
                      <RotateCcw className="h-4 w-4 mr-2" />
                      {resetBusy ? "Resetting..." : "Reset Voter"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="elections">
            <ElectionManagement />
          </TabsContent>

          <TabsContent value="voters">
            <VoterManagement />
          </TabsContent>

          <TabsContent value="requests">
            <OrgMembershipRequests />
          </TabsContent>

          <TabsContent value="rosters">
            <RostersManagement />
          </TabsContent>

          <TabsContent value="zk">
            <ZKVerification />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}