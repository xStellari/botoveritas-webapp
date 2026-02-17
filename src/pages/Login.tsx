import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function Login() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const normalizedEmail = useMemo(
    () => loginEmail.trim().toLowerCase(),
    [loginEmail]
  );

  const canSubmit =
    normalizedEmail.length > 3 && loginPassword.length > 0 && !loading;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: loginPassword,
      });

      if (error) {
        toast.error("Invalid credentials.");
        return;
      }

      const userId = data?.user?.id;
      if (!userId) {
        toast.error("Session error. Please try again.");
        return;
      }

      const { data: roleRow, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

      if (roleError) {
        toast.error("Unable to verify access. Please try again.");
        return;
      }

      if (roleRow?.role === "admin") {
        navigate("/admin");
      } else {
        toast.error("Access denied.");
        await supabase.auth.signOut();
      }
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden grid lg:grid-cols-2 bg-gradient-to-br from-[#004225] via-[#013d2a] to-[#bfa046] text-white">
      {/* subtle animated backdrop */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-[pulse_6s_ease-in-out_infinite]" />
        <div className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-black/20 blur-3xl animate-[pulse_7s_ease-in-out_infinite]" />
        <div className="absolute top-1/2 left-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-200/10 blur-3xl animate-[pulse_8s_ease-in-out_infinite]" />
      </div>

      {/* LEFT BRAND PANEL */}
      <div className="hidden lg:flex flex-col justify-center items-center p-16 relative">
        <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

        <div className="relative z-10 text-center space-y-6 max-w-md animate-in fade-in slide-in-from-left-6 duration-700">
          <img
            src="/FEU_Alabang_logo.png"
            alt="FEU Alabang"
            className="h-20 mx-auto opacity-90 drop-shadow-sm"
          />

          <h1 className="text-4xl font-bold tracking-tight drop-shadow-sm">
            BotoVeritas
          </h1>

          <p className="text-white/80 text-sm leading-relaxed">
            Secure administrative portal for managing elections, candidates, and
            voting operations.
          </p>

          <div className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-emerald-100 ring-1 ring-white/15 shadow-sm">
            <ShieldCheck className="h-4 w-4" />
            Secure Admin Access
          </div>
        </div>
      </div>

      {/* RIGHT LOGIN PANEL */}
      <div className="relative flex items-center justify-center p-6 bg-white text-black">
        {/* depth layer */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(191,160,70,0.12),_transparent_55%)]" />

        <div className="relative w-full max-w-md">
          <div className="bg-white/80 backdrop-blur-xl shadow-2xl rounded-2xl p-10 border border-gray-200/80 ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-500 hover:shadow-[0_25px_60px_-25px_rgba(0,0,0,0.35)] transition-shadow">
            <div className="mb-8 text-center">
              <div className="flex justify-center mb-4">
                <div className="bg-emerald-600 p-3 rounded-full shadow-lg ring-1 ring-emerald-700/30 animate-[float_6s_ease-in-out_infinite]">
                  <Lock className="h-5 w-5 text-white" />
                </div>
              </div>

              <h2 className="text-2xl font-bold text-gray-900">
                Admin Login
              </h2>

              <p className="text-sm text-gray-500 mt-1">
                Enter your credentials to continue
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="Email address"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  disabled={loading}
                  className="h-11 transition-shadow focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                  required
                />
              </div>

              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="Password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  disabled={loading}
                  className="h-11 transition-shadow focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={!canSubmit}
                className="w-full h-11 text-sm font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.99]"
              >
                {loading ? "Authenticating..." : "Login"}
              </Button>

              <p className="text-[11px] text-gray-500 text-center">
                Authorized personnel only.
              </p>
            </form>
          </div>

          {/* tiny footer */}
          <p className="text-xs text-gray-500 text-center mt-6">
            If you believe this is an error, contact your system administrator.
          </p>
        </div>

        {/* keyframes via tailwind arbitrary animation name; falls back gracefully if not supported */}
        <style>{`
          @keyframes float {\n            0%, 100% { transform: translateY(0); }\n            50% { transform: translateY(-6px); }\n          }
        `}</style>
      </div>
    </div>
  );
}
