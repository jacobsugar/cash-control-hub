import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Clock, Save, Info } from "lucide-react";
import type { AppSetting, Location } from "@shared/schema";

interface TimingSetting {
  key: string;
  label: string;
  description: string;
  unit: string;
  default: number;
}

const TIMING_SETTINGS: TimingSetting[] = [
  {
    key: "alert_start_reminder_delay_min",
    label: "Start Count Reminder",
    description: "Minutes after first appointment to send start-of-shift reminder to the esthetician.",
    unit: "minutes",
    default: 15,
  },
  {
    key: "alert_end_reminder_delay_min",
    label: "End Count Soft Reminder",
    description: "Minutes after last appointment to send a soft end-of-shift reminder to the esthetician (no manager notification).",
    unit: "minutes",
    default: 15,
  },
  {
    key: "alert_end_escalation_delay_min",
    label: "End Count Escalation",
    description: "Minutes after last appointment to escalate — sends a second text to the esthetician and notifies the manager.",
    unit: "minutes",
    default: 60,
  },
  {
    key: "alert_end_count_window_min",
    label: "End Count Submission Window",
    description: "Minutes after last appointment before the end-of-shift count submission is blocked. After this, the esthetician must contact a manager.",
    unit: "minutes",
    default: 60,
  },
];

export default function AlertTimingPage() {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});

  const { data: settings, isLoading } = useQuery<AppSetting[]>({
    queryKey: ["/api/admin/settings"],
    staleTime: 0,
  });

  const { data: locations } = useQuery<(Location & { marketName: string })[]>({
    queryKey: ["/api/locations/with-market"],
    staleTime: 0,
  });

  useEffect(() => {
    if (settings) {
      const map: Record<string, string> = {};
      for (const s of settings) {
        if (s.key.startsWith("alert_")) map[s.key] = s.value;
      }
      for (const t of TIMING_SETTINGS) {
        if (!map[t.key]) map[t.key] = String(t.default);
      }
      setValues(map);
    }
  }, [settings]);

  const saveTimingMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      await apiRequest("POST", "/api/admin/sms-templates", { key, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Setting saved", description: "Changes take effect within 5 minutes." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Get current timezone info
  function getTimezoneInfo(tz: string): string {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" });
      const parts = formatter.formatToParts(now);
      const tzName = parts.find(p => p.type === "timeZoneName")?.value || tz;

      const shortFormatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
      const shortParts = shortFormatter.formatToParts(now);
      const offset = shortParts.find(p => p.type === "timeZoneName")?.value || "";

      return `${tzName} (${offset})`;
    } catch {
      return tz;
    }
  }

  // Get all active locations from the full locations list
  const allLocations = locations || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alert Timing</h1>
        <p className="text-muted-foreground">
          Configure when reminder texts and manager alerts are sent.
          Changes take effect within 5 minutes.
        </p>
      </div>

      <div className="grid gap-4">
        {TIMING_SETTINGS.map((t) => {
          const currentValue = values[t.key] || String(t.default);
          const savedValue = settings?.find(s => s.key === t.key)?.value || String(t.default);
          const hasChanges = currentValue !== savedValue;

          return (
            <Card key={t.key}>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <Label className="font-semibold">{t.label}</Label>
                      {hasChanges && <Badge variant="outline" className="text-orange-600 border-orange-300">Unsaved</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{t.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input
                      type="number"
                      min="1"
                      max="1440"
                      value={currentValue}
                      onChange={(e) => setValues({ ...values, [t.key]: e.target.value })}
                      className="w-20 h-8 text-center"
                    />
                    <span className="text-xs text-muted-foreground w-12">{t.unit}</span>
                    <Button
                      size="sm"
                      disabled={!hasChanges || saveTimingMutation.isPending}
                      onClick={() => saveTimingMutation.mutate({ key: t.key, value: currentValue })}
                    >
                      <Save className="h-3 w-3 mr-1" />
                      Save
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Location Timezones</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Timezones are set per location and automatically adjust for daylight saving time.
            Edit timezones on the Locations page.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {allLocations.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between gap-2 rounded-md border p-2">
                <div>
                  <span className="text-sm font-medium">{loc.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{loc.marketName}</span>
                </div>
                <div className="text-right">
                  <Badge variant="outline" className="font-mono text-xs">
                    {getTimezoneInfo(loc.timezone)}
                  </Badge>
                  {loc.active === false && (
                    <Badge variant="secondary" className="ml-1 text-xs">Inactive</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>How timing works:</strong></p>
              <p>1. Esthetician's first appointment starts → <strong>{values["alert_start_reminder_delay_min"] || "15"} min</strong> later, if no start count, send reminder text.</p>
              <p>2. Esthetician's last appointment ends → <strong>{values["alert_end_reminder_delay_min"] || "15"} min</strong> later, if no end count, send soft reminder to esthetician only.</p>
              <p>3. Last appointment ends → <strong>{values["alert_end_escalation_delay_min"] || "60"} min</strong> later, if still no end count, send second text + notify managers.</p>
              <p>4. Last appointment ends → <strong>{values["alert_end_count_window_min"] || "60"} min</strong> later, end count submission is blocked (esthetician must contact manager).</p>
              <p className="mt-2">Daylight saving time is handled automatically. The system uses IANA timezone names (e.g., America/Los_Angeles) which adjust for DST.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
