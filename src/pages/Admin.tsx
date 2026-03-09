import feuLogo from "@/assets/feu-logo.png";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

import AdminLogs from "@/components/admin/AdminLogs";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BarChart, Users, Vote, Shield, LogOut, Inbox, ListPlus, RotateCcw, UserPlus, Activity, ScrollText, FolderKanban, ClipboardList, CheckCircle2 } from "lucide-react";

import ControlPanel from "@/components/admin/ControlPanel";
import VoterManagement from "@/components/admin/VoterManagement";
import ElectionManagement from "@/components/admin/ElectionManagement";
import ZKTally from "@/components/admin/ZKTally";
import OrgMembershipRequests from "@/components/admin/OrgMembershipRequests";
import RostersManagement from "@/components/admin/RostersManagement";
import KioskProvisioning from "@/components/admin/KioskProvisioning";

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


function PageIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4 rounded-xl border bg-card/60 p-5">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default function Admin() {
  const navigate = useNavigate();

  
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



  const loadOpsAuditFeed = async () => {
    setOpsAuditLoading(true);
    try {
      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("id, created_at, admin_id, action, entity_type, entity_id, details")
        .eq("action", "APP_SETTING_UPDATE")
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
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 md:grid-cols-6">
            <TabsTrigger value="overview" className="gap-2">
              <BarChart className="h-4 w-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger value="elections" className="gap-2">
              <Vote className="h-4 w-4" />
              <span>Elections</span>
            </TabsTrigger>
            <TabsTrigger value="voters" className="gap-2">
              <Users className="h-4 w-4" />
              <span>Voters</span>
            </TabsTrigger>
            <TabsTrigger value="membership" className="gap-2">
              <FolderKanban className="h-4 w-4" />
              <span>Membership</span>
            </TabsTrigger>
            <TabsTrigger value="kiosks" className="gap-2">
              <ListPlus className="h-4 w-4" />
              <span>Kiosks</span>
            </TabsTrigger>
            <TabsTrigger value="verification" className="gap-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>Verification</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <PageIntro
              title="Overview"
              description="Monitor election operations, registration status, and recent audit activity from one place."
            />

            <ControlPanel />

            <div className="grid gap-6 xl:grid-cols-12">
              <Card className="xl:col-span-4">
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

              <Card className="xl:col-span-8">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Activity className="h-4 w-4" />
                        Operations Audit Feed
                      </CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Recent registration-related admin actions surfaced as compact activity cards.
                      </p>
                    </div>
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
                  {opsAuditLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : opsAuditEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No recent Operations actions.</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {opsAuditEntries.map((row) => {
                        const actionLabel =
                          row.action === "APP_SETTING_UPDATE" && row.details?.key === "registration_enabled"
                            ? `Registration ${row.details?.to ? "opened" : "closed"}`
                            : row.action;

                        const meta =
                          row.action === "APP_SETTING_UPDATE"
                            ? `Setting: ${row.details?.key ?? row.entity_type}`
                            : `${row.entity_type}: ${row.entity_id}`;

                        return (
                          <div key={row.id} className="rounded-lg border bg-background p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-foreground">{actionLabel}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{meta}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-muted-foreground">
                                  {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                                </p>
                                {row.details?.admin_email ? (
                                  <p className="mt-1 text-xs text-muted-foreground">{row.details.admin_email}</p>
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

              <Card className="xl:col-span-12">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <ScrollText className="h-4 w-4" />
                    Recent Audit Logs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-4 text-sm text-muted-foreground">
                    Full admin activity stays visible from Overview so operators do not need a separate logs tab.
                  </p>
                  <AdminLogs />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="elections" className="space-y-6">
            <PageIntro
              title="Elections"
              description="Create, configure, and manage the active election and its candidates."
            />
            <ElectionManagement />
          </TabsContent>

          <TabsContent value="voters" className="space-y-6">
            <PageIntro
              title="Voters"
              description="Manage the voter registry, eligibility, and voter records."
            />
            <VoterManagement />
          </TabsContent>

          <TabsContent value="membership" className="space-y-6">
            <PageIntro
              title="Membership"
              description="Review incoming membership requests and manage approved rosters in one workspace."
            />
            <Tabs defaultValue="requests" className="space-y-4">
              <TabsList className="grid w-full grid-cols-2 md:w-[340px]">
                <TabsTrigger value="requests" className="gap-2">
                  <Inbox className="h-4 w-4" />
                  Requests
                </TabsTrigger>
                <TabsTrigger value="roster" className="gap-2">
                  <ClipboardList className="h-4 w-4" />
                  Roster
                </TabsTrigger>
              </TabsList>

              <TabsContent value="requests">
                <OrgMembershipRequests />
              </TabsContent>

              <TabsContent value="roster">
                <RostersManagement />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="kiosks" className="space-y-6">
            <PageIntro
              title="Kiosks"
              description="Provision devices and monitor kiosk readiness for election operations."
            />
            <KioskProvisioning />
          </TabsContent>

          <TabsContent value="verification" className="space-y-6">
            <PageIntro
              title="Verification"
              description="Generate zero-knowledge proof artifacts, inspect tally diagnostics, and prepare testing-table data from one tab."
            />
            <ZKTally />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}