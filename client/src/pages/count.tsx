import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DollarSign, ArrowRight, AlertTriangle, CheckCircle2, Clock, Shield, Flag } from "lucide-react";
import helloSugarLogo from "@/assets/hello-sugar-logo.png";
import type { Esthetician, Location, Container, Market } from "@shared/schema";

export default function CountPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = useParams<{ locationId?: string }>();
  const locationIdParam = params?.locationId || null;

  const [step, setStep] = useState<"select" | "count" | "done">("select");
  const [shiftType, setShiftType] = useState<"start" | "end">("start");
  const [selectedEsthetician, setSelectedEsthetician] = useState("");
  const [selectedLocation, setSelectedLocation] = useState(locationIdParam || "");
  const [selectedContainer, setSelectedContainer] = useState("");
  const [countedAmount, setCountedAmount] = useState("");
  const [discrepancyNote, setDiscrepancyNote] = useState("");
  const [priorAmount, setPriorAmount] = useState<string | null>(null);
  const [expectedAmount, setExpectedAmount] = useState<string | null>(null);

  const esthQueryKey = selectedLocation
    ? `/api/estheticians?locationId=${selectedLocation}`
    : "/api/estheticians";
  const { data: estheticians, isLoading: loadingEsth } = useQuery<Esthetician[]>({
    queryKey: [esthQueryKey],
  });

  const { data: locations, isLoading: loadingLoc } = useQuery<(Location & { marketName: string })[]>({
    queryKey: ["/api/locations/with-market"],
  });

  const { data: containers, isLoading: loadingContainers } = useQuery<Container[]>({
    queryKey: ["/api/containers", selectedLocation],
    enabled: !!selectedLocation,
  });

  useEffect(() => {
    if (locationIdParam) {
      setSelectedLocation(locationIdParam);
    }
  }, [locationIdParam]);

  useEffect(() => {
    if (containers && containers.length === 1 && !selectedContainer) {
      setSelectedContainer(String(containers[0].id));
    }
  }, [containers, selectedContainer]);

  const priorQuery = useQuery<{ amount: string; expectedAmount: string }>({
    queryKey: ["/api/containers", selectedContainer, "prior"],
    enabled: !!selectedContainer && step === "count",
  });

  const isRecountingRef = useRef(false);

  const submitMutation = useMutation({
    mutationFn: async (data: {
      containerId: number;
      estheticianId: number;
      type: "start" | "end";
      countedAmount: string;
      expectedAmount: string | null;
      discrepancyNote: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/shift-counts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shift-counts"] });
      // Don't go to done screen if this was a recount submission
      if (!isRecountingRef.current) {
        setStep("done");
        toast({ title: "Cash count submitted", description: "Your count has been recorded successfully." });
      }
      isRecountingRef.current = false;
    },
    onError: (err: Error) => {
      isRecountingRef.current = false;
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [syncing, setSyncing] = useState(false);

  const handleProceedToCount = async () => {
    if (!selectedEsthetician || !selectedLocation || !selectedContainer) return;

    // Sync Boulevard transactions for this location before counting
    setSyncing(true);
    try {
      await fetch("/api/boulevard/sync-for-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: parseInt(selectedLocation) }),
      });
    } catch (e) {
      // Sync failure should not block the count
      console.warn("Boulevard sync before count failed:", e);
    }
    setSyncing(false);

    // Reset count state so user always starts with a fresh blind count
    setSubmitted(false);
    setRecounting(false);
    setCountedAmount("");
    setExpectedAmount(null);
    setDiscrepancyNote("");

    setStep("count");
  };

  const [submitted, setSubmitted] = useState(false);
  const [recounting, setRecounting] = useState(false);

  const hasMismatch =
    submitted &&
    countedAmount !== "" &&
    expectedAmount !== null &&
    parseFloat(countedAmount) !== parseFloat(expectedAmount);

  const handleSubmit = () => {
    if (priorQuery.data) {
      setExpectedAmount(priorQuery.data.expectedAmount);
    }
    setSubmitted(true);
  };

  const handleRecount = () => {
    // Flag so global onSuccess doesn't navigate to done screen
    isRecountingRef.current = true;
    // Record the failed count attempt with an alert
    submitMutation.mutate({
      containerId: parseInt(selectedContainer),
      estheticianId: parseInt(selectedEsthetician),
      type: shiftType,
      countedAmount,
      expectedAmount,
      discrepancyNote: `[RECOUNT] ${discrepancyNote || "First count mismatch — recounting"}`,
    }, {
      onSuccess: () => {
        // Reset for a new blind count
        setSubmitted(false);
        setRecounting(true);
        setCountedAmount("");
        setExpectedAmount(null);
        setDiscrepancyNote("");
        toast({ title: "Miscount recorded", description: "Your first count was logged. Please recount the cash." });
      },
    });
  };

  const handleConfirmSubmit = () => {
    if (hasMismatch && !discrepancyNote.trim()) {
      toast({ title: "Note required", description: "Please explain the discrepancy before submitting.", variant: "destructive" });
      return;
    }
    submitMutation.mutate({
      containerId: parseInt(selectedContainer),
      estheticianId: parseInt(selectedEsthetician),
      type: shiftType,
      countedAmount,
      expectedAmount,
      discrepancyNote: hasMismatch ? (recounting ? `[RECOUNT] ${discrepancyNote}` : discrepancyNote) : null,
    });
  };

  const activeEstheticians = estheticians?.filter((e) => e.active) || [];

  const currentLocation = locations?.find((l) => String(l.id) === selectedLocation);
  const locationLabel = currentLocation
    ? `${currentLocation.marketName} - ${currentLocation.name}`
    : "";

  if (step === "done") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2" data-testid="text-success-title">Count Submitted</h2>
            <p className="text-muted-foreground mb-6">
              Your {shiftType === "start" ? "start-of-shift" : "end-of-shift"} cash count has been recorded.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => {
                  setStep("select");
                  setCountedAmount("");
                  setDiscrepancyNote("");
                  setSelectedEsthetician("");
                  if (!locationIdParam) {
                    setSelectedLocation("");
                  }
                  setSelectedContainer(containers?.length === 1 ? String(containers[0].id) : "");
                }}
                data-testid="button-new-count"
              >
                Submit Another Count
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(locationIdParam ? `/receipt/${locationIdParam}` : "/receipt")}
                data-testid="button-upload-receipt"
              >
                Upload a Receipt
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(locationIdParam ? `/report/${locationIdParam}` : "/report")}
                data-testid="button-report-issue"
              >
                Report an Issue
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-lg px-4 py-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <img src={helloSugarLogo} alt="Hello Sugar" className="h-7 w-auto" data-testid="img-count-logo" />
            <div>
              <h1 className="text-sm font-semibold leading-tight">CashControl</h1>
              <p className="text-[10px] text-muted-foreground leading-tight">by Hello Sugar</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(locationIdParam ? `/receipt/${locationIdParam}` : "/receipt")}
              data-testid="button-goto-receipt"
            >
              <Receipt className="h-4 w-4 mr-1" />
              Receipt
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(locationIdParam ? `/report/${locationIdParam}` : "/report")}
              data-testid="button-goto-report"
            >
              <Flag className="h-4 w-4 mr-1" />
              Report
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/")}
              data-testid="button-goto-admin"
            >
              <Shield className="h-4 w-4 mr-1" />
              Admin
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Cash Count</span>
          </div>
          <h2 className="text-2xl font-bold" data-testid="text-page-title">
            {step === "select" ? "Start Your Count" : `${shiftType === "start" ? "Start" : "End"} of Shift`}
          </h2>
          {locationIdParam && locationLabel && (
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-location-label">
              {locationLabel}
            </p>
          )}
        </div>

        {step === "select" && (
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    variant={shiftType === "start" ? "default" : "outline"}
                    onClick={() => setShiftType("start")}
                    data-testid="button-shift-start"
                  >
                    Start of Shift
                  </Button>
                  <Button
                    className="flex-1"
                    variant={shiftType === "end" ? "default" : "outline"}
                    onClick={() => setShiftType("end")}
                    data-testid="button-shift-end"
                  >
                    End of Shift
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="esthetician">Your Name</Label>
                  {loadingEsth ? (
                    <Skeleton className="h-9 w-full" />
                  ) : (
                    <Select value={selectedEsthetician} onValueChange={setSelectedEsthetician}>
                      <SelectTrigger id="esthetician" data-testid="select-esthetician">
                        <SelectValue placeholder="Select your name" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeEstheticians.map((e) => (
                          <SelectItem key={e.id} value={String(e.id)}>
                            {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {!locationIdParam && (
                  <div className="space-y-2">
                    <Label htmlFor="location">Location</Label>
                    {loadingLoc ? (
                      <Skeleton className="h-9 w-full" />
                    ) : (
                      <Select
                        value={selectedLocation}
                        onValueChange={(val) => {
                          setSelectedLocation(val);
                          setSelectedContainer("");
                        }}
                      >
                        <SelectTrigger id="location" data-testid="select-location">
                          <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                        <SelectContent>
                          {locations?.map((l) => (
                            <SelectItem key={l.id} value={String(l.id)}>
                              {l.marketName} - {l.name}
                              {l.type === "flagship" ? " (Flagship)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}

                {selectedLocation && containers && containers.length > 1 && (
                  <div className="space-y-2">
                    <Label htmlFor="container">Suite</Label>
                    {loadingContainers ? (
                      <Skeleton className="h-9 w-full" />
                    ) : (
                      <Select value={selectedContainer} onValueChange={setSelectedContainer}>
                        <SelectTrigger id="container" data-testid="select-container">
                          <SelectValue placeholder="Select suite" />
                        </SelectTrigger>
                        <SelectContent>
                          {containers?.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              className="w-full"
              size="lg"
              disabled={!selectedEsthetician || !selectedLocation || !selectedContainer || syncing}
              onClick={handleProceedToCount}
              data-testid="button-proceed"
            >
              {syncing ? "Syncing latest transactions..." : "Continue"}
              {!syncing && <ArrowRight className="ml-2 h-4 w-4" />}
            </Button>
          </div>
        )}

        {step === "count" && (
          <div className="space-y-4">
            {priorQuery.isLoading ? (
              <Card>
                <CardContent className="pt-6">
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ) : null}

            {!submitted ? (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="counted">Count the cash and enter the total</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="counted"
                        type="number"
                        step="1"
                        min="0"
                        placeholder="0"
                        className="pl-9 text-lg"
                        value={countedAmount}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val.includes(".")) {
                            toast({
                              title: "Whole dollars only",
                              description: "Don't include change — round down to the nearest whole dollar.",
                              variant: "destructive",
                            });
                            return;
                          }
                          setCountedAmount(val);
                        }}
                        data-testid="input-counted-amount"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter the whole dollar amount only — do not include change.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* First attempt mismatch: hide expected amount, just say there's a discrepancy */}
                {hasMismatch && !recounting ? (
                  <>
                    <Card>
                      <CardContent className="pt-6">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Your Count</p>
                          <p className="text-xl font-bold" data-testid="text-counted-result">
                            ${countedAmount}
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="pt-6">
                        <div className="rounded-md bg-destructive/10 p-3 border border-destructive/20">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-destructive">Discrepancy Detected</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Your count doesn't match the expected amount. Please recount the cash.
                              </p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <>
                    {/* Recount or matching: show both amounts */}
                    <Card>
                      <CardContent className="pt-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Your Count</p>
                            <p className="text-xl font-bold" data-testid="text-counted-result">
                              ${countedAmount}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Expected Amount</p>
                            <p className={`text-xl font-bold ${hasMismatch ? "text-destructive" : "text-green-600"}`} data-testid="text-expected-amount">
                              ${expectedAmount ?? "0.00"}
                            </p>
                          </div>
                        </div>
                        {!hasMismatch && (
                          <div className="mt-3 flex items-center gap-2 text-green-600">
                            <CheckCircle2 className="h-4 w-4" />
                            <p className="text-sm font-medium">Amounts match</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {hasMismatch && recounting && (
                      <Card>
                        <CardContent className="pt-6">
                          <div className="rounded-md bg-destructive/10 p-3 border border-destructive/20">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                              <div>
                                <p className="text-sm font-medium text-destructive">Discrepancy Detected</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Expected ${expectedAmount} but you counted ${countedAmount}.
                                  Difference: ${Math.round(parseFloat(countedAmount) - parseFloat(expectedAmount || "0"))}
                                </p>
                              </div>
                            </div>
                            <div className="mt-3 space-y-2">
                              <Label htmlFor="note" className="text-sm">Reason (required)</Label>
                              <Textarea
                                id="note"
                                placeholder="Explain the discrepancy..."
                                value={discrepancyNote}
                                onChange={(e) => setDiscrepancyNote(e.target.value)}
                                data-testid="input-discrepancy-note"
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep("select")} data-testid="button-back">
                Back
              </Button>
              {/* First mismatch: hide Confirm, only show Recount */}
              {!(submitted && hasMismatch && !recounting) && (
                <Button
                  className="flex-1"
                  size="lg"
                  disabled={
                    !countedAmount ||
                    submitMutation.isPending ||
                    (submitted && hasMismatch && !discrepancyNote.trim())
                  }
                  onClick={submitted ? handleConfirmSubmit : handleSubmit}
                  data-testid="button-submit-count"
                >
                  {submitMutation.isPending ? "Submitting..." : submitted ? "Confirm & Submit" : "Submit Count"}
                </Button>
              )}
            </div>
            {submitted && hasMismatch && !recounting && (
              <Button
                variant="outline"
                className="w-full"
                disabled={submitMutation.isPending}
                onClick={handleRecount}
              >
                {submitMutation.isPending ? "Recording..." : "Recount"}
              </Button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Receipt({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/>
      <path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/>
    </svg>
  );
}
