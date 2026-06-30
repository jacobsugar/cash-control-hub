import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Save, MessageSquare, RotateCcw } from "lucide-react";
import type { AppSetting } from "@shared/schema";

interface TemplateConfig {
  key: string;
  label: string;
  category: "alert" | "reminder";
  description: string;
  variables: string[];
  default: string;
}

const TEMPLATES: TemplateConfig[] = [
  // Alert templates (to managers)
  {
    key: "sms_tpl_start_mismatch",
    label: "Start Count Mismatch",
    category: "alert",
    description: "Sent to managers when an esthetician's start count doesn't match after recount.",
    variables: ["location", "container", "expected", "actual", "staff", "note_suffix"],
    default: "CashControl Alert: Cash discrepancy at {location}{container}. Expected ${expected}, counted ${actual} by {staff}.{note_suffix}",
  },
  {
    key: "sms_tpl_end_mismatch",
    label: "End Count Mismatch",
    category: "alert",
    description: "Sent to managers when an esthetician's end count doesn't match after recount.",
    variables: ["location", "container", "expected", "actual", "staff", "note_suffix"],
    default: "CashControl Alert: Cash discrepancy at {location}{container}. Expected ${expected}, counted ${actual} by {staff}.{note_suffix}",
  },
  {
    key: "sms_tpl_missing_end_shift",
    label: "Missing End Count (Manager Alert)",
    category: "alert",
    description: "Sent to managers when an esthetician hasn't submitted their end count after 60 minutes.",
    variables: ["location", "container", "staff"],
    default: "CashControl Alert: Missing end-of-shift count at {location}{container}. {staff} has not submitted their count.",
  },
  {
    key: "sms_tpl_receipt_submitted",
    label: "Receipt Submitted",
    category: "alert",
    description: "Sent to managers when a receipt is uploaded.",
    variables: ["location", "container", "actual", "staff", "note_suffix"],
    default: "CashControl: Receipt submitted at {location}{container} for ${actual} by {staff}.{note_suffix}",
  },
  {
    key: "sms_tpl_missing_receipt",
    label: "Missing Receipt",
    category: "alert",
    description: "Sent to managers when cash is spent without a receipt.",
    variables: ["location", "container", "actual", "staff", "note_suffix"],
    default: "CashControl Alert: Cash spent without receipt at {location}{container} for ${actual} by {staff}.{note_suffix}",
  },
  {
    key: "sms_tpl_collection_mismatch",
    label: "Collection Mismatch",
    category: "alert",
    description: "Sent to managers when collected cash doesn't match expected.",
    variables: ["location", "container", "expected", "actual", "staff", "note_suffix"],
    default: "CashControl Alert: Collection discrepancy at {location}{container}. Expected ${expected}, collected ${actual} by {staff}.{note_suffix}",
  },
  {
    key: "sms_tpl_cleanliness_report",
    label: "Cleanliness Report",
    category: "alert",
    description: "Sent to managers when a cleanliness issue is reported.",
    variables: ["location", "staff", "note_suffix"],
    default: "CashControl: Cleanliness issue reported at {location} by {staff}.{note_suffix}",
  },
  {
    key: "sms_tpl_cleanliness_escalation",
    label: "Cleanliness Escalation",
    category: "alert",
    description: "Sent to owners when a cleanliness report is unresolved for 24+ hours.",
    variables: ["location", "staff", "note_suffix"],
    default: "CashControl ESCALATION: Unresolved cleanliness report at {location} (reported by {staff}) has been open for over 24 hours.{note_suffix}",
  },
  // Reminder templates (to estheticians)
  {
    key: "sms_tpl_start_reminder_suite",
    label: "Start Reminder (Suite)",
    category: "reminder",
    description: "Sent to estheticians at suite locations who haven't submitted their start count.",
    variables: ["first_name", "location"],
    default: "Hi {first_name}, please submit your start-of-shift cash count. Count your drawer and submit via CashControl.",
  },
  {
    key: "sms_tpl_start_reminder_flagship",
    label: "Start Reminder (Flagship)",
    category: "reminder",
    description: "Sent to estheticians at flagship locations who haven't submitted the opening count.",
    variables: ["first_name", "location"],
    default: "Hi {first_name}, please submit the start-of-day cash count for {location}. Count the till and submit via CashControl.",
  },
  {
    key: "sms_tpl_end_reminder_15min_suite",
    label: "End Reminder — 15 min (Suite)",
    category: "reminder",
    description: "Soft reminder sent to the esthetician 15 minutes after their last appointment.",
    variables: ["first_name", "location"],
    default: "Hi {first_name}, your last appointment has ended. Please submit your end-of-shift cash count via CashControl.",
  },
  {
    key: "sms_tpl_end_reminder_15min_flagship",
    label: "End Reminder — 15 min (Flagship)",
    category: "reminder",
    description: "Soft reminder sent 15 minutes after the last appointment at a flagship location.",
    variables: ["first_name", "location"],
    default: "Hi {first_name}, the last appointment at {location} has ended. Please submit the end-of-day cash count via CashControl.",
  },
  {
    key: "sms_tpl_end_reminder_60min_suite",
    label: "End Reminder — 60 min (Suite)",
    category: "reminder",
    description: "Escalation sent to the esthetician 60 minutes after last appointment. Manager is also notified.",
    variables: ["first_name", "location"],
    default: "Hi {first_name}, your end-of-shift cash count is now overdue. Your manager has been notified. Please submit immediately via CashControl.",
  },
  {
    key: "sms_tpl_end_reminder_60min_flagship",
    label: "End Reminder — 60 min (Flagship)",
    category: "reminder",
    description: "Escalation sent 60 minutes after last appointment at a flagship. Manager is also notified.",
    variables: ["first_name", "location"],
    default: "Hi {first_name}, your end-of-day cash count at {location} is now overdue. Your manager has been notified. Please submit immediately via CashControl.",
  },
  {
    key: "sms_tpl_manual_reminder",
    label: "Manual Reminder",
    category: "reminder",
    description: "Sent when a manager manually clicks the Remind button.",
    variables: ["first_name", "location"],
    default: "Hi {first_name}, this is a reminder to submit your end-of-shift cash count for {location}. Please count your drawer and submit via CashControl.",
  },
];

