import { useState } from "react";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const { login } = useAdminAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    login.mutate(email.trim(), {
      onError: (err: any) => {
        toast({
          title: "Login Failed",
          description: err.message || "Email not on the admin allowlist.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle data-testid="text-login-title">CashControl Admin</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your authorized email to access the admin portal.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@hellosugar.salon"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="input-admin-email"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={login.isPending || !email.trim()}
              data-testid="button-admin-login"
            >
              {login.isPending ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
