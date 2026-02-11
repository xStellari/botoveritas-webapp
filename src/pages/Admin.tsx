import feuLogo from "@/assets/feu-logo.png";
import { useEffect, useState } from "react";
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

import AdminAnalytics from "@/components/admin/AdminAnalytics";
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
  registrationEnabled: "00000000-0000-0000-0000-000000000001",
} as const;

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

  const [registrationAuditLoading, setRegistrationAuditLoading] = useState(true);
  const [registrationLastChangedAt, setRegistrationLastChangedAt] = useState<string | null>(null);
  const [registrationLastChangedBy, setRegistrationLastChangedBy] = useState<string | null>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
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
    supabase.auth.getSession().then(({ data }) => {
      console.log("ADMIN SESSION:", data.session);
      console.log("ADMIN USER ID:", data.session?.user?.id);
    });

    void loadRecentResets();
    void loadOpsAuditFeed();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRegistrationSetting() {
      setRegistrationLoading(true);
      setRegistrationAuditLoading(true);
      try {
        const { data, error } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", APP_SETTING_KEYS.registrationEnabled)
          .maybeSingle();

        if (error) throw error;

        // If missing, default false (closed).
        const value = data?.value ?? false;

        if (!cancelled) setRegistrationEnabled(Boolean(value));

        // Load last-change attribution from audit logs (best-effort)
        const { data: auditRow, error: auditErr } = await supabase
          .from("admin_audit_logs")
          .select("created_at, details")
          .eq("entity_type", "app_settings")
          .eq("entity_id", APP_SETTING_AUDIT_ENTITY_IDS.registrationEnabled)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (auditErr) throw auditErr;

        if (!cancelled) {
          setRegistrationLastChangedAt(auditRow?.created_at ?? null);
          const email = (auditRow?.details as unknown as { admin_email?: string } | null)?.admin_email ?? null;
          setRegistrationLastChangedBy(email);
        }
      } catch (e) {
        if (!cancelled) {
          toast.error("Failed to load registration setting", {
            description: e instanceof Error ? e.message : String(e),
          });
          setRegistrationEnabled(false);
        }
      } finally {
        if (!cancelled) {
          setRegistrationLoading(false);
          setRegistrationAuditLoading(false);
        }
      }
    }

    loadRegistrationSetting();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleRegistration = async (next: boolean) => {
    const prev = registrationEnabled;
    setRegistrationEnabled(next); // optimistic
    setRegistrationSaving(true);

    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          {
            key: APP_SETTING_KEYS.registrationEnabled,
            value: next,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );

      if (error) throw error;

      // Best-effort: write an audit log entry for attribution
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const adminId = sessionData.session?.user?.id ?? null;
        const adminEmail = sessionData.session?.user?.email ?? null;

        const { data: auditInserted, error: auditInsertErr } = await supabase
          .from("admin_audit_logs")
          .insert({
            admin_id: adminId,
            action: "APP_SETTING_UPDATE",
            entity_type: "app_settings",
            entity_id: APP_SETTING_AUDIT_ENTITY_IDS.registrationEnabled,
            details: {
              key: APP_SETTING_KEYS.registrationEnabled,
              from: prev,
              to: next,
              admin_email: adminEmail,
            },
          })
          .select("created_at, details")
          .single();

        if (auditInsertErr) throw auditInsertErr;

        setRegistrationLastChangedAt(auditInserted?.created_at ?? new Date().toISOString());
        const email = (auditInserted?.details as unknown as { admin_email?: string } | null)?.admin_email ?? adminEmail ?? null;
        setRegistrationLastChangedBy(email);
      } catch {
        // Do not block the main operation if audit logging fails.
      }

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
      setRegistrationSaving(false);
    }
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

        await supabase.from("admin_audit_logs").insert({
          action: "RESET_VOTER_FOR_ELECTION",
          entity_type: "election",
          entity_id: electionId,
          admin_id: admin?.id ?? null,
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
    <div className="min-h-screen bg-gradient-to-br from-feu-green/10 to-feu-gold/10">
      <header className="bg-background border-b border-border p-4">
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

      <main className="max-w-7xl mx-auto p-6">
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
            <AdminAnalytics />

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
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Operations Audit Feed
                  </CardTitle>
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