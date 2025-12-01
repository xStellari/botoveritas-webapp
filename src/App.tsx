import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import VotingKiosk from "./pages/VotingKiosk";
import NotFound from "./pages/NotFound";
import Admin from "./pages/Admin";
import Results from "./pages/Results";
import RegistrationConfirmation from "./pages/RegistrationConfirmation";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Kiosk from "./pages/Kiosk";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/AdminRoute";


const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Index />} />
          <Route path="/register" element={<Register />} />
          <Route path="/registration-confirmation" element={<RegistrationConfirmation />} />
          <Route path="/voting" element={<VotingKiosk />} />
          <Route path="/results" element={<Results />} />
          <Route path="/kiosk" element={<Kiosk />} />

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
