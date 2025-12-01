import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Sign in with email + password
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    // Query user_roles to check role
    const { data: roles, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id);

    if (roleError) {
      toast.error(roleError.message);
      setLoading(false);
      return;
    }

    if (roles?.[0]?.role === "admin") {
      toast.success("Logged in successfully!");
      navigate("/admin");
    } else {
      toast.error("Access denied. Only admins can log in here.");
      await supabase.auth.signOut();
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-feu-green via-background to-feu-gold p-4">
      <Card className="w-full max-w-md backdrop-blur-sm bg-background/95">
        <CardHeader className="text-center">
          <img src="/src/assets/feu-logo.png" alt="FEU Alabang" className="h-20 mx-auto mb-4" />
          <CardTitle className="text-2xl font-bold text-feu-green">Admin Login</CardTitle>
          <CardDescription>Restricted access for administrators</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                type="email"
                placeholder="admin@feualabang.edu.ph"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Logging in..." : "Login"}
            </Button>

            <p className="text-xs text-muted-foreground text-center mt-2">
              This page is for administrators only. Voters should register at /register.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
