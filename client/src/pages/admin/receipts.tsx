import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useState } from "react";
import { Search, Receipt, Eye, X, Download, ChevronLeft, ChevronRight } from "lucide-react";
import type { Receipt as ReceiptType } from "@shared/schema";

interface ReceiptWithDetails extends ReceiptType {
  estheticianName: string;
  containerName: string;
  locationName: string;
  marketName: string;
}

export default function ReceiptsPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: receipts, isLoading } = useQuery<ReceiptWithDetails[]>({
    queryKey: ["/api/admin/receipts"],
  });

  const filtered = receipts?.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.estheticianName.toLowerCase().includes(q) ||
      r.containerName.toLowerCase().includes(q) ||
      r.locationName.toLowerCase().includes(q) ||
      (r.note || "").toLowerCase().includes(q);
  }) || [];

  const selectedReceipt = filtered.find((r) => r.id === selectedId) || null;
  const selectedIndex = selectedReceipt ? filtered.indexOf(selectedReceipt) : -1;

  const goToNext = () => {
    if (selectedIndex < filtered.length - 1) {
      setSelectedId(filtered[selectedIndex + 1].id);
    }
  };

  const goToPrev = () => {
    if (selectedIndex > 0) {
      setSelectedId(filtered[selectedIndex - 1].id);
    }
  };

  const isImage = (fileName: string) => /\.(jpg|jpeg|png|heic|webp)$/i.test(fileName);
  const isPdf = (fileName: string) => /\.pdf$/i.test(fileName);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-receipts-title">Receipts</h1>
          <p className="text-muted-foreground">All uploaded cash spend receipts</p>
        </div>
      </div>

      <div className={`flex gap-4 ${selectedReceipt ? "flex-col lg:flex-row" : ""}`}>
        <Card className={selectedReceipt ? "lg:flex-1 min-w-0" : "w-full"}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search receipts..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-receipt-search"
                />
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12">
                <Receipt className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No receipts found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>File</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow
                        key={r.id}
                        data-testid={`receipt-row-${r.id}`}
                        className={`cursor-pointer ${selectedId === r.id ? "bg-accent" : ""}`}
                        onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                      >
                        <TableCell className="whitespace-nowrap text-sm">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-medium">{r.estheticianName}</TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{r.marketName}</span>
                          <br />{r.locationName}
                        </TableCell>
                        <TableCell className="text-right font-mono">${r.amount}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                          {r.note || "-"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={selectedId === r.id ? "default" : "outline"}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(selectedId === r.id ? null : r.id);
                            }}
                            data-testid={`button-view-receipt-${r.id}`}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {selectedReceipt && (
          <Card className="lg:w-[420px] lg:shrink-0" data-testid="receipt-preview-panel">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={goToPrev}
                    disabled={selectedIndex <= 0}
                    data-testid="button-receipt-prev"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {selectedIndex + 1} of {filtered.length}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={goToNext}
                    disabled={selectedIndex >= filtered.length - 1}
                    data-testid="button-receipt-next"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => window.open(`/api/receipts/${selectedReceipt.id}/file`, "_blank")}
                    data-testid="button-receipt-download"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setSelectedId(null)}
                    data-testid="button-receipt-close"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="rounded-md border overflow-hidden bg-muted/30 mb-3">
                {isImage(selectedReceipt.fileName) ? (
                  <img
                    src={`/api/receipts/${selectedReceipt.id}/file`}
                    alt="Receipt"
                    className="w-full object-contain max-h-[500px]"
                    data-testid="img-receipt-preview"
                  />
                ) : isPdf(selectedReceipt.fileName) ? (
                  <iframe
                    src={`/api/receipts/${selectedReceipt.id}/file`}
                    className="w-full h-[500px]"
                    title="Receipt PDF"
                    data-testid="iframe-receipt-preview"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Receipt className="h-10 w-10 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground mb-2">{selectedReceipt.fileName}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/api/receipts/${selectedReceipt.id}/file`, "_blank")}
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download File
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="font-mono font-medium">${selectedReceipt.amount}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Staff</span>
                  <span className="font-medium">{selectedReceipt.estheticianName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Location</span>
                  <span>{selectedReceipt.locationName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Container</span>
                  <span>{selectedReceipt.containerName}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Date</span>
                  <span>{new Date(selectedReceipt.createdAt).toLocaleString()}</span>
                </div>
                {selectedReceipt.note && (
                  <div>
                    <span className="text-muted-foreground">Note</span>
                    <p className="mt-0.5">{selectedReceipt.note}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
