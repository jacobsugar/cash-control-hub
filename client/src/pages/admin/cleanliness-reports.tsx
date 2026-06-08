import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Flag,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Camera,
  AlertTriangle,
  Users,
} from "lucide-react";

interface CleanlinessReportListItem {
  id: number;
  locationId: number;
  reportedByEstheticianId: number;
  previousEstheticianId: number | null;
  note: string;
  status: "open" | "resolved";
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedByAdminId: number | null;
  escalatedAt: string | null;
  createdAt: string;
  locationName: string;
  marketName: string;
  reporterName: string;
  previousEstheticianName: string | null;
  photoCount: string;
}

interface CleanlinessReportDetail extends Omit<CleanlinessReportListItem, "photoCount"> {
  photos: {
    id: number;
    reportId: number;
    filePath: string;
    fileName: string;
    photoTakenAt: string | null;
    createdAt: string;
  }[];
}

interface InfractionCount {
  estheticianId: number;
  name: string;
  count: number;
}

export default function CleanlinessReportsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "resolved">("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [activeTab, setActiveTab] = useState<"reports" | "infractions">("reports");

  const { data: reports, isLoading } = useQuery<CleanlinessReportListItem[]>({
    queryKey: ["/api/admin/cleanliness-reports"],
  });

  const { data: infractions, isLoading: loadingInfractions } = useQuery<InfractionCount[]>({
    queryKey: ["/api/admin/cleanliness-reports/infractions"],
  });

  const { data: expandedReport, isLoading: loadingDetail } = useQuery<CleanlinessReportDetail>({
    queryKey: [`/api/admin/cleanliness-reports/${expandedId}`],
    enabled: expandedId !== null,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, note }: { id: number; note: string }) => {
      await apiRequest("PATCH", `/api/admin/cleanliness-reports/${id}/resolve`, { resolutionNote: note });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cleanliness-reports"] });
      setExpandedId(null);
      setResolutionNote("");
      toast({ title: "Report resolved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    if (!reports) return [];
    if (statusFilter === "all") return reports;
    return reports.filter((r) => r.status === statusFilter);
  }, [reports, statusFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cleanliness Reports</h1>
        <p className="text-muted-foreground">Issue reports filed by estheticians</p>
      </div>

      <div className="flex gap-2">
        <Button
          variant={activeTab === "reports" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("reports")}
        >
          <Flag className="h-4 w-4 mr-1" />
          Reports
        </Button>
        <Button
          variant={activeTab === "infractions" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("infractions")}
        >
          <Users className="h-4 w-4 mr-1" />
          Infractions
        </Button>
      </div>

      {activeTab === "reports" && (
        <>
          <div className="flex gap-2">
            {(["all", "open", "resolved"] as const).map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
              >
                {s === "all" ? "All" : s === "open" ? "Open" : "Resolved"}
                {s !== "all" && reports && (
                  <span className="ml-1 text-xs">
                    ({reports.filter((r) => r.status === s).length})
                  </span>
                )}
              </Button>
            ))}
          </div>

          <Card>
            <CardContent className="pt-4">
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-primary mb-3" />
                  <p className="text-muted-foreground">No reports found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((report) => {
                    const isExpanded = expandedId === report.id;
                    return (
                      <div key={report.id} className="rounded-md border">
                        <button
                          className="w-full p-4 text-left"
                          onClick={() => {
                            setExpandedId(isExpanded ? null : report.id);
                            setResolutionNote("");
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-md ${
                              report.status === "open" ? "bg-destructive/10" : "bg-muted"
                            }`}>
                              <Flag className={`h-4 w-4 ${report.status === "open" ? "text-destructive" : "text-muted-foreground"}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="font-medium text-sm">
                                  {report.marketName} / {report.locationName}
                                </span>
                                <Badge variant={report.status === "open" ? "destructive" : "secondary"}>
                                  {report.status}
                                </Badge>
                                {report.escalatedAt && (
                                  <Badge variant="outline" className="text-orange-600 border-orange-300">
                                    Escalated
                                  </Badge>
                                )}
                                {parseInt(report.photoCount) > 0 && (
                                  <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                                    <Camera className="h-3 w-3" />
                                    {report.photoCount}
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground space-y-0.5">
                                <p>Reported by: {report.reporterName}</p>
                                {report.previousEstheticianName && (
                                  <p>Previous: {report.previousEstheticianName}</p>
                                )}
                                <p className="truncate">{report.note}</p>
                                <p className="text-xs">{new Date(report.createdAt).toLocaleString()}</p>
                              </div>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground mt-1" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground mt-1" />
                            )}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 border-t pt-4 space-y-4">
                            <div>
                              <p className="text-sm font-medium mb-1">Full Note</p>
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{report.note}</p>
                            </div>

                            {loadingDetail ? (
                              <Skeleton className="h-24 w-full" />
                            ) : expandedReport && expandedReport.photos.length > 0 ? (
                              <div>
                                <p className="text-sm font-medium mb-2">Photos</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {expandedReport.photos.map((photo) => (
                                    <a
                                      key={photo.id}
                                      href={`/api/cleanliness-photos/${photo.filePath.split("/").pop()}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="block"
                                    >
                                      <img
                                        src={`/api/cleanliness-photos/${photo.filePath.split("/").pop()}`}
                                        alt={photo.fileName}
                                        className="rounded-md border w-full aspect-square object-cover"
                                      />
                                    </a>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {report.resolutionNote && (
                              <div className="rounded-md bg-muted p-3">
                                <p className="text-sm font-medium mb-1">Resolution</p>
                                <p className="text-sm text-muted-foreground">{report.resolutionNote}</p>
                                {report.resolvedAt && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Resolved {new Date(report.resolvedAt).toLocaleString()}
                                  </p>
                                )}
                              </div>
                            )}

                            {report.status === "open" && (
                              <div className="space-y-2">
                                <Label>Resolution Note (required)</Label>
                                <Textarea
                                  placeholder="Describe how this was resolved..."
                                  value={resolutionNote}
                                  onChange={(e) => setResolutionNote(e.target.value)}
                                />
                                <Button
                                  size="sm"
                                  disabled={!resolutionNote.trim() || resolveMutation.isPending}
                                  onClick={() => resolveMutation.mutate({ id: report.id, note: resolutionNote })}
                                >
                                  {resolveMutation.isPending ? "Resolving..." : "Resolve Report"}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "infractions" && (
        <Card>
          <CardContent className="pt-4">
            {loadingInfractions ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !infractions || infractions.length === 0 ? (
              <div className="text-center py-12">
                <CheckCircle2 className="mx-auto h-10 w-10 text-primary mb-3" />
                <p className="text-muted-foreground">No infractions recorded</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-3 text-sm font-medium">Esthetician</th>
                      <th className="text-right p-3 text-sm font-medium">Infractions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {infractions.map((inf) => (
                      <tr key={inf.estheticianId} className="border-b last:border-0">
                        <td className="p-3 text-sm">{inf.name}</td>
                        <td className="p-3 text-sm text-right">
                          <Badge variant={inf.count >= 3 ? "destructive" : "secondary"}>
                            {inf.count}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
