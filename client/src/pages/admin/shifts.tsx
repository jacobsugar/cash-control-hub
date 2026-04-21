import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState, useMemo } from "react";
import { Calculator, Search, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ShiftCountWithDetails } from "@/lib/types";
import type { Market } from "@shared/schema";

export default function ShiftsPage() {
  const [search, setSearch] = useState("");
  const [marketFilter, setMarketFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const { data: shifts, isLoading } = useQuery<ShiftCountWithDetails[]>({
    queryKey: ["/api/admin/shift-counts"],
  });

  const { data: markets } = useQuery<Market[]>({
    queryKey: ["/api/markets"],
  });

  const filtered = useMemo(() => shifts?.filter((s) => {
    if (search && !s.estheticianName.toLowerCase().includes(search.toLowerCase()) &&
        !s.locationName.toLowerCase().includes(search.toLowerCase()) &&
        !s.containerName.toLowerCase().includes(search.toLowerCase())) return false;
    if (marketFilter !== "all" && s.marketName !== marketFilter) return false;
    if (typeFilter !== "all" && s.type !== typeFilter) return false;
    return true;
  }) || [], [shifts, search, marketFilter, typeFilter]);

  const handleExport = () => {
    const csvContent = [
      ["Date", "Staff", "Market", "Location", "Suite", "Type", "Counted", "Expected", "Variance", "Note"].join(","),
      ...filtered.map((s) => [
        new Date(s.createdAt).toLocaleString(),
        s.estheticianName,
        s.marketName,
        s.locationName,
        s.containerName,
        s.type,
        s.countedAmount,
        s.expectedAmount || "",
        s.expectedAmount ? (parseFloat(s.countedAmount) - parseFloat(s.expectedAmount)).toFixed(2) : "",
        `"${(s.discrepancyNote || "").replace(/"/g, '""')}"`,
      ].join(","))
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shift-counts-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-shifts-title">Shift Counts</h1>
          <p className="text-muted-foreground">All cash count submissions</p>
        </div>
        <Button variant="outline" onClick={handleExport} data-testid="button-export-shifts">
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, location..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-shift-search"
              />
            </div>
            <Select value={marketFilter} onValueChange={setMarketFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-market-filter">
                <SelectValue placeholder="All Markets" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Markets</SelectItem>
                {markets?.map((m) => (
                  <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[140px]" data-testid="select-type-filter">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="start">Start</SelectItem>
                <SelectItem value="end">End</SelectItem>
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
              <Calculator className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No shift counts found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Suite</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => {
                    const hasVariance = s.expectedAmount && parseFloat(s.countedAmount) !== parseFloat(s.expectedAmount);
                    return (
                      <TableRow key={s.id} data-testid={`shift-row-${s.id}`}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {new Date(s.createdAt).toLocaleDateString()}
                          <span className="text-xs text-muted-foreground ml-1">
                            {new Date(s.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium">{s.estheticianName}</TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{s.marketName}</span>
                          <br />{s.locationName}
                        </TableCell>
                        <TableCell>{s.containerName}</TableCell>
                        <TableCell>
                          <Badge variant={s.type === "start" ? "default" : "secondary"}>
                            {s.type === "start" ? "Start" : "End"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">${s.countedAmount}</TableCell>
                        <TableCell className="text-right font-mono">{s.expectedAmount ? `$${s.expectedAmount}` : "-"}</TableCell>
                        <TableCell>
                          {hasVariance ? (
                            <div className="flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 text-destructive" />
                              <span className="text-xs text-destructive">Variance</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-primary" />
                              <span className="text-xs text-primary">Match</span>
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
