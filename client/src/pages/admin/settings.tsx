import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { Settings, Save } from "lucide-react";
import type { AppSetting } from "@shared/schema";

export default function SettingsPage() {
  const { toast } = useToast();
  const [quoApiKey, setQuoApiKey] = useState("");
  const [quoFromNumber, setQuoFromNumber] = useState("");

  const { data: settings, isLoading } = useQuery<AppSetting[]>({
    queryKey: ["/api/admin/settings"],
  });

  useEffect(() => {
    if (settings) {
      const quo = settings.find((s) => s.key === "quo_api_key");
      if (quo) setQuoApiKey(quo.value);
      const fromNum = settings.find((s) => s.key === "quo_from_number");
      if (fromNum) setQuoFromNumber(fromNum.value);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: { key: string; value: string }) => {
      await apiRequest("POST", "/api/admin/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-settings-title">Settings</h1>
        <p className="text-muted-foreground">Application configuration</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">SMS Integration (Quo)</h3>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Configure your Quo SMS API key to enable text message alerts. Alerts will be logged
              in the system regardless of SMS configuration.
            </p>
            <div className="space-y-2">
              <Label>Quo API Key</Label>
              <Input
                type="password"
                value={quoApiKey}
                onChange={(e) => setQuoApiKey(e.target.value)}
                placeholder="Enter your Quo API key"
                data-testid="input-quo-api-key"
              />
            </div>
            <div className="space-y-2">
              <Label>From Phone Number</Label>
              <Input
                type="tel"
                value={quoFromNumber}
                onChange={(e) => setQuoFromNumber(e.target.value)}
                placeholder="+15551234567"
                data-testid="input-quo-from-number"
              />
              <p className="text-xs text-muted-foreground">
                The phone number SMS alerts will be sent from (must be registered with Quo).
              </p>
            </div>
            <Button
              onClick={async () => {
                await saveMutation.mutateAsync({ key: "quo_api_key", value: quoApiKey });
                await saveMutation.mutateAsync({ key: "quo_from_number", value: quoFromNumber });
              }}
              disabled={saveMutation.isPending}
              data-testid="button-save-settings"
            >
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
