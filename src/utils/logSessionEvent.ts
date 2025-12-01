import { supabase } from "@/integrations/supabase/client";

export async function logSessionEvent({
  voterId,
  action,
  kioskId,
}: {
  voterId: string;
  action:
    | "session_start"
    | "session_extend"
    | "session_end"
    | "simultaneous_block";
  kioskId?: string;
}) {
  try {
    const ua = navigator.userAgent || null;

    // ❗ DO NOT fetch IP from client (privacy risk & can fail)
    // Let server/edge function populate ip_address in future version
    const ip = null;

    const { error } = await supabase.from("voter_session_logs").insert({
      voter_id: voterId,
      action,
      kiosk_id: kioskId || null,
      ip_address: ip,
      user_agent: ua,
    });

    if (error) {
      console.error("[logSessionEvent] Insert failed:", error.message);
    }
  } catch (err) {
    console.error("[logSessionEvent] Unexpected error:", err);
  }
}
