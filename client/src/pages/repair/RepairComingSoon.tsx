/**
 * Placeholder for repair module routes not yet built (nav must not 404).
 */
import { useLocation } from "wouter";
import RepairOwnerShell from "./RepairOwnerShell";

const TITLES: Record<string, string> = {
  "/repair/bad-orders": "Bad Orders",
  "/repair/estimates/brc": "Estimates · BRC",
  "/repair/outbound-dispos": "Outbound Dispos",
  "/repair/invoices": "Invoices",
  "/repair/assignments": "Assignments",
  "/repair/shops": "Reference · Shops",
  "/repair/bo-reasons": "Reference · BO reasons",
  "/repair/billing-roads": "Reference · Billing roads",
  "/repair/admin": "Admin",
  "/repair/help": "Help",
};

function titleFor(path: string): string {
  const bare = path.split("?")[0] ?? path;
  return TITLES[bare] ?? "Repair";
}

export default function RepairComingSoon() {
  const [location] = useLocation();
  const title = titleFor(location);

  return (
    <RepairOwnerShell light>
      <div className="bg-[#8B1E1E] text-white px-4 py-2 font-semibold tracking-wide">
        Residco — Main — Default :: {title}
      </div>
      <div className="p-8 max-w-xl">
        <h1 className="text-xl font-semibold text-slate-900 mb-2">{title}</h1>
        <p className="text-slate-800 text-sm leading-relaxed">
          Coming soon. This screen is on the Owner UI map but is not part of the
          current Estimates History (§A) delivery. Use{" "}
          <a href="#/repair" className="text-blue-800 underline font-medium">
            Estimates History
          </a>{" "}
          for the actionable queue.
        </p>
      </div>
    </RepairOwnerShell>
  );
}
