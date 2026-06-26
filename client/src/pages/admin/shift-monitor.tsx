import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Send,
  RefreshCw,
  MessageSquare,
} from "lucide-react";

interface ShiftStatus {
  estheticianName: string;
  estheticianId: number;
  phone: string | null;
  locationName: string;
  marketName: string;
  containerName: string;
  // Appointment data
  firstAppointment: string | null;
  lastAppointment: string | null;
  firstClientName: string | null;
  lastClientName: string | null;
  // Count status
  startCount: { time: string; amount: string } | null;
  endCount: { time: string; amount: string } | null;
  // Deadlines
  startDeadline: string | null; // 15 min after first appt
  endReminderDeadline: string | null; // 15 min after last appt
  endAlertDeadline: string | null; // 60 min after last appt
  // Reminder status
  startReminderSent: boolean;
  endReminderSent: boolean;
  endAlertSent: boolean;
}

interface MonitorData {
  locations: {
    locationId: number;
    locationName: string;
    marketName: string;
    type: string;
    staff: ShiftStatus[];
  }[];
  lastCheckedAt: string;
}

export default function ShiftMonitorPage() {
  const { toast } = useToast();

  const { data, isLoading, refetch, isFetching } = useQuery<MonitorData>({
    queryKey: ["/api/admin/shift-monitor"],
    refetchInterval: 30_000,
    staleTime: 0,
  });

  const reminderMutation = useMutation({
    mutationFn: async ({ estheticianId }: { estheticianId: number }) => {
      const res = await apiRequest("POST", "/api/admin/send-reminder", { estheticianId });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Reminder sent", description: data.message });
      refetch();
    },
    onError: (err: Error) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  function formatTime(iso: string | null): string {
    if (!iso) return "-";
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function getTimeStatus(deadline: string | null): "pending" | "due" | "overdue" {
    if (!deadline) return "pending";
    const diff = new Date(deadline).getTime() - Date.now();
    if (diff > 0) return "pending";
    return "overdue";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Shift Monitor</h1>
          <p className="text-muted-foreground">
            Real-time view of shift counts, deadlines, and notifications
            {data?.lastCheckedAt && (
              <span className="ml-2 text-xs">
                · Updated {new Date(data.lastCheckedAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : !data?.locations?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No active locations with appointments today</p>
          </CardContent>
        </Card>
      ) : (
        data.locations.map((loc) => (
          <Card key={loc.locationId}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">{loc.marketName} - {loc.locationName}</h3>
                <Badge variant="outline">{loc.type}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {loc.staff.length === 0 ? (
                <p className="text-sm text-muted-foreground">No appointments today</p>
              ) : (
                <div className="space-y-3">
                  {loc.staff.map((s, i) => {
                    const startStatus = s.startCount ? "done" : getTimeStatus(s.startDeadline);
                    const endStatus = s.endCount ? "done" : getTimeStatus(s.endAlertDeadline);

                    return (
                      <div key={i} className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm">{s.estheticianName}</p>
                            <p className="text-xs text-muted-foreground">
                              {s.containerName} · First: {formatTime(s.firstAppointment)} ({s.firstClientName || "?"})
                              {" · "}Last: {formatTime(s.lastAppointment)} ({s.lastClientName || "?"})
                            </p>
                          </div>
                          {s.phone && !s.endCount && s.lastAppointment && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={reminderMutation.isPending}
                              onClick={() => reminderMutation.mutate({ estheticianId: s.estheticianId })}
                            >
                              <Send className="h-3 w-3 mr-1" />
                              Remind
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {/* Start Count */}
                          <div className={`rounded-md p-2 text-xs ${
                            s.startCount ? "bg-green-50 dark:bg-green-950/30" :
                            startStatus === "overdue" ? "bg-red-50 dark:bg-red-950/30" :
                            "bg-muted/50"
                          }`}>
                            <div className="flex items-center gap-1 mb-1">
                              {s.startCount ? (
                                <CheckCircle2 className="h-3 w-3 text-green-600" />
                              ) : startStatus === "overdue" ? (
                                <AlertTriangle className="h-3 w-3 text-destructive" />
                              ) : (
                                <Clock className="h-3 w-3 text-muted-foreground" />
                              )}
                              <span className="font-medium">
                                {loc.type === "flagship" ? "Open Count" : "Start Count"}
                              </span>
                            </div>
                            {s.startCount ? (
                              <p className="text-green-700 dark:text-green-400">
                                Submitted at {formatTime(s.startCount.time)} · ${s.startCount.amount}
                              </p>
                            ) : s.startDeadline ? (
                              <div>
                                <p>Due by {formatTime(s.startDeadline)}</p>
                                {s.startReminderSent && (
                                  <p className="flex items-center gap-1 mt-0.5 text-orange-600">
                                    <MessageSquare className="h-2.5 w-2.5" /> Reminder sent
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-muted-foreground">Waiting for appointment</p>
                            )}
                          </div>

                          {/* End Count */}
                          <div className={`rounded-md p-2 text-xs ${
                            s.endCount ? "bg-green-50 dark:bg-green-950/30" :
                            endStatus === "overdue" ? "bg-red-50 dark:bg-red-950/30" :
                            "bg-muted/50"
                          }`}>
                            <div className="flex items-center gap-1 mb-1">
                              {s.endCount ? (
                                <CheckCircle2 className="h-3 w-3 text-green-600" />
                              ) : endStatus === "overdue" ? (
                                <XCircle className="h-3 w-3 text-destructive" />
                              ) : (
                                <Clock className="h-3 w-3 text-muted-foreground" />
                              )}
                              <span className="font-medium">
                                {loc.type === "flagship" ? "Close Count" : "End Count"}
                              </span>
                            </div>
                            {s.endCount ? (
                              <p className="text-green-700 dark:text-green-400">
                                Submitted at {formatTime(s.endCount.time)} · ${s.endCount.amount}
                              </p>
                            ) : s.endAlertDeadline ? (
                              <div>
                                <p>Reminder at {formatTime(s.endReminderDeadline)}</p>
                                <p>Alert at {formatTime(s.endAlertDeadline)}</p>
                                {s.endReminderSent && (
                                  <p className="flex items-center gap-1 mt-0.5 text-orange-600">
                                    <MessageSquare className="h-2.5 w-2.5" /> 15-min reminder sent
                                  </p>
                                )}
                                {s.endAlertSent && (
                                  <p className="flex items-center gap-1 text-destructive">
                                    <MessageSquare className="h-2.5 w-2.5" /> 60-min alert sent to managers
                                  </p>
                                )}
                              </div>
                            ) : (
                              <p className="text-muted-foreground">After last appointment</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
