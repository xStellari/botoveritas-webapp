import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export function AdminRoute({ children }: { children: JSX.Element }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const checkRole = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setAllowed(false);
        return;
      }

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);

      if (roles?.[0]?.role === "admin") {
        setAllowed(true);
      } else {
        setAllowed(false);
      }
    };

    checkRole();
  }, []);

  if (allowed === null) {
    return <div>Loading...</div>; // optional spinner
  }

  return allowed ? children : <Navigate to="/login" replace />;
}
