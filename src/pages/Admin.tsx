import feuLogo from "@/assets/feu-logo.png";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Users, Vote, Shield, LogOut, Inbox } from "lucide-react";

import AdminAnalytics from "@/components/admin/AdminAnalytics";
import VoterManagement from "@/components/admin/VoterManagement";
import EnhancedElectionManagement from "@/components/admin/EnhancedElectionManagement";
import BlockchainMonitor from "@/components/admin/BlockchainMonitor";
import OrgMembershipRequests from "@/components/admin/OrgMembershipRequests";
import { useEffect } from "react";

export default function Admin() {
  const navigate = useNavigate();

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-feu-green/10 to-feu-gold/10">
      <header className="bg-background border-b border-border p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src={feuLogo} alt="FEU" className="h-12" />
            <div>
              <h1 className="text-2xl font-bold text-feu-green">Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                BotoVeritas Election Management
              </p>
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
          <TabsList className="grid w-full grid-cols-5">
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
            <TabsTrigger value="blockchain">
              <Shield className="h-4 w-4 mr-2" />
              Blockchain
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analytics">
            <AdminAnalytics />
          </TabsContent>

          <TabsContent value="elections">
            <EnhancedElectionManagement />
          </TabsContent>

          <TabsContent value="voters">
            <VoterManagement />
          </TabsContent>

          <TabsContent value="requests">
            <OrgMembershipRequests />
          </TabsContent>

          <TabsContent value="blockchain">
            <BlockchainMonitor />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
