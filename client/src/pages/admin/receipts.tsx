import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { Search, Download, Receipt, FileImage, Eye } from "lucide-react";
import type { Receipt as ReceiptType } from "@shared/schema";

interface ReceiptWithDetails extends ReceiptType {
  estheticianName: string;
  containerName: string;
  locationName: string;
  marketName: string;
}

export default function ReceiptsPage() {
  const [search, setSearch] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-receipts-title">Receipts</h1>
          <p className="text-muted-foreground">All uploaded cash spend receipts</p>
        </div>
      </div>

      <Card>
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
                    <TableHead>Container</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>File</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} data-testid={`receipt-row-${r.id}`}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="font-medium">{r.estheticianName}</TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{r.marketName}</span>
                        <br />{r.locationName}
                      </TableCell>
                      <TableCell>{r.containerName}</TableCell>
                      <TableCell className="text-right font-mono">${r.amount}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        {r.note || "-"}
                      </TableCell>
                      <TableCell>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`button-view-receipt-${r.id}`}
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              View
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-lg">
                            <DialogHeader>
                              <DialogTitle>Receipt - {r.fileName}</DialogTitle>
                            </DialogHeader>
                            <div className="mt-2">
                              {r.fileName.match(/\.(jpg|jpeg|png|heic)$/i) ? (
                                <img
                                  src={`/api/receipts/${r.id}/file`}
                                  alt="Receipt"
                                  className="w-full rounded-md"
                                />
                              ) : (
                                <div className="flex items-center justify-center py-8">
                                  <a
                                    href={`/api/receipts/${r.id}/file`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary underline"
                                  >
                                    Download {r.fileName}
                                  </a>
                                </div>
                              )}
                              <div className="mt-3 text-sm space-y-1">
                                <p><span className="text-muted-foreground">Amount:</span> ${r.amount}</p>
                                <p><span className="text-muted-foreground">Staff:</span> {r.estheticianName}</p>
                                {r.note && <p><span className="text-muted-foreground">Note:</span> {r.note}</p>}
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
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
