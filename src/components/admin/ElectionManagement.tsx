import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Play, Square } from "lucide-react";
import { toast } from "sonner";

export default function ElectionManagement() {
  const [elections, setElections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadElections();
  }, []);

  const loadElections = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("elections")
      .select("*")
      .order("start_date", { ascending: false });

    if (data) {
      setElections(data);
    }
    setLoading(false);
  };

  const toggleElectionStatus = async (electionId: string, currentStatus: boolean) => {
    const { error } = await supabase
      .from("elections")
      .update({ is_active: !currentStatus })
      .eq("id", electionId);

    if (error) {
      toast.error("Failed to update election status");
    } else {
      toast.success(`Election ${!currentStatus ? "activated" : "deactivated"}`);
      loadElections();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Election Management
        </CardTitle>
        <CardDescription>
          Manage elections, candidates, and voting periods
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Contract Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    Loading elections...
                  </TableCell>
                </TableRow>
              ) : elections.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    No elections found
                  </TableCell>
                </TableRow>
              ) : (
                elections.map((election) => (
                  <TableRow key={election.id}>
                    <TableCell className="font-medium">
                      {election.title}
                    </TableCell>
                    <TableCell>
                      {new Date(election.start_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {new Date(election.end_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {election.blockchain_contract_address ? (
                        <span className="truncate block max-w-[200px]">
                          {election.blockchain_contract_address}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not deployed</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {election.is_active ? (
                        <Badge className="bg-green-600">
                          <Play className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <Square className="h-3 w-3 mr-1" />
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleElectionStatus(election.id, election.is_active)}
                      >
                        {election.is_active ? "Deactivate" : "Activate"}
                      </Button>
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