import PageHeader from "@/components/PageHeader";
import { useCanEdit } from "@/lib/AuthContext";
import CalculatorTab from "@/pages/opportunity/CalculatorTab";

export default function DealCalculatorPage() {
  const canWrite = useCanEdit();
  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden" data-testid="deal-calculator-page">
      <PageHeader
        title="Deal Calculator"
        subtitle="Scratch pricing. Nothing is saved until you attach it to an opportunity or bid line."
      />
      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-8 py-4">
        <CalculatorTab scratch opportunityId={0} canWrite={canWrite} lines={[]} />
      </div>
    </div>
  );
}
