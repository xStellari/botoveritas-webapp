import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, FileText, Layers, RefreshCw } from "lucide-react";

type ElectionRow = {
  id: string;
  title: string;
  is_final: boolean | null;
  is_archived: boolean | null;
  finalized_at: string | null;
};

type ManifestRow = {
  election_id: string;
  manifest_hash: string;
  updated_at: string;
};

type ChunkRow = {
  election_id: string;
  chunk_index: number;
  leaf_count: number;
  chunk_root: string;
  created_at: string;
};

function shortHex(hex: string, keep = 10) {
  const h = String(hex || "");
  if (!h) return "—";
  if (h.length <= keep * 2) return h;
  return `${h.slice(0, keep)}…${h.slice(-keep)}`;
}

export default function ZKVerification() {
  const [loading, setLoading] = useState(true);
  const [elections, setElections] = useState<ElectionRow[]>([]);
  const [manifests, setManifests] = useState<Record<string, ManifestRow>>({});
  const [chunkStats, setChunkStats] = useState<
    Record<string, { chunkCount: number; totalLeaves: number; lastChunkAt: string | null }>
  >({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const finalizedCount = useMemo(
    () => elections.filter((e) => Boolean(e.is_final) && !Boolean(e.is_archived)).length,
    [elections],
  );
  const manifestCount = useMemo(() => Object.keys(manifests).length, [manifests]);
  const withChunksCount = useMemo(
    () => Object.values(chunkStats).filter((s) => (s?.chunkCount ?? 0) > 0).length,
    [chunkStats],
  );

  const load = async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      // 1) Elections
      const { data: eData, error: eErr } = await supabase
        .from("elections")
        .select("id,title,is_final,is_archived,finalized_at")
        .order("created_at", { ascending: false });

      if (eErr) throw eErr;
      const eRows = (eData ?? []) as unknown as ElectionRow[];
      setElections(eRows);

      // 2) Manifests (one per election via unique constraint)
      const { data: mData, error: mErr } = await supabase
        .from("election_manifests")
        .select("election_id,manifest_hash,updated_at")
        .order("updated_at", { ascending: false });

      if (mErr) throw mErr;

      const mMap: Record<string, ManifestRow> = {};
      for (const m of (mData ?? []) as unknown as ManifestRow[]) {
        mMap[m.election_id] = m;
      }
      setManifests(mMap);

      // 3) Chunk stats
      const { data: cData, error: cErr } = await supabase
        .from("election_vote_chunks")
        .select("election_id,chunk_index,leaf_count,chunk_root,created_at")
        .order("created_at", { ascending: false });

      if (cErr) throw cErr;

      const stats: Record<string, { chunkCount: number; totalLeaves: number; lastChunkAt: string | null }> = {};
      for (const c of (cData ?? []) as unknown as ChunkRow[]) {
        const key = c.election_id;
        if (!stats[key]) stats[key] = { chunkCount: 0, totalLeaves: 0, lastChunkAt: c.created_at ?? null };
        stats[key].chunkCount += 1;
        stats[key].totalLeaves += Number(c.leaf_count ?? 0);
        if (!stats[key].lastChunkAt) stats[key].lastChunkAt = c.created_at ?? null;
      }
      setChunkStats(stats);
    } catch (err: any) {
      setErrorMsg(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    // Lightweight realtime refresh for admin visibility
    const ch = supabase
      .channel("zk-verification-console")
      .on("postgres_changes", { event: "*", schema: "public", table: "elections" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "election_manifests" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "election_vote_chunks" }, load)
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusBadge = (e: ElectionRow) => {
    if (Boolean(e.is_archived)) {
      return <Badge className="border-amber-600 text-amber-700 bg-amber-600/10">Archived</Badge>;
    }
    if (Boolean(e.is_final)) {
      return <Badge className="border-violet-600 text-violet-700 bg-violet-600/10">Finalized</Badge>;
    }
    return <Badge variant="outline">Draft</Badge>;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            ZK Verification Console
          </CardTitle>
          <CardDescription>
            Admin-only health view for the ZK pipeline prerequisites: election finalization → manifest → vote chunks (Merkle roots).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Elections: {elections.length}</Badge>
            <Badge variant="secondary">Finalized (not archived): {finalizedCount}</Badge>
            <Badge variant="secondary">Manifests: {manifestCount}</Badge>
            <Badge variant="secondary">Elections with chunks: {withChunksCount}</Badge>

            <div className="flex-1" />

            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          {errorMsg ? (
            <div className="mt-4 rounded-lg border border-red-600/30 bg-red-600/5 p-3 text-sm text-red-800">
              {errorMsg}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Elections readiness
          </CardTitle>
          <CardDescription>
            “Ready” here only means DB prerequisites exist. On-chain anchoring and witness generation are performed by Edge Functions (protected by kiosk/admin secrets).
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Election</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Manifest</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Total Leaves</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : elections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center">
                      No elections found.
                    </TableCell>
                  </TableRow>
                ) : (
                  elections.map((e) => {
                    const m = manifests[e.id];
                    const s = chunkStats[e.id];

                    const hasManifest = Boolean(m?.manifest_hash);
                    const chunkCount = s?.chunkCount ?? 0;
                    const totalLeaves = s?.totalLeaves ?? 0;

                    const ready = Boolean(e.is_final) && hasManifest && chunkCount > 0;

                    const lastUpdated = (s?.lastChunkAt || m?.updated_at || e.finalized_at || null) as string | null;

                    return (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{e.title}</span>
                            {ready ? (
                              <Badge className="border-emerald-600 text-emerald-700 bg-emerald-600/10">Ready</Badge>
                            ) : (
                              <Badge variant="outline">Not ready</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 font-mono">{e.id}</div>
                        </TableCell>

                        <TableCell>{statusBadge(e)}</TableCell>

                        <TableCell>
                          {hasManifest ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">Yes</Badge>
                              <code className="text-xs font-mono">{shortHex(m!.manifest_hash)}</code>
                            </div>
                          ) : (
                            <Badge variant="outline">Missing</Badge>
                          )}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Layers className="h-4 w-4 text-muted-foreground" />
                            <span>{chunkCount}</span>
                          </div>
                        </TableCell>

                        <TableCell className="font-mono text-xs">{totalLeaves}</TableCell>

                        <TableCell className="text-sm text-muted-foreground">
                          {lastUpdated ? new Date(lastUpdated).toLocaleString() : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
