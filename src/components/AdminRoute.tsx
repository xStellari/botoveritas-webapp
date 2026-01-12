import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export function AdminRoute({ children }: { children: JSX.Element }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAdmin = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      // No session → not an admin → send to public landing
      if (!session) {
        setAllowed(false);
        return;
      }

      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id)
        .eq("role", "admin");

      setAllowed(!error && !!roles?.length);
    };

    checkAdmin();
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
