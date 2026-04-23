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
import { Phone, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { AlertRecipient } from "@shared/schema";

const ALERT_TYPES = [
  { key: "notifyStartMismatch", label: "Start Mismatch" },
  { key: "notifyEndMismatch", label: "End Mismatch" },
  { key: "notifyMissingEndShift", label: "Missing End Shift" },
  { key: "notifyMissingReceipt", label: "Missing Receipt" },
  { key: "notifyReceiptSubmitted", label: "Receipt Submitted" },
  { key: "notifyCollectionMismatch", label: "Collection Mismatch" },
] as const;

export default function RecipientsPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: recipients, isLoading } = useQuery<AlertRecipient[]>({
    queryKey: ["/api/admin/alert-recipients"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; name: string }) => {
      const res = await apiRequest("POST", "/api/admin/alert-recipients", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/alert-recipients"] });
      setOpen(false);
      setPhone("");
      setName("");
      toast({ title: "Recipient added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      await apiRequest("PATCH", `/api/admin/alert-recipients/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/alert-recipients"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/alert-recipients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/alert-recipients"] });
      toast({ title: "Recipient removed" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Alert Recipients</h1>
          <p className="text-muted-foreground">Manage who receives SMS alerts and which types they get</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Recipient
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Alert Recipient</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Recipient name"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1234567890"
                />
              </div>
              <Button
                className="w-full"
                disabled={!phone.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate({ phoneNumber: phone.trim(), name: name.trim() })}
              >
                {createMutation.isPending ? "Adding..." : "Add Recipient"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !recipients?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Phone className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No alert recipients. Add phone numbers to receive SMS alerts.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {recipients.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                      <Phone className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{r.name || "Unnamed"}</p>
                      <p className="text-sm text-muted-foreground font-mono">{r.phoneNumber}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!r.active && <Badge variant="secondary">Inactive</Badge>}
                    <Switch
                      checked={r.active}
                      onCheckedChange={(checked) => updateMutation.mutate({ id: r.id, data: { active: checked } })}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    >
                      {expandedId === r.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => { if (confirm("Remove this recipient?")) deleteMutation.mutate(r.id); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {expandedId === r.id && (
                  <div className="mt-3 ml-12 space-y-2 border-t pt-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Alert Types</p>
                    {ALERT_TYPES.map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between py-1">
                        <Label className="text-sm font-normal">{label}</Label>
                        <Switch
                          checked={r[key] !== false}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({ id: r.id, data: { [key]: checked } })
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
