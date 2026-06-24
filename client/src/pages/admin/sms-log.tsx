import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, CheckCircle2, XCircle } from "lucide-react";

interface SmsLogEntry {
  recipientName: string;
  recipientPhone: string;
  message: string;
  type: "alert" | "reminder";
  success: boolean;
  error?: string;
  sentAt: string;
}

export default function SmsLogPage() {
  const { data: log, isLoading } = useQuery<SmsLogEntry[]>({
    queryKey: ["/api/admin/sms-log"],
    staleTime: 0,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">SMS Log</h1>
        <p className="text-muted-foreground">Text messages sent by the system</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !log?.length ? (
            <div className="text-center py-12">
              <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No text messages sent yet</p>
              <p className="text-xs text-muted-foreground mt-1">SMS log resets when the server restarts</p>
            </div>
          ) : (
            <div className="space-y-2">
              {log.map((entry, i) => (
                <div key={i} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-medium">{entry.recipientName}</span>
                        <span className="text-xs text-muted-foreground">{entry.recipientPhone}</span>
                        <Badge variant={entry.type === "alert" ? "default" : "secondary"}>
                          {entry.type}
                        </Badge>
                        {entry.success ? (
                          <CheckCircle2 className="h-3 w-3 text-green-600" />
                        ) : (
                          <XCircle className="h-3 w-3 text-destructive" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{entry.message}</p>
                      {entry.error && (
                        <p className="text-xs text-destructive mt-1">{entry.error}</p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.sentAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
