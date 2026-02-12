import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  Upload,
  DollarSign,
  CheckCircle2,
  FileImage,
  X,
  ArrowLeft,
  Loader2,
  ScanLine,
} from "lucide-react";
import helloSugarLogo from "@assets/Logo_for_Swag_(1)_1770876580780.png";
import type { Esthetician, Location, Container } from "@shared/schema";

export default function ReceiptUploadPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = useParams<{ locationId?: string }>();
  const locationIdParam = params?.locationId || null;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedEsthetician, setSelectedEsthetician] = useState("");
  const [selectedLocation, setSelectedLocation] = useState(locationIdParam || "");
  const [selectedContainer, setSelectedContainer] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [ocrApplied, setOcrApplied] = useState(false);
  const ocrRequestIdRef = useRef(0);

  const { data: estheticians, isLoading: loadingEsth } = useQuery<Esthetician[]>({
    queryKey: ["/api/estheticians"],
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

  const currentLocation = locations?.find((l) => String(l.id) === selectedLocation);
  const locationLabel = currentLocation
    ? `${currentLocation.marketName} - ${currentLocation.name}`
    : "";

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("containerId", selectedContainer);
      formData.append("estheticianId", selectedEsthetician);
      formData.append("amount", amount);
      if (note) formData.append("note", note);
      const res = await fetch("/api/receipts", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setSubmitted(true);
      toast({ title: "Receipt uploaded", description: "Your receipt has been recorded." });
    },
    onError: (err: Error) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setOcrApplied(false);
      setAmount("");
      if (f.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => setPreview(reader.result as string);
        reader.readAsDataURL(f);

        const requestId = ++ocrRequestIdRef.current;
        setIsScanning(true);
        try {
          const formData = new FormData();
          formData.append("file", f);
          const res = await fetch("/api/ocr/receipt", {
            method: "POST",
            body: formData,
          });
          if (res.ok && requestId === ocrRequestIdRef.current) {
            const data = await res.json();
            if (data.amount) {
              setAmount(data.amount);
              setOcrApplied(true);
              toast({ title: "Amount detected", description: `$${data.amount} was read from your receipt. You can update it if needed.` });
            } else {
              toast({ title: "Could not read amount", description: "Please enter the receipt amount manually.", variant: "destructive" });
            }
          }
        } catch {
          toast({ title: "Could not read receipt", description: "Please enter the amount manually.", variant: "destructive" });
        } finally {
          if (requestId === ocrRequestIdRef.current) {
            setIsScanning(false);
          }
        }
      } else {
        setPreview(null);
        if (f.type === "application/pdf") {
          toast({ title: "PDF uploaded", description: "Auto-read only works with photos. Please enter the amount manually." });
        }
      }
    }
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
            <h2 className="text-xl font-semibold mb-2" data-testid="text-receipt-success">Receipt Uploaded</h2>
            <p className="text-muted-foreground mb-6">Your receipt has been logged.</p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => {
                  setSubmitted(false);
                  setFile(null);
                  setPreview(null);
                  setAmount("");
                  setNote("");
                  setOcrApplied(false);
                }}
                data-testid="button-upload-another"
              >
                Upload Another Receipt
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (locationIdParam) navigate(`/count/${locationIdParam}`);
                }}
                disabled={!locationIdParam}
                data-testid="button-back-count"
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
            data-testid="button-back-home"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <img src={helloSugarLogo} alt="Hello Sugar" className="h-7 w-auto" data-testid="img-receipt-logo" />
          <div>
            <h1 className="text-sm font-semibold leading-tight">Upload Receipt</h1>
            <p className="text-[10px] text-muted-foreground leading-tight">CashControl by Hello Sugar</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6 space-y-4">
        {locationIdParam && locationLabel && (
          <p className="text-sm text-muted-foreground" data-testid="text-receipt-location-label">
            {locationLabel}
          </p>
        )}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>Your Name</Label>
              {loadingEsth ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={selectedEsthetician} onValueChange={setSelectedEsthetician}>
                  <SelectTrigger data-testid="select-receipt-esthetician">
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
                  <Select
                    value={selectedLocation}
                    onValueChange={(val) => {
                      setSelectedLocation(val);
                      setSelectedContainer("");
                    }}
                  >
                    <SelectTrigger data-testid="select-receipt-location">
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

            {selectedLocation && containers && containers.length > 1 && (
              <div className="space-y-2">
                <Label>Suite</Label>
                {loadingContainers ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Select value={selectedContainer} onValueChange={setSelectedContainer}>
                    <SelectTrigger data-testid="select-receipt-container">
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

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>Receipt Photo/File</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,.heic,.pdf"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-receipt-file"
              />
              {file ? (
                <div className="relative rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    {preview ? (
                      <img src={preview} alt="Receipt" className="h-16 w-16 rounded-md object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-md bg-muted">
                        <FileImage className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setFile(null);
                        setPreview(null);
                        setOcrApplied(false);
                        setAmount("");
                      }}
                      data-testid="button-remove-file"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-md border-2 border-dashed p-8 text-center hover-elevate active-elevate-2 transition-colors"
                  data-testid="button-select-file"
                >
                  <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm font-medium">Tap to upload receipt</p>
                  <p className="text-xs text-muted-foreground mt-1">JPG, PNG, HEIC, or PDF</p>
                </button>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Label htmlFor="receipt-amount">Receipt Amount</Label>
                {isScanning && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="text-ocr-scanning">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Reading receipt...
                  </span>
                )}
                {ocrApplied && !isScanning && (
                  <span className="flex items-center gap-1 text-xs text-primary" data-testid="text-ocr-detected">
                    <ScanLine className="h-3 w-3" />
                    Auto-detected
                  </span>
                )}
              </div>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="receipt-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  className="pl-9 text-lg"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (ocrApplied) setOcrApplied(false);
                  }}
                  data-testid="input-receipt-amount"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receipt-note">Note (optional)</Label>
              <Textarea
                id="receipt-note"
                placeholder="What was this purchase for?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                data-testid="input-receipt-note"
              />
            </div>
          </CardContent>
        </Card>

        <Button
          className="w-full"
          size="lg"
          disabled={
            !file ||
            !amount ||
            !selectedEsthetician ||
            !selectedContainer ||
            uploadMutation.isPending
          }
          onClick={() => uploadMutation.mutate()}
          data-testid="button-submit-receipt"
        >
          {uploadMutation.isPending ? "Uploading..." : "Submit Receipt"}
        </Button>
      </main>
    </div>
  );
}
