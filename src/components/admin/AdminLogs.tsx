import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Database } from "@/integrations/supabase/types";

type AuthLogRow = Database["public"]["Tables"]["auth_logs"]["Row"];
type SessionLogRow = Database["public"]["Tables"]["voter_session_logs"]["Row"];
type AdminAuditRow = Database["public"]["Tables"]["admin_audit_logs"]["Row"];
type HeartbeatRow = Database["public"]["Tables"]["kiosk_heartbeats"]["Row"];
type ReceiptRow = Database["public"]["Tables"]["voter_election_status"]["Row"];

const PAGE_SIZE = 50;

function formatDT(dt: string | null | undefined) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

function truncMiddle(s: string, left = 10, right = 8) {
  if (!s) return "";
  if (s.length <= left + right + 3) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

function jsonPreview(v: unknown, max = 140) {
  if (v == null) return "—";
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…`;
  } catch {
    return String(v);
  }
}

const POLYGON_AMOY_TX = "https://amoy.polygonscan.com/tx/";

export default function AdminLogs() {
  const [active, setActive] = useState<
    "auth" | "sessions" | "admin" | "heartbeats" | "receipts"
  >("auth");

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sort only for auth tab (by event_type)
  const [authSortDir, setAuthSortDir] = useState<"asc" | "desc">("asc");

  const [authRows, setAuthRows] = useState<AuthLogRow[]>([]);
  const [sessionRows, setSessionRows] = useState<SessionLogRow[]>([]);
  const [adminRows, setAdminRows] = useState<AdminAuditRow[]>([]);
  const [heartbeatRows, setHeartbeatRows] = useState<HeartbeatRow[]>([]);
  const [receiptRows, setReceiptRows] = useState<ReceiptRow[]>([]);

  const [hasNext, setHasNext] = useState(false);

  useEffect(() => {
    // reset paging whenever the tab or search query changes
    setPage(0);
  }, [active, query]);

  const range = useMemo(() => {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    return { from, to };
  }, [page]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (active === "auth") {
        let q = supabase
          .from("auth_logs")
          .select("*")
          .order("event_type", { ascending: authSortDir === "asc" })
          .order("created_at", { ascending: false })
          .range(range.from, range.to);

        const norm = query.trim();
        // Keep this simple and type-safe (no non-existent columns).
        // Search supports voter_id OR rfid_tag OR event_type.
        if (norm) {
          q = q.or(
            [
              `voter_id.ilike.%${norm}%`,
              `rfid_tag.ilike.%${norm}%`,
              `event_type.ilike.%${norm}%`,
            ].join(",")
          );
        }

        const { data, error } = await q;
        if (error) throw error;

        setAuthRows(data ?? []);
        setHasNext((data?.length ?? 0) === PAGE_SIZE);
      }

      if (active === "sessions") {
        let q = supabase
          .from("voter_session_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .range(range.from, range.to);

        const norm = query.trim();
        if (norm) {
          q = q.or(
            [
              `voter_id.ilike.%${norm}%`,
              `kiosk_id.ilike.%${norm}%`,
              `ip_address.ilike.%${norm}%`,
              `action.ilike.%${norm}%`,
              `user_agent.ilike.%${norm}%`,
            ].join(",")
          );
        }

        const { data, error } = await q;
        if (error) throw error;

        setSessionRows(data ?? []);
        setHasNext((data?.length ?? 0) === PAGE_SIZE);
      }

      if (active === "admin") {
        let q = supabase
          .from("admin_audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .range(range.from, range.to);

        const norm = query.trim();
        if (norm) {
          q = q.or(
            [
              `action.ilike.%${norm}%`,
              `entity_type.ilike.%${norm}%`,
              `entity_id.ilike.%${norm}%`,
              `admin_id.ilike.%${norm}%`,
            ].join(",")
          );
        }

        const { data, error } = await q;
        if (error) throw error;

        setAdminRows(data ?? []);
        setHasNext((data?.length ?? 0) === PAGE_SIZE);
      }

      if (active === "heartbeats") {
        let q = supabase
          .from("kiosk_heartbeats")
          .select("*")
          .order("heartbeat_at", { ascending: false })
          .range(range.from, range.to);

        const norm = query.trim();
        if (norm) {
          q = q.or(
            [
              `kiosk_id.ilike.%${norm}%`,
              `status.ilike.%${norm}%`,
              `ip_address.ilike.%${norm}%`,
              `user_agent.ilike.%${norm}%`,
            ].join(",")
          );
        }

        const { data, error } = await q;
        if (error) throw error;

        setHeartbeatRows(data ?? []);
        setHasNext((data?.length ?? 0) === PAGE_SIZE);
      }

      if (active === "receipts") {
        let q = supabase
          .from("voter_election_status")
          .select("*")
          .order("voted_at", { ascending: false })
          .range(range.from, range.to);

        const norm = query.trim();
        if (norm) {
          // This table has helpful denormalized voter fields.
          q = q.or(
            [
              `voter_id.ilike.%${norm}%`,
              `election_id.ilike.%${norm}%`,
              `tx_hash.ilike.%${norm}%`,
              `nft_token_id.ilike.%${norm}%`,
              `voter_email.ilike.%${norm}%`,
              `voter_first_name.ilike.%${norm}%`,
              `voter_last_name.ilike.%${norm}%`,
            ].join(",")
          );
        }

        const { data, error } = await q;
        if (error) throw error;

        setReceiptRows(data ?? []);
        setHasNext((data?.length ?? 0) === PAGE_SIZE);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load logs");
      setHasNext(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, authSortDir, range.from, range.to, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search logs…"
            className="w-full sm:w-[360px]"
          />
          <Button variant="secondary" onClick={() => load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={loading || page === 0}
          >
            Prev
          </Button>
          <div className="text-sm text-muted-foreground">
            Page <span className="font-medium text-foreground">{page + 1}</span>
          </div>
          <Button
            variant="outline"
            onClick={() => setPage((p) => (hasNext ? p + 1 : p))}
            disabled={loading || !hasNext}
          >
            Next
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs value={active} onValueChange={(v) => setActive(v as any)}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="auth">Auth</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="admin">Admin audit</TabsTrigger>
          <TabsTrigger value="heartbeats">Heartbeats</TabsTrigger>
          <TabsTrigger value="receipts">TX receipts</TabsTrigger>
        </TabsList>

        <TabsContent value="auth" className="mt-4">
          <div className="flex items-center justify-between pb-2">
            <div className="text-sm text-muted-foreground">
              Sorted by <span className="font-medium text-foreground">Event</span>{" "}
              ({authSortDir.toUpperCase()}).
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAuthSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              Toggle sort
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">Time</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Voter ID</TableHead>
                  <TableHead>RFID</TableHead>
                  <TableHead className="text-right">Distance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {authRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDT(r.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{r.event_type}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.voter_id ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.rfid_tag ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.distance_score ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {authRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm">
                      No auth logs found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Voter ID</TableHead>
                  <TableHead>Kiosk</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>User agent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDT(r.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{r.action}</TableCell>
                    <TableCell className="font-mono text-xs">{r.voter_id}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.kiosk_id ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.ip_address ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.user_agent ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {sessionRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm">
                      No session logs found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="admin" className="mt-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Entity ID</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminRows.map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell className="whitespace-nowrap">
                      {formatDT(r.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{r.action}</TableCell>
                    <TableCell>{r.entity_type}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncMiddle(r.entity_id, 10, 8)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.admin_id ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{jsonPreview(r.details)}</TableCell>
                  </TableRow>
                ))}
                {adminRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm">
                      No admin audit logs found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="heartbeats" className="mt-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">Heartbeat</TableHead>
                  <TableHead>Kiosk ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>User agent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {heartbeatRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDT(r.heartbeat_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.kiosk_id}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "online" ? "default" : "secondary"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.ip_address ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{r.user_agent ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {heartbeatRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm">
                      No heartbeats found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="receipts" className="mt-4">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">Voted at</TableHead>
                  <TableHead>Election</TableHead>
                  <TableHead>Voter</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Token ID</TableHead>
                  <TableHead>TX Hash</TableHead>
                  <TableHead className="text-center">Has voted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiptRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDT(r.voted_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncMiddle(r.election_id, 10, 8)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncMiddle(r.voter_id, 10, 8)}
                    </TableCell>
                    <TableCell className="text-xs">{r.voter_email ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.nft_token_id ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.tx_hash ? (
                        <a
                          className="underline underline-offset-2"
                          href={`${POLYGON_AMOY_TX}${r.tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          title={r.tx_hash}
                        >
                          {truncMiddle(r.tx_hash, 12, 10)}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={r.has_voted ? "default" : "secondary"}>
                        {r.has_voted ? "YES" : "NO"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {receiptRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm">
                      No receipts found.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <div className="pt-3 text-xs text-muted-foreground">
            Note: This tab shows <span className="font-medium text-foreground">DB receipts</span>{" "}
            from <span className="font-medium text-foreground">voter_election_status</span>. It
            doesn’t automatically validate on-chain status yet.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
