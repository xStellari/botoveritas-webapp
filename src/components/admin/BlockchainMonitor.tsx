import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Shield, Link as LinkIcon, Clock, CheckCircle, XCircle } from "lucide-react";

export default function BlockchainMonitor() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTransactions();

    // Real-time updates
    const channel = supabase
      .channel('nft-transactions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'nft_transactions' },
        () => loadTransactions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadTransactions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("nft_transactions")
      .select(`
        *,
        elections:election_id (title),
        profiles:voter_id (first_name, last_name, student_id)
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (data) {
      setTransactions(data);
    }
    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return (
          <Badge className="bg-green-600">
            <CheckCircle className="h-3 w-3 mr-1" />
            Confirmed
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Blockchain Transaction Monitor
        </CardTitle>
        <CardDescription>
          Real-time NFT minting and blockchain verification tracking
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student ID</TableHead>
                <TableHead>Election</TableHead>
                <TableHead>Transaction Hash</TableHead>
                <TableHead>Network</TableHead>
                <TableHead>Gas Fee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    Loading transactions...
                  </TableCell>
                </TableRow>
              ) : transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    No transactions found
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-medium">
                      {tx.profiles?.student_id || "N/A"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {tx.elections?.title}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <LinkIcon className="h-3 w-3 text-muted-foreground" />
                        <code className="text-xs font-mono truncate max-w-[200px]">
                          {tx.transaction_hash}
                        </code>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{tx.blockchain_network}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.gas_fee ? `${tx.gas_fee} MATIC` : "-"}
                    </TableCell>
                    <TableCell>{getStatusBadge(tx.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(tx.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}