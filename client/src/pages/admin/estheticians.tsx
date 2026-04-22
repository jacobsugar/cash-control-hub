import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Users, Plus, Trash2, RefreshCw, Link2 } from "lucide-react";
import type { Esthetician } from "@shared/schema";

export default function EstheticiansPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const { data: estheticians, isLoading } = useQuery<Esthetician[]>({
    queryKey: ["/api/estheticians"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string }) => {
      const res = await apiRequest("POST", "/api/estheticians", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estheticians"] });
      setOpen(false);
      setName("");
      toast({ title: "Esthetician added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      await apiRequest("PATCH", `/api/estheticians/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estheticians"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/estheticians/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estheticians"] });
      toast({ title: "Esthetician removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const syncStaffMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/boulevard/sync-staff");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/estheticians"] });
      toast({ title: "Staff synced from Boulevard", description: `${data.synced} staff members across ${data.locations} locations` });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const boulevardSynced = estheticians?.filter((e: any) => e.boulevardStaffId) || [];
  const manuallyAdded = estheticians?.filter((e: any) => !e.boulevardStaffId) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Estheticians</h1>
          <p className="text-muted-foreground">
            Staff synced from Boulevard
            {boulevardSynced.length > 0 && ` · ${boulevardSynced.length} synced`}
            {manuallyAdded.length > 0 && ` · ${manuallyAdded.length} manual`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => syncStaffMutation.mutate()}
            disabled={syncStaffMutation.isPending}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${syncStaffMutation.isPending ? "animate-spin" : ""}`} />
            {syncStaffMutation.isPending ? "Syncing..." : "Sync from Boulevard"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="secondary">
                <Plus className="mr-2 h-4 w-4" />
                Add Manually
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Esthetician Manually</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Full name"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!name.trim() || createMutation.isPending}
                  onClick={() => createMutation.mutate({ name: name.trim() })}
                >
                  {createMutation.isPending ? "Adding..." : "Add Esthetician"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !estheticians?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No estheticians yet. Click "Sync from Boulevard" to pull staff automatically.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {estheticians.map((e: any) => (
            <Card key={e.id}>
              <CardContent className="py-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{e.name}</p>
                      {!e.active && <Badge variant="secondary">Inactive</Badge>}
                      {e.boulevardStaffId && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Link2 className="h-2.5 w-2.5" />
                          Boulevard
                        </Badge>
                      )}
                    </div>
                    {e.lastSyncedAt && (
                      <p className="text-xs text-muted-foreground">
                        Last synced: {new Date(e.lastSyncedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={e.active}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: e.id, active: checked })}
                  />
                  {!e.boulevardStaffId && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Delete this esthetician?")) {
                          deleteMutation.mutate(e.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
