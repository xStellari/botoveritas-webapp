import { useEffect, useState } from "react";
import feuLogo from "@/assets/feu-logo.png";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { BarChart, Users, Vote, Shield, LogOut } from "lucide-react";
import { toast } from "sonner";
import AdminAnalytics from "@/components/admin/AdminAnalytics";
import VoterManagement from "@/components/admin/VoterManagement";
import EnhancedElectionManagement from "@/components/admin/EnhancedElectionManagement";
import BlockchainMonitor from "@/components/admin/BlockchainMonitor";

export default function Admin() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkAdminAccess();
  }, []);

  const checkAdminAccess = async () => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      navigate("/");
      return;
    }

    setUser(session.user);

    // Check if user has admin role
    const { data: roles, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .eq("role", "admin");

    if (error || !roles || roles.length === 0) {
      toast.error("Access denied. Admin privileges required.");
      navigate("/");
      return;
    }

    setIsAdmin(true);
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Verifying admin access...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="analytics">
              <BarChart className="h-4 w-4 mr-2" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="elections">
              <Vote className="h-4 w-4 mr-2" />
              Elections
            </TabsTrigger>
            <TabsTrigger value="voters">
              <Users className="h-4 w-4 mr-2" />
              Voters
            </TabsTrigger>
            <TabsTrigger value="blockchain">
              <Shield className="h-4 w-4 mr-2" />
              Blockchain
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analytics">
            {/* ✅ self-contained AdminAnalytics, no props */}
            <AdminAnalytics />
          </TabsContent>

          <TabsContent value="elections">
            <EnhancedElectionManagement />
          </TabsContent>

          <TabsContent value="voters">
            <VoterManagement />
          </TabsContent>

          <TabsContent value="blockchain">
            <BlockchainMonitor />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
