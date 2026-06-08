import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Camera,
  CheckCircle2,
  X,
  ArrowLeft,
  Upload,
  FileImage,
} from "lucide-react";
import helloSugarLogo from "@/assets/hello-sugar-logo.png";
import type { Esthetician, Location } from "@shared/schema";

export default function ReportPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = useParams<{ locationId?: string }>();
  const locationIdParam = params?.locationId || null;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedEsthetician, setSelectedEsthetician] = useState("");
  const [selectedLocation, setSelectedLocation] = useState(locationIdParam || "");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const esthQueryKey = selectedLocation
    ? `/api/estheticians?locationId=${selectedLocation}`
    : "/api/estheticians";
  const { data: estheticians, isLoading: loadingEsth } = useQuery<Esthetician[]>({
    queryKey: [esthQueryKey],
  });

  const { data: locations, isLoading: loadingLoc } = useQuery<(Location & { marketName: string })[]>({
    queryKey: ["/api/locations/with-market"],
  });

  useEffect(() => {
    if (locationIdParam) {
      setSelectedLocation(locationIdParam);
    }
  }, [locationIdParam]);

  const currentLocation = locations?.find((l) => String(l.id) === selectedLocation);
  const locationLabel = currentLocation
    ? `${currentLocation.marketName} - ${currentLocation.name}`
    : "";

  const submitMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("locationId", selectedLocation);
      formData.append("reportedByEstheticianId", selectedEsthetician);
      formData.append("note", note);
      for (const file of files) {
        formData.append("photos", file);
      }
      const res = await fetch("/api/cleanliness-reports", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Submission failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: "Report submitted", description: "Your cleanliness report has been filed." });
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length === 0) return;
    const combined = [...files, ...newFiles].slice(0, 10);
    setFiles(combined);

    const newPreviews: string[] = [...previews];
    for (const f of newFiles) {
      if (f.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          newPreviews.push(reader.result as string);
          setPreviews([...newPreviews]);
        };
        reader.readAsDataURL(f);
      } else {
        newPreviews.push("");
        setPreviews([...newPreviews]);
      }
    }
    // Reset the input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
    setPreviews(previews.filter((_, i) => i !== index));
  };

  const activeEstheticians = estheticians?.filter((e) => e.active) || [];

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Report Submitted</h2>
            <p className="text-muted-foreground mb-6">
              Your cleanliness report has been filed and managers have been notified.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => {
                  setSubmitted(false);
                  setFiles([]);
                  setPreviews([]);
                  setNote("");
                  setSelectedEsthetician("");
                }}
              >
                Submit Another Report
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(locationIdParam ? `/count/${locationIdParam}` : "/")}
              >
                Back to Cash Count
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
        <div className="mx-auto max-w-lg px-4 py-4 flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (locationIdParam) navigate(`/count/${locationIdParam}`);
              else navigate("/");
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <img src={helloSugarLogo} alt="Hello Sugar" className="h-7 w-auto" />
          <div>
            <h1 className="text-sm font-semibold leading-tight">Report Issue</h1>
            <p className="text-[10px] text-muted-foreground leading-tight">CashControl by Hello Sugar</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6 space-y-4">
        {locationIdParam && locationLabel && (
          <p className="text-sm text-muted-foreground">{locationLabel}</p>
        )}

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>Your Name</Label>
              {loadingEsth ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={selectedEsthetician} onValueChange={setSelectedEsthetician}>
                  <SelectTrigger>
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
                <Label>Location</Label>
                {loadingLoc ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations?.map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>
                          {l.marketName} - {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>What's the issue?</Label>
              <Textarea
                placeholder="Describe the cleanliness or maintenance issue..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label>Photos (optional, up to 10)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handleFilesChange}
                className="hidden"
              />

              {files.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {files.map((file, idx) => (
                    <div key={idx} className="relative rounded-md border overflow-hidden aspect-square">
                      {previews[idx] ? (
                        <img src={previews[idx]} alt={file.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted">
                          <FileImage className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <button
                        onClick={() => removeFile(idx)}
                        className="absolute top-1 right-1 rounded-full bg-background/80 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {files.length < 10 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-md border-2 border-dashed p-6 text-center hover-elevate active-elevate-2 transition-colors"
                >
                  <Camera className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Tap to take or upload photos</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {files.length > 0 ? `${files.length} photo${files.length > 1 ? "s" : ""} selected` : "JPG, PNG, HEIC"}
                  </p>
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        <Button
          className="w-full"
          size="lg"
          disabled={
            !selectedEsthetician ||
            !selectedLocation ||
            !note.trim() ||
            submitMutation.isPending
          }
          onClick={() => submitMutation.mutate()}
        >
          {submitMutation.isPending ? "Submitting..." : "Submit Report"}
        </Button>
      </main>
    </div>
  );
}
