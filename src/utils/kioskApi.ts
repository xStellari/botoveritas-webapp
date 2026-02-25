// src/utils/kioskApi.ts
// Lightweight client for kiosk Edge Functions (Option 3).
// These calls do NOT rely on Supabase Auth stored in localStorage.

import { getKioskId } from "@/utils/kioskIdentity";

type Json = Record<string, unknown>;

function getFunctionsBaseUrl(): string {
  // Vite builds often expose VITE_SUPABASE_URL.
  // Our Supabase client uses this under the hood, but for fetch we need the base URL.
  const url = (import.meta.env.VITE_SUPABASE_URL || "") as string;
  if (!url) return "";
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

function getKioskSecret(): string {
  return (import.meta.env.VITE_KIOSK_SECRET || "") as string;
}

async function post<T>(fnName: string, body: Json): Promise<T> {
  const base = getFunctionsBaseUrl();
  if (!base) {
    throw new Error("Missing VITE_SUPABASE_URL");
  }

  const kioskId = await getKioskId();
  const kioskSecret = getKioskSecret();
  if (!kioskSecret) {
    throw new Error("Missing VITE_KIOSK_SECRET");
  }

  const res = await fetch(`${base}/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kiosk-id": kioskId,
      "x-kiosk-secret": kioskSecret,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }

  if (!res.ok) {
    const msg = parsed?.error || parsed?.message || text || `HTTP ${res.status}`;
    const err = new Error(msg);
    (err as any).status = res.status;
    (err as any).body = parsed ?? text;
    throw err;
  }

  return parsed as T;
}

export type KioskVoterRow = {
  id: string;
  email: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  suffix: string | null;
  year_level: string | null;
  org_affiliations: string[] | null;
  rfid_tag: string | null;
  voter_audience?: string | null;
  face_descriptor: string[] | null;
  email_verified_at: string | null;
  created_at?: string;
};

export async function kioskGetVoterByRfid(rfidTag: string): Promise<KioskVoterRow | null> {
  const out = await post<{ ok: true; voter: KioskVoterRow | null }>("kiosk-get-voter-by-rfid", {
    rfid_tag: rfidTag,
  });
  return out.voter;
}

export type KioskSelection = {
  position: string;
  candidate_id: string | null;
  is_abstain: boolean;
};

export async function kioskSubmitVotes(args: {
  voter_id: string;
  election_id: string;
  selections: KioskSelection[];
}): Promise<{ ok: true }>
{
  return await post<{ ok: true }>("kiosk-submit-votes", args as any);
}

export async function kioskSession(action: string, payload: Json): Promise<any> {
  return await post<any>("kiosk-session", { action, ...payload });
}
