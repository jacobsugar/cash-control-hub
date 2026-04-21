import { useState, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Upload, Search, Database } from "lucide-react";
import type { BoulevardTransaction, Location } from "@shared/schema";

interface TransactionWithDetails extends BoulevardTransaction {
  locationName: string;
  marketName: string;
}

export default function BoulevardPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [selectedLocationId, setSelectedLocationId] = useState("auto");
  const [uploading, setUploading] = useState(false);

  const { data: transactions, isLoading } = useQuery<TransactionWithDetails[]>({
    queryKey: ["/api/admin/boulevard-transactions"],
  });

  const { data: locations } = useQuery<(Location & { marketName: string })[]>({
    queryKey: ["/api/locations/with-market"],
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (selectedLocationId !== "auto") {
        formData.append("locationId", selectedLocationId);
      }
      const res = await fetch("/api/admin/boulevard/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Import failed");
      }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      let desc = `${result.imported} cash transactions imported from ${result.total} total rows.`;
      if (result.skippedNonCash > 0) desc += ` ${result.skippedNonCash} non-cash rows skipped.`;
      if (result.skippedNoLocation > 0) desc += ` ${result.skippedNoLocation} rows skipped (no matching location).`;
      toast({ title: "Import complete", description: desc });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const filtered = useMemo(() => transactions?.filter((t) => {
    if (search) {
      const q = search.toLowerCase();
      if (!(t.operatorName || "").toLowerCase().includes(q) &&
          !(t.clientName || "").toLowerCase().includes(q) &&
          !(t.orderId || "").toLowerCase().includes(q) &&
          !(t.locationName || "").toLowerCase().includes(q) &&
          !(t.marketName || "").toLowerCase().includes(q)) return false;
    }
    if (locationFilter !== "all" && String(t.locationId) !== locationFilter) return false;
    return true;
  }) || [], [transactions, search, locationFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-boulevard-title">Boulevard Data</h1>
          <p className="text-muted-foreground">Import and view cash transactions from Boulevard</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
            <SelectTrigger className="w-[220px]" data-testid="select-import-location">
              <SelectValue placeholder="Auto-detect location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto-detect location</SelectItem>
              {locations?.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.marketName} - {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            data-testid="button-import-csv"
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Importing..." : "Import CSV"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="rounded-md bg-muted p-3 mb-4">
            <p className="text-sm">
              <span className="font-medium">CSV Format:</span> Columns: Date, Merchant, Order #, Client, Operator, Method, Amount.
              Only rows with "cash" as the Method will be imported. The Merchant column is matched to your location names,
              or you can select a specific location before uploading.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search transactions..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-boulevard-search"
              />
            </div>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-[220px]" data-testid="select-boulevard-location">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations?.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.marketName} - {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <Database className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No Boulevard transactions yet. Import a CSV to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Order #</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow key={t.id} data-testid={`boulevard-row-${t.id}`}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(t.date).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{t.marketName}</span>
                        <br />{t.locationName}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{t.orderId || "-"}</TableCell>
                      <TableCell>{t.operatorName || "-"}</TableCell>
                      <TableCell>{t.clientName || "-"}</TableCell>
                      <TableCell className="text-right font-mono">${t.amount}</TableCell>
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
