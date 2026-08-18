import { Switch, Route, Router, Redirect, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useAppHashLocation } from "./lib/hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, usePermissions } from "@/lib/AuthContext";
import { ConfirmActionHost } from "@/components/ConfirmActionDialog";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import FleetRegistry from "@/pages/FleetRegistry";
import LeaseManagement from "@/pages/LeaseManagement";
import MoveCars from "@/pages/MoveCars";
import HistoryPage from "@/pages/History";
import SearchPage from "@/pages/Search";
import BulkImportPage from "@/pages/BulkImport";
import LeaseWizard from "@/pages/LeaseWizard";
import UserManagement from "@/pages/UserManagement";
import Contacts from "@/pages/Contacts";
import APTracker from "@/pages/APTracker";
import Programs from "@/pages/Programs";
import Reports from "@/pages/Reports";
import PhotoSearch from "@/pages/PhotoSearch";
import FleetBrowsePage from "@/pages/FleetBrowse";
import CarDetailPage from "@/pages/CarDetail";
import Login from "@/pages/Login";
import SetPassword from "@/pages/SetPassword";
import AcceptInvite from "@/pages/AcceptInvite";
import DvNewCalculation from "@/pages/DvCalculator/NewCalculation";
import DvHistory from "@/pages/DvCalculator/History";
import DvReference from "@/pages/DvCalculator/Reference";
import NotFound from "@/pages/not-found";

function RedirectAllCars() {
  const [loc] = useLocation();
  const qIndex = loc.indexOf("?");
  const params = new URLSearchParams(qIndex >= 0 ? loc.slice(qIndex + 1) : "");
  if (params.has("highlight") && !params.get("search")) {
    params.set("search", params.get("highlight") || "");
    params.delete("highlight");
  }
  const qs = params.toString();
  return <Redirect to={qs ? `/railcars?${qs}` : "/railcars"} />;
}

function AdminOnlyUsers() {
  const { isAdmin } = usePermissions();
  if (!isAdmin) {
    return (
      <div className="p-8 max-w-lg">
        <h1 className="text-lg font-semibold text-foreground mb-2">Admins only</h1>
        <p className="text-sm text-muted-foreground">
          User management is restricted to administrators. Contact an admin if you need access granted or changed.
        </p>
      </div>
    );
  }
  return <UserManagement />;
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/browse/lessee/:lessee/ol/:ol/car/:id" component={CarDetailPage} />
      <Route path="/browse/entity/:entity/ol/:ol/car/:id" component={CarDetailPage} />
      <Route path="/browse/ol/:ol/car/:id" component={CarDetailPage} />
      <Route path="/browse/turning50/:year/car/:id" component={CarDetailPage} />
      <Route path="/browse/lessee/:lessee/ol/:ol" component={FleetBrowsePage} />
      <Route path="/browse/entity/:entity/ol/:ol" component={FleetBrowsePage} />
      <Route path="/browse/lessee/:lessee" component={FleetBrowsePage} />
      <Route path="/browse/entity/:entity" component={FleetBrowsePage} />
      <Route path="/browse/ol/:ol" component={FleetBrowsePage} />
      <Route path="/browse/turning50/:year" component={FleetBrowsePage} />
      <Route path="/cars/:id" component={CarDetailPage} />
      <Route path="/fleet" component={FleetRegistry} />
      <Route path="/railcars" component={FleetRegistry} />
      <Route path="/all-cars" component={RedirectAllCars} />
      <Route path="/leases" component={LeaseManagement} />
      <Route path="/lease-wizard" component={LeaseWizard} />
      <Route path="/move" component={MoveCars} />
      <Route path="/history" component={HistoryPage} />
      <Route path="/search" component={SearchPage} />
      <Route path="/import" component={BulkImportPage} />
      <Route path="/contacts" component={Contacts} />
      <Route path="/ap" component={APTracker} />
      <Route path="/photo-search" component={PhotoSearch} />
      <Route path="/programs" component={Programs} />
      <Route path="/reports" component={Reports} />
      <Route path="/fleet-intelligence" component={Reports} />
      <Route path="/users" component={AdminOnlyUsers} />
      <Route path="/dv" component={DvNewCalculation} />
      <Route path="/dv/history" component={DvHistory} />
      <Route path="/dv/history/:id" component={DvHistory} />
      <Route path="/dv/reference" component={DvReference} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading, needsPasswordChange, accessDenied } = useAuth();
  const [loc] = useHashLocation();

  // Invite acceptance is public (token_hash in query) — no session yet
  if (loc.startsWith("/accept-invite")) {
    return <AcceptInvite />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (accessDenied || !session) {
    return <Login accessDenied={accessDenied} />;
  }

  // Legacy invite hash (#access_token&type=invite) or recovery
  if (needsPasswordChange) {
    return <SetPassword />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthProvider>
          <ConfirmActionHost />
          <Router hook={useAppHashLocation}>
            <AuthGate>
              <AppLayout>
                <AppRouter />
              </AppLayout>
            </AuthGate>
          </Router>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
