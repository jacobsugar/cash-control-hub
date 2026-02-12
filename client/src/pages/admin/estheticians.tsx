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
import { Users, Plus, Trash2 } from "lucide-react";
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-estheticians-title">Estheticians</h1>
          <p className="text-muted-foreground">Manage staff dropdown list</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-esthetician">
              <Plus className="mr-2 h-4 w-4" />
              Add Esthetician
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Esthetician</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  data-testid="input-esthetician-name"
                />
              </div>
              <Button
                className="w-full"
                disabled={!name.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate({ name: name.trim() })}
                data-testid="button-submit-esthetician"
              >
                {createMutation.isPending ? "Adding..." : "Add Esthetician"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
            <p className="text-muted-foreground">No estheticians yet. Add staff names so they can submit cash counts.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {estheticians.map((e) => (
            <Card key={e.id}>
              <CardContent className="py-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium" data-testid={`text-esthetician-${e.id}`}>{e.name}</p>
                    {!e.active && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={e.active}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: e.id, active: checked })}
                    data-testid={`switch-esthetician-${e.id}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Delete this esthetician?")) {
                        deleteMutation.mutate(e.id);
                      }
                    }}
                    data-testid={`button-delete-esthetician-${e.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
