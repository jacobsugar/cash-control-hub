import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";
import CountPage from "@/pages/count";
import ReceiptUploadPage from "@/pages/receipt-upload";
import ReportPage from "@/pages/report";
import AdminLayout from "@/pages/admin/layout";
import AdminLoginPage from "@/pages/admin/login";
import AdminDashboard from "@/pages/admin/dashboard";
import ShiftsPage from "@/pages/admin/shifts";
import ReceiptsPage from "@/pages/admin/receipts";
import AlertsPage from "@/pages/admin/alerts";
import CollectionsPage from "@/pages/admin/collections";
import BoulevardPage from "@/pages/admin/boulevard";
import MarketsPage from "@/pages/admin/markets";
import LocationsPage from "@/pages/admin/locations";
import EstheticiansPage from "@/pages/admin/estheticians";
import RecipientsPage from "@/pages/admin/recipients";
import AdminUsersPage from "@/pages/admin/admin-users";
import SettingsPage from "@/pages/admin/settings";
import LogsPage from "@/pages/admin/logs";
import CleanlinessReportsPage from "@/pages/admin/cleanliness-reports";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { Loader2 } from "lucide-react";

function AdminRouter() {
  const { isAuthenticated, isLoading } = useAdminAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AdminLoginPage />;
  }

  return (
    <AdminLayout>
      <Switch>
        <Route path="/" component={AdminDashboard} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/admin/shifts" component={ShiftsPage} />
        <Route path="/admin/receipts" component={ReceiptsPage} />
        <Route path="/admin/alerts" component={AlertsPage} />
        <Route path="/admin/collections" component={CollectionsPage} />
        <Route path="/admin/boulevard" component={BoulevardPage} />
        <Route path="/admin/markets" component={MarketsPage} />
        <Route path="/admin/locations" component={LocationsPage} />
        <Route path="/admin/estheticians" component={EstheticiansPage} />
        <Route path="/admin/recipients" component={RecipientsPage} />
        <Route path="/admin/users" component={AdminUsersPage} />
        <Route path="/admin/settings" component={SettingsPage} />
        <Route path="/admin/cleanliness-reports" component={CleanlinessReportsPage} />
        <Route path="/admin/logs" component={LogsPage} />
        <Route component={NotFound} />
      </Switch>
    </AdminLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/count/:locationId" component={CountPage} />
      <Route path="/receipt/:locationId" component={ReceiptUploadPage} />
      <Route path="/report/:locationId" component={ReportPage} />
      <Route path="/report" component={ReportPage} />
      <Route path="/admin" component={AdminRouter} />
      <Route path="/admin/:rest*" component={AdminRouter} />
      <Route path="/" component={AdminRouter} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
