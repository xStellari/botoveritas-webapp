import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

type LogTab = "auth" | "sessions" | "admin" | "heartbeats" | "receipts";

const PAGE_SIZE = 10;
const POLYGON_AMOY_TX = "https://amoy.polygonscan.com/tx/";

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

export default function AdminLogs() {
  const [active, setActive] = useState<LogTab>("auth");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authSortDir, setAuthSortDir] = useState<"asc" | "desc">("asc");

  const [authRows, setAuthRows] = useState<AuthLogRow[]>([]);
  const [sessionRows, setSessionRows] = useState<SessionLogRow[]>([]);
  const [adminRows, setAdminRows] = useState<AdminAuditRow[]>([]);
  const [heartbeatRows, setHeartbeatRows] = useState<HeartbeatRow[]>([]);
  const [receiptRows, setReceiptRows] = useState<ReceiptRow[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [active, query]);

  const range = useMemo(() => {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    return { from, to };
  }, [page]);

  const currentRows =
    active === "auth"
      ? authRows
      : active === "sessions"
        ? sessionRows
        : active === "admin"
          ? adminRows
          : active === "heartbeats"
            ? heartbeatRows
            : receiptRows;

  const pageStart = currentRows.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = currentRows.length === 0 ? 0 : page * PAGE_SIZE + currentRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (active === "auth") {
        let q = supabase
          .from("auth_logs")
          .select("*", { count: "exact" })
          .order("event_type", { ascending: authSortDir === "asc" })
          .order("created_at", { ascending: false })
          .range(range.from, range.to);

        const norm = query.trim();
        if (norm) {
          q = q.or(
            [
              `voter_id.ilike.%${norm}%`,
              `rfid_tag.ilike.%${norm}%`,
              `event_type.ilike.%${norm}%`,
            ].join(",")
          );
        }

        const { data, error, count } = await q;
        if (error) throw error;
        setAuthRows(data ?? []);
        setTotalCount(count ?? 0);
        setHasNext((range.to + 1) < (count ?? 0));
      }

      if (active === "sessions") {
        let q = supabase
          .from("voter_session_logs")
          .select("*", { count: "exact" })
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

        const { data, error, count } = await q;
        if (error) throw error;
        setSessionRows(data ?? []);
        setTotalCount(count ?? 0);
        setHasNext((range.to + 1) < (count ?? 0));
      }

      if (active === "admin") {
        let q = supabase
          .from("admin_audit_logs")
          .select("*", { count: "exact" })
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

        const { data, error, count } = await q;
        if (error) throw error;
        setAdminRows(data ?? []);
        setTotalCount(count ?? 0);
        setHasNext((range.to + 1) < (count ?? 0));
      }

      if (active === "heartbeats") {
        let q = supabase
          .from("kiosk_heartbeats")
          .select("*", { count: "exact" })
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

        const { data, error, count } = await q;
        if (error) throw error;
        setHeartbeatRows(data ?? []);
        setTotalCount(count ?? 0);
        setHasNext((range.to + 1) < (count ?? 0));
      }

      if (active === "receipts") {
        let q = supabase
          .from("voter_election_status")
          .select("*", { count: "exact" })
          .order("voted_at", { ascending: false })
          .range(range.from, range.to);

        const norm = query.trim();
        if (norm) {
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

        const { data, error, count } = await q;
        if (error) throw error;
        setReceiptRows(data ?? []);
        setTotalCount(count ?? 0);
        setHasNext((range.to + 1) < (count ?? 0));
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load logs");
      setHasNext(false);
      setTotalCount(0);
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
      <Card className="border-dashed bg-muted/20">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs value={active} onValueChange={(v) => setActive(v as LogTab)} className="w-full lg:w-auto">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-2 md:grid-cols-5 lg:w-auto">
                <TabsTrigger value="auth">Auth</TabsTrigger>
                <TabsTrigger value="sessions">Sessions</TabsTrigger>
                <TabsTrigger value="admin">Admin</TabsTrigger>
                <TabsTrigger value="heartbeats">Heartbeats</TabsTrigger>
                <TabsTrigger value="receipts">Receipts</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search logs..."
                className="w-full sm:w-[260px]"
              />
              <Button variant="outline" onClick={() => void load()} disabled={loading}>
                Refresh
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border bg-background/80 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-muted-foreground">
              {loading ? "Loading logs..." : `Showing ${pageStart}-${pageEnd} of ${totalCount} ${active} logs`}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Page {page + 1} / {totalPages}</Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(0)}
                disabled={page === 0 || loading}
              >
                First
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext || loading}
              >
                Next
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(Math.max(0, totalPages - 1))}
                disabled={!hasNext || loading}
              >
                Last
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <Tabs value={active} onValueChange={(v) => setActive(v as LogTab)}>
        <TabsContent value="auth" className="mt-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Sorted by <span className="font-medium text-foreground">Event</span> ({authSortDir.toUpperCase()}).
            </div>
            <Button variant="outline" size="sm" onClick={() => setAuthSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
              Toggle sort
            </Button>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-background/80">
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
                {authRows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm">No auth logs found.</TableCell></TableRow>
                ) : authRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDT(r.created_at)}</TableCell>
                    <TableCell className="font-medium">{r.event_type}</TableCell>
                    <TableCell className="font-mono text-xs">{r.voter_id ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.rfid_tag ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.distance_score ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="sessions" className="mt-0">
          <div className="overflow-x-auto rounded-xl border bg-background/80">
            <Table>
              <TableHeader><TableRow><TableHead className="w-[170px]">Time</TableHead><TableHead>Action</TableHead><TableHead>Voter ID</TableHead><TableHead>Kiosk</TableHead><TableHead>IP</TableHead><TableHead>User agent</TableHead></TableRow></TableHeader>
              <TableBody>
                {sessionRows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm">No session logs found.</TableCell></TableRow>
                ) : sessionRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDT(r.created_at)}</TableCell>
                    <TableCell className="font-medium">{r.action}</TableCell>
                    <TableCell className="font-mono text-xs">{r.voter_id}</TableCell>
                    <TableCell className="font-mono text-xs">{r.kiosk_id ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.ip_address ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.user_agent ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="admin" className="mt-0">
          <div className="overflow-x-auto rounded-xl border bg-background/80">
            <Table>
              <TableHeader><TableRow><TableHead className="w-[170px]">Time</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Entity ID</TableHead><TableHead>Admin</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
              <TableBody>
                {adminRows.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-sm">No admin audit logs found.</TableCell></TableRow>
                ) : adminRows.map((r) => (
                  <TableRow key={String(r.id)}>
                    <TableCell className="whitespace-nowrap">{formatDT(r.created_at)}</TableCell>
                    <TableCell className="font-medium">{r.action}</TableCell>
                    <TableCell>{r.entity_type}</TableCell>
                    <TableCell className="font-mono text-xs">{truncMiddle(r.entity_id, 10, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.admin_id ?? "—"}</TableCell>
                    <TableCell className="text-xs">{jsonPreview(r.details)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="heartbeats" className="mt-0">
          <div className="overflow-x-auto rounded-xl border bg-background/80">
            <Table>
              <TableHeader><TableRow><TableHead className="w-[170px]">Heartbeat</TableHead><TableHead>Kiosk ID</TableHead><TableHead>Status</TableHead><TableHead>IP</TableHead><TableHead>User agent</TableHead></TableRow></TableHeader>
              <TableBody>
                {heartbeatRows.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm">No heartbeats found.</TableCell></TableRow>
                ) : heartbeatRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDT(r.heartbeat_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.kiosk_id}</TableCell>
                    <TableCell><Badge variant={r.status === "online" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{r.ip_address ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.user_agent ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="receipts" className="mt-0 space-y-3">
          <div className="overflow-x-auto rounded-xl border bg-background/80">
            <Table>
              <TableHeader><TableRow><TableHead className="w-[170px]">Voted at</TableHead><TableHead>Election</TableHead><TableHead>Voter</TableHead><TableHead>Email</TableHead><TableHead>Token ID</TableHead><TableHead>TX Hash</TableHead><TableHead className="text-center">Has voted</TableHead></TableRow></TableHeader>
              <TableBody>
                {receiptRows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm">No receipts found.</TableCell></TableRow>
                ) : receiptRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDT(r.voted_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{truncMiddle(r.election_id, 10, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">{truncMiddle(r.voter_id, 10, 8)}</TableCell>
                    <TableCell className="text-xs">{r.voter_email ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.nft_token_id ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.tx_hash ? (
                        <a className="underline underline-offset-2" href={`${POLYGON_AMOY_TX}${r.tx_hash}`} target="_blank" rel="noreferrer" title={r.tx_hash}>
                          {truncMiddle(r.tx_hash, 12, 10)}
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-center"><Badge variant={r.has_voted ? "default" : "secondary"}>{r.has_voted ? "YES" : "NO"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="text-xs text-muted-foreground">
            Note: This tab shows <span className="font-medium text-foreground">DB receipts</span> from <span className="font-medium text-foreground">voter_election_status</span>. It doesn&apos;t automatically validate on-chain status yet.
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex flex-col gap-2 border-t pt-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>{loading ? "Loading..." : `Showing ${pageStart}-${pageEnd} of ${totalCount} on page ${page + 1} / ${totalPages}`}</span>
        <span>{hasNext ? "More logs available" : totalCount === 0 ? "No matching logs" : "End of results"}</span>
      </div>
    </div>
  );
}
