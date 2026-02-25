import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCcw, Copy, Eye, EyeOff } from "lucide-react";

type CreateOk = {
  ok: true;
  token_id: string;
  token: string;
  code: string;
  expires_at: string;
  provision_url: string;
};

type KioskRow = {
  kiosk_id: string;
  kiosk_name: string | null;
  is_approved: boolean;
  approved_at: string | null;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

type ProvisionTokenRow = {
  id: string;
  code: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_kiosk_id: string | null;
};

type DailySecretRow = {
  kiosk_id: string;
  valid_date: string;
  issued_at: string;
  revoked_at: string | null;
};

function getFunctionsBaseUrl(): string {
  const url = (import.meta.env.VITE_SUPABASE_URL || "") as string;
  if (!url) return "";
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

async function createProvisionToken(): Promise<CreateOk> {
  const base = getFunctionsBaseUrl();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "") as string;
  if (!base) throw new Error("Missing VITE_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing VITE_SUPABASE_ANON_KEY");

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Not authenticated");

  const res = await fetch(`${base}/admin-kiosk-provision-create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({}),
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const msg = parsed?.error || parsed?.message || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return parsed as CreateOk;
}

export default function KioskProvisioning() {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<CreateOk | null>(null);
  const [now, setNow] = useState(Date.now());

  const [loadingLists, setLoadingLists] = useState(false);
  const [kiosks, setKiosks] = useState<KioskRow[]>([]);
  const [tokens, setTokens] = useState<ProvisionTokenRow[]>([]);
  const [todaySecrets, setTodaySecrets] = useState<Record<string, DailySecretRow>>({});
  const [tokenFilter, setTokenFilter] = useState<"all" | "unused" | "used" | "expired">("all");
  const [revealedTokenIds, setRevealedTokenIds] = useState<Set<string>>(new Set());
  const loadSeq = useRef(0);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const manilaToday = useMemo(() => {
    // YYYY-MM-DD in Asia/Manila
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value ?? "0000";
    const m = parts.find((p) => p.type === "month")?.value ?? "00";
    const d = parts.find((p) => p.type === "day")?.value ?? "00";
    return `${y}-${m}-${d}`;
  }, [now]);

  const expiresInSec = useMemo(() => {
    if (!token?.expires_at) return null;
    const ms = new Date(token.expires_at).getTime() - now;
    return Math.max(0, Math.floor(ms / 1000));
  }, [token?.expires_at, now]);

  const computeTokenStatus = (t: ProvisionTokenRow): "UNUSED" | "USED" | "EXPIRED" => {
    if (t.used_at) return "USED";
    const expired = new Date(t.expires_at).getTime() <= now;
    return expired ? "EXPIRED" : "UNUSED";
  };

  const computeKioskStatus = (k: KioskRow): "ACTIVE" | "OFFLINE" | "REVOKED" => {
    if (k.revoked_at) return "REVOKED";
    if (!k.last_seen_at) return "OFFLINE";
    const last = new Date(k.last_seen_at).getTime();
    return now - last <= 90_000 ? "ACTIVE" : "OFFLINE";
  };

  const getTodaySecretStatus = (kioskId: string): "PROVISIONED" | "NOT_PROVISIONED" | "REVOKED" => {
    const s = todaySecrets[kioskId];
    if (!s) return "NOT_PROVISIONED";
    if (s.revoked_at) return "REVOKED";
    return "PROVISIONED";
  };

  const refreshLists = async () => {
    const seq = ++loadSeq.current;
    setLoadingLists(true);
    try {
      const [{ data: kioskData, error: kioskErr }, { data: tokenData, error: tokenErr }] = await Promise.all([
        supabase
          .from("kiosk_devices")
          .select("kiosk_id,kiosk_name,is_approved,approved_at,created_at,last_seen_at,revoked_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("kiosk_provision_tokens")
          .select("id,code,created_at,expires_at,used_at,used_kiosk_id")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      if (seq !== loadSeq.current) return;
      if (kioskErr) throw kioskErr;
      if (tokenErr) throw tokenErr;

      setKiosks((kioskData ?? []) as KioskRow[]);
      setTokens((tokenData ?? []) as ProvisionTokenRow[]);

      // Daily secrets are optional until migration is applied.
      const { data: secretData, error: secretErr } = await supabase
        .from("kiosk_daily_secrets")
        .select("kiosk_id,valid_date,issued_at,revoked_at")
        .eq("valid_date", manilaToday);

      if (!secretErr && secretData) {
        const map: Record<string, DailySecretRow> = {};
        for (const row of secretData as DailySecretRow[]) map[row.kiosk_id] = row;
        setTodaySecrets(map);
      } else {
        // If table doesn't exist yet, keep it empty without spamming errors.
        setTodaySecrets({});
      }
    } catch (e) {
      toast.error("Failed to load kiosks data", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      if (seq === loadSeq.current) setLoadingLists(false);
    }
  };

  useEffect(() => {
    void refreshLists();
    const t = window.setInterval(() => void refreshLists(), 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manilaToday]);

  const gen = async () => {
    setBusy(true);
    try {
      const out = await createProvisionToken();
      setToken(out);
      toast.success("Provision code generated", { description: "Valid for 10 minutes." });
      void refreshLists();
    } catch (e) {
      toast.error("Failed to generate provision code", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const toggleReveal = (id: string) => {
    setRevealedTokenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredTokens = useMemo(() => {
    if (tokenFilter === "all") return tokens;
    return tokens.filter((t) => {
      const status = computeTokenStatus(t);
      if (tokenFilter === "unused") return status === "UNUSED";
      if (tokenFilter === "used") return status === "USED";
      if (tokenFilter === "expired") return status === "EXPIRED";
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, tokenFilter, now]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Kiosk Provisioning</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={gen} disabled={busy}>
              <RefreshCcw className="h-4 w-4 mr-2" />
              Generate new code
            </Button>
            <div className="text-sm text-muted-foreground">
              Code valid for <span className="font-medium">10 minutes</span>.
              {expiresInSec === null
                ? ""
                : ` Expires in: ${expiresInSec > 0 ? `${expiresInSec}s` : "Expired (generate again)"}`}
            </div>
          </div>

          {!token ? (
            <div className="text-sm text-muted-foreground">Generate a code, then enter it on the kiosk at /kiosk/provision.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-3 space-y-2">
                <Label className="text-sm">6-digit code (type on kiosk)</Label>
                <div className="flex gap-2">
                  <Input value={token.code} readOnly className="text-lg tracking-widest text-center" />
                  <Button type="button" variant="outline" onClick={() => copy(token.code)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Kiosk page will auto-submit when 6 digits are entered.
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-2">
                <Label className="text-sm">Provision URL (backup)</Label>
                <div className="flex gap-2">
                  <Input value={token.provision_url} readOnly />
                  <Button type="button" variant="outline" onClick={() => copy(token.provision_url)}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  If needed, open this URL on the kiosk (it provisions automatically via token).
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Today (Asia/Manila): <span className="font-medium">{manilaToday}</span>
        </div>
        <Button variant="outline" onClick={refreshLists} disabled={loadingLists}>
          <RefreshCcw className="h-4 w-4 mr-2" /> Refresh lists
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registered Kiosks</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kiosk ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Today Secret</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead>Approved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kiosks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    No kiosks found.
                  </TableCell>
                </TableRow>
              ) : (
                kiosks.map((k) => {
                  const st = computeKioskStatus(k);
                  const secretSt = getTodaySecretStatus(k.kiosk_id);
                  return (
                    <TableRow key={k.kiosk_id}>
                      <TableCell className="font-medium">{k.kiosk_name || "(Unnamed)"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-2">
                          <span>{k.kiosk_id}</span>
                          <Button size="icon" variant="ghost" onClick={() => void copy(k.kiosk_id)}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={st === "ACTIVE" ? "default" : st === "REVOKED" ? "destructive" : "secondary"}>
                          {st}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            secretSt === "PROVISIONED" ? "default" : secretSt === "REVOKED" ? "destructive" : "secondary"
                          }
                        >
                          {secretSt === "PROVISIONED"
                            ? "PROVISIONED TODAY"
                            : secretSt === "REVOKED"
                              ? "REVOKED"
                              : "NOT PROVISIONED"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {k.last_seen_at ? new Date(k.last_seen_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={k.is_approved ? "default" : "secondary"}>{k.is_approved ? "YES" : "NO"}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provision Codes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Tabs value={tokenFilter} onValueChange={(v) => setTokenFilter(v as typeof tokenFilter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="unused">Unused</TabsTrigger>
              <TabsTrigger value="used">Used</TabsTrigger>
              <TabsTrigger value="expired">Expired</TabsTrigger>
            </TabsList>
          </Tabs>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Used</TableHead>
                <TableHead>Used by kiosk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTokens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    No provision tokens.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTokens.map((t) => {
                  const status = computeTokenStatus(t);
                  const revealed = revealedTokenIds.has(t.id);
                  const showReal = revealed && status === "UNUSED";
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono">
                        <div className="flex items-center gap-2">
                          <span>{showReal ? t.code : "••••••"}</span>
                          {status === "UNUSED" ? (
                            <>
                              <Button size="icon" variant="ghost" onClick={() => toggleReveal(t.id)}>
                                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => void copy(t.code)}
                                disabled={!showReal}
                                title={showReal ? "Copy code" : "Reveal first"}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={status === "UNUSED" ? "default" : status === "USED" ? "secondary" : "destructive"}>
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(t.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{new Date(t.expires_at).toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.used_at ? new Date(t.used_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{t.used_kiosk_id ?? "—"}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