export default function SmsTemplatesPage() {
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"alert" | "reminder">("reminder");

  const { data: settings, isLoading } = useQuery<AppSetting[]>({
    queryKey: ["/api/admin/settings"],
    staleTime: 0,
  });

  // Initialize edits from settings
  useEffect(() => {
    if (settings) {
      const map: Record<string, string> = {};
      for (const s of settings) {
        if (s.key.startsWith("sms_tpl_")) map[s.key] = s.value;
      }
      // Fill in defaults for any missing templates
      for (const t of TEMPLATES) {
        if (!map[t.key]) map[t.key] = t.default;
      }
      setEdits(map);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      await apiRequest("POST", "/api/admin/sms-templates", { key, value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Template saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filtered = TEMPLATES.filter((t) => t.category === tab);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">SMS Templates</h1>
        <p className="text-muted-foreground">
          Customize the text messages sent by the system. Use {"{variables}"} as placeholders.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          variant={tab === "reminder" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("reminder")}
        >
          Esthetician Reminders
        </Button>
        <Button
          variant={tab === "alert" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("alert")}
        >
          Manager Alerts
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((t) => {
            const currentValue = edits[t.key] || t.default;
            const savedValue = settings?.find((s) => s.key === t.key)?.value || t.default;
            const hasChanges = currentValue !== savedValue;

            return (
              <Card key={t.key}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold text-sm">{t.label}</h3>
                    {hasChanges && <Badge variant="outline" className="text-orange-600 border-orange-300">Unsaved</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{t.description}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Textarea
                    value={currentValue}
                    onChange={(e) => setEdits({ ...edits, [t.key]: e.target.value })}
                    rows={3}
                    className="text-sm font-mono"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">Variables:</span>
                      {t.variables.map((v) => (
                        <Badge key={v} variant="secondary" className="text-xs font-mono">
                          {`{${v}}`}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEdits({ ...edits, [t.key]: t.default })}
                        title="Reset to default"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        disabled={!hasChanges || saveMutation.isPending}
                        onClick={() => saveMutation.mutate({ key: t.key, value: currentValue })}
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
      )}
    </div>
  );
}
