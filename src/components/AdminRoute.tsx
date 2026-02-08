import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export function AdminRoute({ children }: { children: JSX.Element }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const checkAdmin = async () => {
      try {
        setAllowed(null);

        // ✅ Authoritative user check
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) {
          console.warn("[AdminRoute] getUser error:", userErr);
          if (!cancelled) setAllowed(false);
          return;
        }

        const user = userRes?.user;
        if (!user) {
          if (!cancelled) setAllowed(false);
          return;
        }

        // ✅ Whitelist-only: must have explicit admin row
        const { data: roles, error: rolesErr } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .limit(1);

        if (rolesErr) {
          console.warn("[AdminRoute] user_roles select error:", rolesErr);
          if (!cancelled) setAllowed(false);
          return;
        }

        if (!cancelled) setAllowed(!!roles?.length);
      } catch (e) {
        console.warn("[AdminRoute] unexpected error:", e);
        if (!cancelled) setAllowed(false);
      }
    };

    // Initial check
    void checkAdmin();

    // Re-check whenever auth state changes (login/logout/token refresh)
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void checkAdmin();
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  if (allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Verifying admin access…</p>
      </div>
    );
  }

  return allowed ? children : <Navigate to="/" replace />;
}
