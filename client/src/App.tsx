import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/AuthContext";
import AppLayout from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import FleetRegistry from "@/pages/FleetRegistry";
import LeaseManagement from "@/pages/LeaseManagement";
import MoveCars from "@/pages/MoveCars";
import HistoryPage from "@/pages/History";
import SearchPage from "@/pages/Search";
import BulkImportPage from "@/pages/BulkImport";
import AllCars from "@/pages/AllCars";
import LeaseWizard from "@/pages/LeaseWizard";
import UserManagement from "@/pages/UserManagement";
import Contacts from "@/pages/Contacts";
import APTracker from "@/pages/APTracker";
import Programs from "@/pages/Programs";
import Reports from "@/pages/Reports";
import PhotoSearch from "@/pages/PhotoSearch";
import Login from "@/pages/Login";
import SetPassword from "@/pages/SetPassword";
import AcceptInvite from "@/pages/AcceptInvite";
import DvNewCalculation from "@/pages/DvCalculator/NewCalculation";
import DvHistory from "@/pages/DvCalculator/History";
import DvReference from "@/pages/DvCalculator/Reference";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/fleet" component={FleetRegistry} />
      <Route path="/all-cars" component={AllCars} />
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
      <Route path="/users" component={UserManagement} />
      <Route path="/dv" component={DvNewCalculation} />
      <Route path="/dv/history" component={DvHistory} />
      <Route path="/dv/history/:id" component={DvHistory} />
      <Route path="/dv/reference" component={DvReference} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading, needsPasswordChange } = useAuth();
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

  if (!session) {
    return <Login />;
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
          <Router hook={useHashLocation}>
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
