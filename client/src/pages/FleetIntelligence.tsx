import PageHeader from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export default function FleetIntelligence() {
  return (
    <div>
      <PageHeader
        title="Fleet Intelligence"
        subtitle="North American UMLER market view — in progress"
      />
      <div className="px-4 sm:px-8 py-8 max-w-2xl">
        <Card>
          <CardContent className="pt-6 flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-umler-panel2">
              <BarChart3 className="h-5 w-5 text-umler-steel" />
            </div>
            <div>
              <h2 className="font-serif text-base font-semibold tracking-tight text-foreground">
                Coming soon
              </h2>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                This section will bring UMLER fleet intelligence into RLMS. The page is a placeholder
                while we confirm which market datasets are reachable from this app.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
