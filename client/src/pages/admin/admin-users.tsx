import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Shield, Plus, Trash2, Check, X, Info, ChevronDown, ChevronUp, MapPin } from "lucide-react";
import type { AdminUser, Market } from "@shared/schema";
import { useAdminAuth } from "@/hooks/use-admin-auth";

function MarketAssignment({ userId }: { userId: number }) {
  const { toast } = useToast();
  const { data: markets } = useQuery<Market[]>({ queryKey: ["/api/markets"] });
  const { data: assignment } = useQuery<{ marketIds: number[] }>({
    queryKey: [`/api/admin/users/${userId}/markets`],
  });

  const mutation = useMutation({
    mutationFn: async (marketIds: number[]) => {
      await apiRequest("PUT", `/api/admin/users/${userId}/markets`, { marketIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/users/${userId}/markets`] });
      toast({ title: "Market assignments updated" });
    },
  });

  if (!markets || !assignment) return null;
  const assigned = new Set(assignment.marketIds);

  return (
    <div className="mt-3 pt-3 border-t">
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="h-3 w-3 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground">Market Assignments (alerts only for these markets)</p>
      </div>
      <div className="flex gap-3 flex-wrap">
        {markets.map((m) => (
          <label key={m.id} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={assigned.has(m.id)}
              onCheckedChange={(checked) => {
                const next = new Set(assigned);
                if (checked) next.add(m.id);
                else next.delete(m.id);
                mutation.mutate(Array.from(next));
              }}
            />
            {m.name}
          </label>
        ))}
      </div>
      {assigned.size === 0 && (
        <p className="text-xs text-muted-foreground mt-1">No markets selected — will receive alerts for all markets</p>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  const { toast } = useToast();
  const { admin } = useAdminAuth();
  const isOwner = admin?.role === "owner";
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("manager");
  const [expandedUser, setExpandedUser] = useState<number | null>(null);

  const { data: users, isLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { email: string; name: string; role: string }) => {
      const res = await apiRequest("POST", "/api/admin/users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setOpen(false);
      setEmail("");
      setName("");
      setRole("manager");
      toast({ title: "Admin user added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Admin user removed" });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-admin-users-title">Admin Users</h1>
          <p className="text-muted-foreground">Allowlisted users who can access the admin portal</p>
        </div>
        {isOwner && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-admin">
              <Plus className="mr-2 h-4 w-4" />
              Add Admin
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Admin User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@hellosugar.salon"
                  data-testid="input-admin-email"
                />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  data-testid="input-admin-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger data-testid="select-admin-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                disabled={!email.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate({ email: email.trim(), name: name.trim(), role })}
                data-testid="button-submit-admin"
              >
                {createMutation.isPending ? "Adding..." : "Add Admin User"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !users?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No admin users configured. Add emails to control access.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                      <Shield className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{u.name || u.email}</p>
                        <Badge variant={u.role === "owner" ? "default" : "secondary"}>
                          {u.role}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground" data-testid={`text-admin-email-${u.id}`}>{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {u.role === "manager" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                      >
                        {expandedUser === u.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    )}
                    {isOwner && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          if (confirm("Remove this admin?")) deleteMutation.mutate(u.id);
                        }}
                        data-testid={`button-delete-admin-${u.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {expandedUser === u.id && u.role === "manager" && (
                  <MarketAssignment userId={u.id} />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 mb-4">
            <Info className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Role Permissions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Permission</th>
                  <th className="text-center py-2 px-3 font-medium">
                    <Badge variant="secondary">Manager</Badge>
                  </th>
                  <th className="text-center py-2 px-3 font-medium">
                    <Badge variant="default">Owner</Badge>
                  </th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {[
                  { perm: "View dashboard & reports", manager: true, owner: true },
                  { perm: "View cash counts & history", manager: true, owner: true },
                  { perm: "View alerts", manager: true, owner: true },
                  { perm: "Resolve alerts", manager: true, owner: true },
                  { perm: "View & record collections", manager: true, owner: true },
                  { perm: "Add locations & containers", manager: true, owner: true },
                  { perm: "Edit locations & containers", manager: true, owner: true },
                  { perm: "Add & edit staff", manager: true, owner: true },
                  { perm: "View Boulevard sync status", manager: true, owner: true },
                  { perm: "Trigger Boulevard sync", manager: true, owner: true },
                  { perm: "Delete locations & containers", manager: false, owner: true },
                  { perm: "Delete staff", manager: false, owner: true },
                  { perm: "Delete markets", manager: false, owner: true },
                  { perm: "Add & remove admin users", manager: false, owner: true },
                  { perm: "Manage alert recipients", manager: false, owner: true },
                  { perm: "Change system settings", manager: false, owner: true },
                ].map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-4">{row.perm}</td>
                    <td className="text-center py-2 px-3">
                      {row.manager ? (
                        <Check className="h-4 w-4 text-green-600 mx-auto" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                      )}
                    </td>
                    <td className="text-center py-2 px-3">
                      {row.owner ? (
                        <Check className="h-4 w-4 text-green-600 mx-auto" />
                      ) : (
                        <X className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
