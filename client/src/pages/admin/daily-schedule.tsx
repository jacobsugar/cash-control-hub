import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar, Clock, User } from "lucide-react";

interface StaffSchedule {
  estheticianName: string;
  firstAppointment: { time: string; clientName: string } | null;
  lastAppointment: { time: string; clientName: string } | null;
}

interface LocationSchedule {
  locationId: number;
  locationName: string;
  marketName: string;
  staff: StaffSchedule[];
}

export default function DailySchedulePage() {
  const { data: schedules, isLoading } = useQuery<LocationSchedule[]>({
    queryKey: ["/api/admin/daily-appointments"],
    refetchInterval: 5 * 60_000,
    staleTime: 0,
  });

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Daily Schedule</h1>
        <p className="text-muted-foreground">First and last appointments for today by location</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : !schedules?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No appointments found for today</p>
          </CardContent>
        </Card>
      ) : (
        schedules.map((loc) => (
          <Card key={loc.locationId}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">{loc.marketName} - {loc.locationName}</h3>
              </div>
            </CardHeader>
            <CardContent>
              {loc.staff.length === 0 ? (
                <p className="text-sm text-muted-foreground">No appointments today</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Esthetician</TableHead>
                        <TableHead>First Client</TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Last Client</TableHead>
                        <TableHead>Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loc.staff.map((s, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{s.estheticianName}</TableCell>
                          <TableCell>{s.firstAppointment?.clientName || "-"}</TableCell>
                          <TableCell>
                            {s.firstAppointment ? (
                              <Badge variant="outline">{formatTime(s.firstAppointment.time)}</Badge>
                            ) : "-"}
                          </TableCell>
                          <TableCell>{s.lastAppointment?.clientName || "-"}</TableCell>
                          <TableCell>
                            {s.lastAppointment ? (
                              <Badge variant="outline">{formatTime(s.lastAppointment.time)}</Badge>
                            ) : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
