import React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import Index from "./pages/Index";
import Attract from "./pages/Attract";
import VotingKiosk from "./pages/VotingKiosk";
import KioskSetup from "./pages/KioskSetup";
import KioskProvision from "./pages/KioskProvision";
import NotFound from "./pages/NotFound";
import Admin from "./pages/Admin";
import Results from "./pages/Results";
import Verify from "./pages/Verify";
import RegistrationConfirmation from "./pages/RegistrationConfirmation";
import Register from "./pages/Register";
import Login from "./pages/Login";
import { useKioskHeartbeat } from "@/hooks/useKioskHeartbeat";
import { supabase } from "@/integrations/supabase/client";
import { getKioskSecret } from "@/utils/kioskIdentity";
import { AdminRoute } from "@/components/AdminRoute";
import RegisterVerify from "./pages/RegisterVerify";
import Error from "./pages/Error";
import VerifyEmail from "./pages/VerifyEmail";
import VerifyTally from "./pages/VerifyTally";

const queryClient = new QueryClient();

function HeartbeatGate() {
  const location = useLocation();
  const path = location.pathname;

  // Run on kiosk routes OR when a kiosk_secret exists (kiosk idle screen is Index)
  const hasSecret = Boolean((getKioskSecret() || "").trim());
  const onKioskRoute = path.startsWith("/kiosk") || path.startsWith("/voting");

  useKioskHeartbeat({ enabled: hasSecret && (onKioskRoute || hasSecret) });

  return null;
}

function IdleAttractGate() {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  // Only run idle attract on kiosk devices (when kiosk_secret exists).
  const hasSecret = Boolean((getKioskSecret() || "").trim());

  // 3 minutes of no touch => go to /attract (only from Home "/")
  const IDLE_MS = 180000;

  const lastActivityRef = React.useRef<number>(Date.now());

  React.useEffect(() => {
    if (!hasSecret) return;

    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };

    // Touchscreen kiosks: pointer events cover touch.
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("pointerup", onActivity, { passive: true });

    const t = window.setInterval(() => {
      if (path !== "/") return;
      if (Date.now() - lastActivityRef.current >= IDLE_MS) {
        navigate("/attract", { replace: true });
      }
    }, 1000);

    return () => {
      window.clearInterval(t);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointerup", onActivity);
    };
  }, [hasSecret, navigate, path]);

  return null;
}


const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
          <HeartbeatGate />
          <IdleAttractGate />
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Index />} />
          <Route path="/attract" element={<Attract />} />
          <Route path="/register" element={<Register />} />
          <Route path="/register/verify" element={<RegisterVerify />} />
          <Route path="/error" element={<Error />} />
          <Route path="/registration-error" element={<Error />} />
          <Route path="/registration-confirmation" element={<RegistrationConfirmation />} />
          <Route path="/voting" element={<VotingKiosk />} />
          <Route path="/kiosk/setup" element={<KioskSetup />} />
          <Route path="/kiosk/provision" element={<KioskProvision />} />
          <Route path="/results" element={<Results />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/verify/tally/:electionId" element={<VerifyTally />} />


          {/* Admin routes */}
          <Route path="/login" element={<Login />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;