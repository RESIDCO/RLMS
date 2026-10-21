import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCanEdit, useIsAdmin } from "@/lib/AuthContext";
import AssumptionCosts from "@/pages/opportunity/AssumptionCosts";
import CalculatorTab from "@/pages/opportunity/CalculatorTab";
import ScenarioLibrary from "@/pages/opportunity/ScenarioLibrary";

export default function DealCalculatorPage() {
  const canWrite = useCanEdit();
  const isAdmin = useIsAdmin();
  const [tab, setTab] = useState("calculator");
  const initialScenario = Number(new URLSearchParams(window.location.search).get("scenario"));
  const [scenarioId, setScenarioId] = useState<number | null>(Number.isFinite(initialScenario) && initialScenario > 0 ? initialScenario : null);
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden" data-testid="deal-calculator-page">
      <PageHeader
        title="Deal Calculator"
        subtitle="Save a scenario on its own, or attach it to an opportunity. A draft stays on this computer until you save."
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4 space-y-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="calculator">Calculator</TabsTrigger>
            <TabsTrigger value="scenarios">Calculator scenarios</TabsTrigger>
          </TabsList>
          <TabsContent value="calculator" className="space-y-4">
            <CalculatorTab scratch scenarioId={scenarioId} opportunityId={0} canWrite={canWrite} lines={[]} />
            {isAdmin ? <AssumptionCosts /> : null}
          </TabsContent>
          <TabsContent value="scenarios">
            <ScenarioLibrary
              canWrite={canWrite}
              onOpen={(id) => {
                setScenarioId(id);
                setTab("calculator");
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
