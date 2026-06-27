import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Clock, Send, CheckCircle2, AlertTriangle } from "lucide-react";

interface OpenCount {
  estheticianId: number;
  estheticianName: string;
  phone: string | null;
  locationName: string;
  timezone: string;
  marketName: string;
  containerName: string;
  startCountTime: string;
}

export default function ActiveShiftsPage() {
  const { toast } = useToast();

  const { data: openCounts, isLoading } = useQuery<OpenCount[]>({
    queryKey: ["/api/admin/open-counts"],
    refetchInterval: 60_000,
    staleTime: 0,
  });

  const reminderMutation = useMutation({
    mutationFn: async ({ estheticianId }: { estheticianId: number }) => {
      const res = await apiRequest("POST", "/api/admin/send-reminder", {
        estheticianId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reminder sent" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  function timeElapsed(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Active Shifts</h1>
        <p className="text-muted-foreground">Estheticians with an open count (started but not closed)</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !openCounts?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary mb-3" />
            <p className="text-muted-foreground">No open shifts right now</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {openCounts.map((oc) => {
            const elapsed = timeElapsed(oc.startCountTime);
            const hours = (Date.now() - new Date(oc.startCountTime).getTime()) / 3600000;
            return (
              <Card key={`${oc.estheticianId}-${oc.startCountTime}`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-md ${
                        hours > 10 ? "bg-destructive/10" : "bg-primary/10"
                      }`}>
                        <Clock className={`h-4 w-4 ${hours > 10 ? "text-destructive" : "text-primary"}`} />
                      </div>
                      <div>
                        <p className="font-medium">{oc.estheticianName}</p>
                        <p className="text-xs text-muted-foreground">
                          {oc.marketName} - {oc.locationName} - {oc.containerName}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm font-mono">{elapsed} ago</p>
                        <p className="text-xs text-muted-foreground">
                          Started {new Date(oc.startCountTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: oc.timezone || "America/Los_Angeles" })}
                        </p>
                      </div>
                      {oc.phone && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reminderMutation.isPending}
                          onClick={() => reminderMutation.mutate({
                            estheticianId: oc.estheticianId,
                          })}
                        >
                          <Send className="h-3 w-3 mr-1" />
                          Remind
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
