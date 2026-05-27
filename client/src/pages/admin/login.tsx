import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import helloSugarLogo from "@/assets/hello-sugar-logo.png";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, config: any) => void;
        };
      };
    };
  }
}

export default function AdminLoginPage() {
  const { toast } = useToast();
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);

  const handleGoogleResponse = async (response: any) => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/admin/login/google", {
        credential: response.credential,
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/me"] });
      toast({ title: "Welcome", description: `Signed in as ${data.name || data.email}` });
    } catch (err: any) {
      toast({
        title: "Login Failed",
        description: err.message || "Your account is not authorized.",
        variant: "destructive",
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    // Load Google Identity Services script
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google && googleButtonRef.current) {
        window.google.accounts.id.initialize({
          client_id: "1090858531166-oqdlo1h11vu7bpskrjf5q3nrf43lpvdk.apps.googleusercontent.com",
          callback: handleGoogleResponse,
          auto_select: true,
          hosted_domain: "hellosugar.salon",
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          width: "100%",
          text: "signin_with",
          shape: "rectangular",
        });
      }
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img src={helloSugarLogo} alt="Hello Sugar" className="h-12 w-auto mx-auto" />
          </div>
          <CardTitle className="text-xl">CashControl Admin</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in with your Hello Sugar Google account
          </p>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Signing in...</p>
          ) : (
            <div ref={googleButtonRef} className="w-full flex justify-center" />
          )}
          <p className="text-xs text-muted-foreground text-center">
            Only @hellosugar.salon accounts are authorized
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
