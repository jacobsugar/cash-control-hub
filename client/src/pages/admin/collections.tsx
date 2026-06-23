import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wallet, Plus, AlertTriangle, CheckCircle2, DollarSign } from "lucide-react";
import type { CashCollection, Location, Container, AdminUser } from "@shared/schema";

interface CollectionWithDetails extends CashCollection {
  containerName: string;
  locationName: string;
  marketName: string;
}

interface LocationWithContainers extends Location {
  marketName: string;
  containers: Container[];
}

export default function CollectionsPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [collectorId, setCollectorId] = useState("");
  const [collectedAmounts, setCollectedAmounts] = useState<Record<number, string>>({});
  const [note, setNote] = useState("");

  const { data: collections, isLoading } = useQuery<CollectionWithDetails[]>({
    queryKey: ["/api/admin/collections"],
  });

  const { data: locations } = useQuery<LocationWithContainers[]>({
    queryKey: ["/api/admin/locations-with-containers"],
  });

  const { data: adminUsers } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const selectedLocationData = locations?.find((l) => String(l.id) === selectedLocation);

  const collectMutation = useMutation({
    mutationFn: async (data: {
      containers: { containerId: number; expectedAmount: string; collectedAmount: string }[];
      collectorName: string;
      note: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/admin/collections", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/container-options"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/locations-with-containers"] });
      setOpen(false);
      setSelectedLocation("");
      setCollectorId("");
      setCollectedAmounts({});
      setNote("");
      toast({ title: "Collection recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!selectedLocationData || !collectorId) return;
    const collector = adminUsers?.find((u) => String(u.id) === collectorId);
    if (!collector) return;

    const containerItems = selectedLocationData.containers
      .filter((c) => {
        const amt = collectedAmounts[c.id];
        return amt && parseFloat(amt) > 0;
      })
      .map((c) => ({
        containerId: c.id,
        expectedAmount: c.currentBalance,
        collectedAmount: collectedAmounts[c.id],
      }));

    if (containerItems.length === 0) {
      toast({ title: "No amounts entered", description: "Enter the collected amount for at least one suite.", variant: "destructive" });
      return;
    }

    collectMutation.mutate({
      containers: containerItems,
      collectorName: collector.name || collector.email,
      note: note || null,
    });
  };

  const totalExpected = selectedLocationData?.containers.reduce(
    (sum, c) => sum + parseFloat(c.currentBalance), 0
  ) || 0;

  const totalCollecting = selectedLocationData?.containers.reduce(
    (sum, c) => sum + (parseFloat(collectedAmounts[c.id] || "0") || 0), 0
  ) || 0;

  const hasAnyAmount = Object.values(collectedAmounts).some((v) => v && parseFloat(v) > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-collections-title">Cash Collections</h1>
          <p className="text-muted-foreground">Record and audit physical cash collections</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-collection">
              <Plus className="mr-2 h-4 w-4" />
              New Collection
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Record Cash Collection</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={selectedLocation} onValueChange={(val) => {
                  setSelectedLocation(val);
                  setCollectedAmounts({});
                }}>
                  <SelectTrigger data-testid="select-collection-location">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations?.filter(l => l.active !== false).map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.marketName} - {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Collector</Label>
                <Select value={collectorId} onValueChange={setCollectorId}>
                  <SelectTrigger data-testid="select-collector">
                    <SelectValue placeholder="Who is collecting?" />
                  </SelectTrigger>
                  <SelectContent>
                    {adminUsers?.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.name || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedLocationData && (
                <div className="space-y-3">
                  {selectedLocationData.containers.map((c) => (
                    <Card key={c.id}>
                      <CardContent className="pt-3 pb-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-sm font-medium">{c.name}</span>
                          <span className="text-sm text-muted-foreground">
                            Expected: <span className="font-mono font-medium text-foreground">${Math.round(parseFloat(c.currentBalance)).toLocaleString()}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs text-muted-foreground shrink-0">Collecting</Label>
                          <div className="relative flex-1">
                            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <Input
                              type="number"
                              step="1"
                              min="0"
                              className="pl-7 h-8"
                              placeholder="0"
                              value={collectedAmounts[c.id] || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val.includes(".")) {
                                  toast({
                                    title: "Whole dollars only",
                                    description: "Round down to the nearest whole dollar.",
                                    variant: "destructive",
                                  });
                                  return;
                                }
                                setCollectedAmounts({ ...collectedAmounts, [c.id]: val });
                              }}
                              data-testid={`input-collected-${c.id}`}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            Left: ${Math.max(0, Math.round(parseFloat(c.currentBalance) - (parseFloat(collectedAmounts[c.id] || "0") || 0))).toLocaleString()}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  <div className="flex items-center justify-between rounded-md bg-muted p-3">
                    <span className="text-sm font-medium">Total Collecting</span>
                    <span className="text-lg font-bold">${totalCollecting.toLocaleString()}</span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Note (optional)</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Any notes about this collection..."
                  data-testid="input-collection-note"
                />
              </div>

              <Button
                className="w-full"
                disabled={
                  !selectedLocation ||
                  !collectorId ||
                  !hasAnyAmount ||
                  collectMutation.isPending
                }
                onClick={handleSubmit}
                data-testid="button-submit-collection"
              >
                {collectMutation.isPending ? "Recording..." : "Record Collection"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !collections?.length ? (
            <div className="text-center py-12">
              <Wallet className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No collections recorded yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Suite</TableHead>
                    <TableHead>Collector</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collections.map((c) => (
                    <TableRow key={c.id} data-testid={`collection-row-${c.id}`}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{c.marketName}</span>
                        <br />{c.locationName}
                      </TableCell>
                      <TableCell>{c.containerName}</TableCell>
                      <TableCell>{c.collectorName}</TableCell>
                      <TableCell className="text-right font-mono">${c.expectedAmount}</TableCell>
                      <TableCell className="text-right font-mono">${c.collectedAmount}</TableCell>
                      <TableCell className="max-w-[150px] truncate text-xs text-muted-foreground">
                        {c.note || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
