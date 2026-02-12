import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import type { CashCollection, Container, Location, Market } from "@shared/schema";

interface CollectionWithDetails extends CashCollection {
  containerName: string;
  locationName: string;
  marketName: string;
}

interface ContainerOption {
  id: number;
  name: string;
  locationName: string;
  marketName: string;
  currentBalance: string;
}

export default function CollectionsPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState("");
  const [collectedAmount, setCollectedAmount] = useState("");
  const [collectorName, setCollectorName] = useState("");
  const [note, setNote] = useState("");

  const { data: collections, isLoading } = useQuery<CollectionWithDetails[]>({
    queryKey: ["/api/admin/collections"],
  });

  const { data: containerOptions } = useQuery<ContainerOption[]>({
    queryKey: ["/api/admin/container-options"],
  });

  const selectedContainerData = containerOptions?.find((c) => String(c.id) === selectedContainer);

  const collectMutation = useMutation({
    mutationFn: async (data: {
      containerId: number;
      expectedAmount: string;
      collectedAmount: string;
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
      setSelectedContainer("");
      setCollectedAmount("");
      setCollectorName("");
      setNote("");
      toast({ title: "Collection recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const hasMismatch = selectedContainerData &&
    collectedAmount &&
    parseFloat(collectedAmount) !== parseFloat(selectedContainerData.currentBalance);

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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Cash Collection</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label>Container</Label>
                <Select value={selectedContainer} onValueChange={setSelectedContainer}>
                  <SelectTrigger data-testid="select-collection-container">
                    <SelectValue placeholder="Select container" />
                  </SelectTrigger>
                  <SelectContent>
                    {containerOptions?.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.marketName} - {c.locationName} - {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedContainerData && (
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <p className="text-xs text-muted-foreground">Expected Cash in Container</p>
                    <p className="text-2xl font-bold text-primary" data-testid="text-expected-collection">
                      ${parseFloat(selectedContainerData.currentBalance).toFixed(2)}
                    </p>
                  </CardContent>
                </Card>
              )}

              <div className="space-y-2">
                <Label>Collector Name</Label>
                <Input
                  value={collectorName}
                  onChange={(e) => setCollectorName(e.target.value)}
                  placeholder="Who is collecting?"
                  data-testid="input-collector-name"
                />
              </div>

              <div className="space-y-2">
                <Label>Amount Collected</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="pl-9"
                    placeholder="0.00"
                    value={collectedAmount}
                    onChange={(e) => setCollectedAmount(e.target.value)}
                    data-testid="input-collected-amount"
                  />
                </div>
              </div>

              {hasMismatch && (
                <div className="rounded-md bg-destructive/10 p-3 border border-destructive/20">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <p className="text-sm text-destructive font-medium">Discrepancy detected</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Expected ${selectedContainerData?.currentBalance} but collecting ${collectedAmount}
                  </p>
                </div>
              )}

              {hasMismatch && (
                <div className="space-y-2">
                  <Label>Note (required for mismatch)</Label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Explain the discrepancy..."
                    data-testid="input-collection-note"
                  />
                </div>
              )}

              <Button
                className="w-full"
                disabled={
                  !selectedContainer ||
                  !collectedAmount ||
                  !collectorName ||
                  (hasMismatch && !note.trim()) ||
                  collectMutation.isPending
                }
                onClick={() => {
                  collectMutation.mutate({
                    containerId: parseInt(selectedContainer),
                    expectedAmount: selectedContainerData?.currentBalance || "0",
                    collectedAmount,
                    collectorName,
                    note: note || null,
                  });
                }}
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
                    <TableHead>Container</TableHead>
                    <TableHead>Collector</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collections.map((c) => {
                    const match = parseFloat(c.expectedAmount) === parseFloat(c.collectedAmount);
                    return (
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
                        <TableCell>
                          {match ? (
                            <div className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-primary" />
                              <span className="text-xs">Match</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 text-destructive" />
                              <span className="text-xs text-destructive">Variance</span>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
