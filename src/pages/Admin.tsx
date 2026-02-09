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

import { BarChart, Users, Vote, Shield, LogOut, Inbox, ListPlus, RotateCcw, UserPlus } from "lucide-react";

import AdminAnalytics from "@/components/admin/AdminAnalytics";
import VoterManagement from "@/components/admin/VoterManagement";
import ElectionManagement from "@/components/admin/ElectionManagement";
import ZKVerification from "@/components/admin/ZKVerification";
import OrgMembershipRequests from "@/components/admin/OrgMembershipRequests";
import RostersManagement from "@/components/admin/RostersManagement";

const APP_SETTING_KEYS = {
  registrationEnabled: "registration_enabled",
} as const;

export default function Admin() {
  const navigate = useNavigate();

  const [resetElectionId, setResetElectionId] = useState("");
  const [resetVoterId, setResetVoterId] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const [registrationEnabled, setRegistrationEnabled] = useState<boolean>(false);
  const [registrationLoading, setRegistrationLoading] = useState(true);
  const [registrationSaving, setRegistrationSaving] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      console.log("ADMIN SESSION:", data.session);
      console.log("ADMIN USER ID:", data.session?.user?.id);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRegistrationSetting() {
      setRegistrationLoading(true);
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
      } catch (e) {
        if (!cancelled) {
          toast.error("Failed to load registration setting", {
            description: e instanceof Error ? e.message : String(e),
          });
          setRegistrationEnabled(false);
        }
      } finally {
        if (!cancelled) setRegistrationLoading(false);
      }
    }

    loadRegistrationSetting();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleRegistration = async (next: boolean) => {
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

      toast.success(`Registration ${next ? "enabled" : "disabled"}`, {
        description: next
          ? "Voters can now start registering for the upcoming election."
          : "Registration is now closed. Voters will be blocked from starting registration.",
      });
    } catch (e) {
      // rollback
      setRegistrationEnabled((prev) => !prev);
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
                  <p className="text-sm text-muted-foreground">
                    Controls whether students can start the voter registration flow. This is meant for your
                    <span className="font-medium text-foreground"> registration window</span> (e.g., 1–2 weeks before elections).
                  </p>

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
                    Setting key: <code className="px-1 py-0.5 rounded bg-muted">{APP_SETTING_KEYS.registrationEnabled}</code>
                  </p>
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
