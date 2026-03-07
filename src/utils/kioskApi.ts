// src/utils/kioskApi.ts
// Lightweight client for kiosk Edge Functions.
// These calls do NOT rely on Supabase Auth stored in localStorage.

import { getConfiguredKioskId, getKioskSecret, updateKioskSecret } from "@/utils/kioskIdentity";

type Json = Record<string, unknown>;

function getFunctionsBaseUrl(): string {
  const url = (import.meta.env.VITE_SUPABASE_URL || "") as string;
  if (!url) return "";
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

async function post<T>(fnName: string, body: Json): Promise<T> {
  const base = getFunctionsBaseUrl();
  if (!base) throw new Error("Missing VITE_SUPABASE_URL");

  const envKioskId = (import.meta as any)?.env?.VITE_KIOSK_ID as string | undefined;
  const configuredKioskId = getConfiguredKioskId();
  const kioskId = ((envKioskId || "").trim() || (configuredKioskId || "").trim());

  const kioskSecret = getKioskSecret();

  if (!kioskId) {
    throw new Error(
      "Kiosk not configured (missing kiosk id). Visit /kiosk/setup?kiosk_id=...&kiosk_secret=... to provision this device.",
    );
  }

  if (!kioskSecret) {
    throw new Error(
      "Kiosk not configured (missing secret). Visit /kiosk/setup?kiosk_id=...&kiosk_secret=... to provision this device.",
    );
  }

  const res = await fetch(`${base}/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": ((import.meta as any)?.env?.VITE_SUPABASE_ANON_KEY as string | undefined) || "",
      "Authorization": `Bearer ${(((import.meta as any)?.env?.VITE_SUPABASE_ANON_KEY as string | undefined) || "")}`,
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

  // Transparent weekly secret rotation: if server returns rotate_secret, persist it.
  const rotateSecret = parsed?.rotate_secret as string | undefined;
  if (rotateSecret && typeof rotateSecret === "string" && rotateSecret.trim()) {
    updateKioskSecret(rotateSecret, { persist: true });
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
  // JSON payload from DB may be number[] or string[] depending on serialization
  face_descriptor: Array<number | string> | null;
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

export type KioskVoterElectionStatus = {
  election_id: string;
  has_voted: boolean;
};

export async function kioskSubmitVotes(args: {
  voter_id: string;
  election_id: string;
  selections: KioskSelection[];
}): Promise<{ ok: true }> {
  return await post<{ ok: true }>("kiosk-submit-votes", args as any);
}

export async function kioskGetVoterElectionStatus(args: {
  voter_id: string;
  election_ids: string[];
}): Promise<KioskVoterElectionStatus[]> {
  const out = await post<{
    ok: true;
    statuses: KioskVoterElectionStatus[];
  }>("kiosk-get-voter-election-status", args as any);
  return Array.isArray(out.statuses) ? out.statuses : [];
}

export async function kioskSession(action: string, payload: Json): Promise<any> {
  return await post<any>("kiosk-session", { action, ...payload });
}

export async function kioskAuthLog(args: {
  event_type: string;
  rfid_tag: string | null;
  distance_score?: number | null;
  voter_id?: string | null;
}): Promise<{ ok: true }> {
  return await post<{ ok: true }>("kiosk-auth-log", {
    event_type: args.event_type,
    rfid_tag: args.rfid_tag,
    distance_score: typeof args.distance_score === "number" ? args.distance_score : null,
    voter_id: args.voter_id ?? null,
  });
}
