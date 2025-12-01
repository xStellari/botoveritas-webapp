import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, Play, Square, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

export default function EnhancedElectionManagement() {
  const [elections, setElections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingElection, setEditingElection] = useState<any>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    start_date: "",
    end_date: "",
    is_active: false
  });

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

  const handleOpenDialog = (election?: any) => {
    if (election) {
      setEditingElection(election);
      setFormData({
        title: election.title,
        description: election.description || "",
        start_date: election.start_date.split('T')[0],
        end_date: election.end_date.split('T')[0],
        is_active: election.is_active
      });
    } else {
      setEditingElection(null);
      setFormData({
        title: "",
        description: "",
        start_date: "",
        end_date: "",
        is_active: false
      });
    }
    setDialogOpen(true);
  };

  const handleSaveElection = async () => {
    if (!formData.title || !formData.start_date || !formData.end_date) {
      toast.error("Please fill in all required fields");
      return;
    }

    const electionData = {
      title: formData.title,
      description: formData.description,
      start_date: new Date(formData.start_date).toISOString(),
      end_date: new Date(formData.end_date).toISOString(),
      is_active: formData.is_active
    };

    let error;
    if (editingElection) {
      const result = await supabase
        .from("elections")
        .update(electionData)
        .eq("id", editingElection.id);
      error = result.error;
    } else {
      const result = await supabase
        .from("elections")
        .insert([electionData]);
      error = result.error;
    }

    if (error) {
      toast.error(`Failed to ${editingElection ? "update" : "create"} election`);
    } else {
      toast.success(`Election ${editingElection ? "updated" : "created"} successfully`);
      setDialogOpen(false);
      loadElections();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Election Management
            </CardTitle>
            <CardDescription>
              Manage elections, candidates, and voting periods
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()} className="bg-primary hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-2" />
                Create Election
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingElection ? "Edit Election" : "Create New Election"}
                </DialogTitle>
                <DialogDescription>
                  {editingElection 
                    ? "Update the election details below" 
                    : "Fill in the details to create a new election"}
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Election Title *</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g., SCC Elections 2025"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief description of the election"
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="start_date">Start Date *</Label>
                    <Input
                      id="start_date"
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="end_date">End Date *</Label>
                    <Input
                      id="end_date"
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="is_active" className="cursor-pointer">
                    Set as active election
                  </Label>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSaveElection} className="bg-primary hover:bg-primary/90">
                  {editingElection ? "Update Election" : "Create Election"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    Loading elections...
                  </TableCell>
                </TableRow>
              ) : elections.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No elections found. Create your first election above.
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
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenDialog(election)}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleElectionStatus(election.id, election.is_active)}
                        >
                          {election.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
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