import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Upload, Search, BookOpen, Trash2 } from "lucide-react";
import type { BoulevardCatalogItem } from "@shared/schema";

export default function CatalogPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [uploading, setUploading] = useState(false);

  const { data: catalog, isLoading } = useQuery<BoulevardCatalogItem[]>({
    queryKey: ["/api/admin/boulevard-catalog"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/boulevard-catalog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard-catalog"] });
      toast({ title: "Item deleted" });
    },
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/boulevard-catalog/import", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Import failed");
      }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/boulevard-catalog"] });
      let desc = `${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged`;
      if (result.skipped > 0) desc += `, ${result.skipped} skipped (no name)`;
      desc += ` out of ${result.total} rows.`;
      if (result.columns?.length) desc += ` Columns detected: ${result.columns.join(", ")}.`;
      toast({ title: "Catalog import complete", description: desc });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const categories = [...new Set(catalog?.map((c) => c.category).filter(Boolean) || [])].sort();

  const filtered = catalog?.filter((item) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !item.name.toLowerCase().includes(q) &&
        !(item.category || "").toLowerCase().includes(q) &&
        !(item.sku || "").toLowerCase().includes(q) &&
        !(item.description || "").toLowerCase().includes(q) &&
        !(item.itemType || "").toLowerCase().includes(q)
      ) return false;
    }
    if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
    return true;
  }) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-catalog-title">Boulevard Catalog</h1>
          <p className="text-muted-foreground">Import and manage your services, products, and packages from Boulevard</p>
        </div>
        <div className="flex items-center gap-2">
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
            data-testid="button-import-catalog"
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploading ? "Importing..." : "Import Catalog CSV"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="rounded-md bg-muted p-3 mb-4">
            <p className="text-sm">
              <span className="font-medium">CSV Format:</span> Supported columns: Product / Service / Package (or Name), Price, Category, Duration, Description, SKU, Type.
              Items are matched by name — if an item already exists, all fields that differ will be updated.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search catalog..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-catalog-search"
              />
            </div>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              data-testid="select-catalog-category"
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat!}>{cat}</option>
              ))}
            </select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No catalog items yet. Import a CSV to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="text-sm text-muted-foreground mb-2">
                {filtered.length} item{filtered.length !== 1 ? "s" : ""}
                {categoryFilter !== "all" ? ` in ${categoryFilter}` : ""}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => (
                    <TableRow key={item.id} data-testid={`catalog-row-${item.id}`}>
                      <TableCell className="font-medium max-w-[250px]">
                        <span className="line-clamp-2">{item.name}</span>
                        {item.description && (
                          <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">{item.description}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {item.category ? (
                          <Badge variant="secondary">{item.category}</Badge>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-sm">{item.itemType || "-"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {item.price ? `$${parseFloat(item.price).toFixed(2)}` : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.duration ? `${item.duration} min` : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{item.sku || "-"}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(item.updatedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            if (confirm(`Delete "${item.name}"?`)) {
                              deleteMutation.mutate(item.id);
                            }
                          }}
                          data-testid={`button-delete-catalog-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
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
    </div>
  );
}
