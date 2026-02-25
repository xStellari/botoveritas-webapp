// supabase/functions/_shared/kioskAuth.ts
// Shared kiosk authorization helper for Option 3 (Edge Functions + service role).
//
// Model:
// - Kiosk must send headers:
//   - x-kiosk-id (fixed per physical kiosk)
//   - x-kiosk-secret (daily secret; valid only for the current local date in Asia/Manila)
// - Server validates:
//   1) kiosk exists + approved + not revoked (public.kiosk_devices)
//   2) daily secret matches (public.kiosk_daily_secrets for today's date)
// - On successful auth, updates kiosk_devices.last_seen_at for "Active kiosks" UI.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const kioskCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-kiosk-id, x-kiosk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...kioskCorsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSecret(length = 48): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// Returns YYYY-MM-DD for the current date in Asia/Manila.
// This is critical to enforce the "00:00–23:59 local time" validity window.
function getManilaDateString(now = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA gives YYYY-MM-DD
  return dtf.format(now);
}

function getManilaYesterdayDateString(now = new Date()): string {
  // Manila has no DST, so subtracting 24h is safe for "yesterday".
  return getManilaDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

export async function requireKioskAuth(
  req: Request,
  service: SupabaseClient,
): Promise<{ kiosk_id: string; valid_date: string; rotate_secret?: string | null } | Response> {
  const kioskId = (req.headers.get("x-kiosk-id") ?? "").trim();
  const kioskSecret = (req.headers.get("x-kiosk-secret") ?? "").trim();

  if (!kioskId || !kioskSecret) {
    return json(401, { ok: false, error: "Missing kiosk credentials" });
  }

  // 1) kiosk exists + approved + not revoked
  const { data: kiosk, error: kioskErr } = await service
    .from("kiosk_devices")
    .select("kiosk_id, approved, is_approved, revoked_at")
    .eq("kiosk_id", kioskId)
    .maybeSingle<
      { kiosk_id: string; approved: boolean; is_approved: boolean; revoked_at: string | null }
    >();

  if (kioskErr) {
    return json(500, { ok: false, error: "Failed to validate kiosk" });
  }

  const approved = Boolean(kiosk?.approved ?? kiosk?.is_approved);
  if (!kiosk || !approved) {
    return json(403, { ok: false, error: "Kiosk not approved" });
  }
  if (kiosk.revoked_at) {
    return json(403, { ok: false, error: "Kiosk revoked" });
  }

  // 2) daily secret must match today's Manila date
  // Important: Supabase DB runs in UTC by default. We enforce "today" in Asia/Manila.
  //
  // Ops requirement: kiosks should not require admin re-provisioning after midnight.
  // If the kiosk still has yesterday's valid secret, allow ONE graceful request to:
  //   - authenticate against yesterday's secret, then
  //   - mint and return a new secret for today's Manila date (rotate_secret), and
  //   - upsert today's secret in kiosk_daily_secrets.
  const now = new Date();
  const today = getManilaDateString(now);
  const yesterday = getManilaYesterdayDateString(now);
  const providedHash = await sha256Hex(kioskSecret);

  const { data: todayRow, error: todayErr } = await service
    .from("kiosk_daily_secrets" as any)
    .select("kiosk_id, valid_date, secret_hash, revoked_at")
    .eq("kiosk_id", kioskId)
    .eq("valid_date", today)
    .maybeSingle();

  if (todayErr) {
    return json(500, { ok: false, error: "Failed to validate daily kiosk secret" });
  }

  // Happy path: today's secret exists and matches.
  if (todayRow && !todayRow.revoked_at) {
    if (String(todayRow.secret_hash) !== providedHash) {
      return json(403, { ok: false, error: "Invalid kiosk secret" });
    }

    // Best-effort: mark kiosk as "seen" (do not block auth if this fails)
    try {
      await service
        .from("kiosk_devices")
        .update({ last_seen_at: now.toISOString() } as any)
        .eq("kiosk_id", kioskId);
    } catch {
      // ignore
    }

    return { kiosk_id: kioskId, valid_date: today, rotate_secret: null };
  }

  // Graceful rollover: accept yesterday's valid secret and rotate to today.
  const { data: yRow, error: yErr } = await service
    .from("kiosk_daily_secrets" as any)
    .select("kiosk_id, valid_date, secret_hash, revoked_at")
    .eq("kiosk_id", kioskId)
    .eq("valid_date", yesterday)
    .maybeSingle();

  if (yErr) {
    return json(500, { ok: false, error: "Failed to validate daily kiosk secret" });
  }

  if (!yRow || yRow.revoked_at) {
    return json(403, { ok: false, error: "Kiosk not provisioned for today" });
  }

  if (String(yRow.secret_hash) !== providedHash) {
    return json(403, { ok: false, error: "Invalid kiosk secret" });
  }

  // Mint today's secret and return it for the client to persist.
  const rotateSecret = randomSecret(48);
  const rotateHash = await sha256Hex(rotateSecret);
  const issuedAt = now.toISOString();

  // Upsert today's row (and ensure revoked_at is cleared).
  try {
    await service
      .from("kiosk_daily_secrets" as any)
      .upsert(
        {
          kiosk_id: kioskId,
          valid_date: today,
          secret_hash: rotateHash,
          issued_at: issuedAt,
          revoked_at: null,
        } as any,
        { onConflict: "kiosk_id,valid_date" } as any,
      );
  } catch {
    return json(500, { ok: false, error: "Failed to rotate daily kiosk secret" });
  }

  // Best-effort: keep legacy columns in sync + mark as seen.
  try {
    await service
      .from("kiosk_devices")
      .update({
        last_seen_at: issuedAt,
        secret_sha256: rotateHash,
        kiosk_secret_hash: rotateHash,
        secret_issued_at: issuedAt,
      } as any)
      .eq("kiosk_id", kioskId);
  } catch {
    // ignore
  }

  return { kiosk_id: kioskId, valid_date: today, rotate_secret: rotateSecret };
}
