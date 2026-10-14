/**
 * Placeholder for repair module routes not yet built (nav must not 404).
 */
import { useLocation } from "wouter";
import RepairOwnerShell from "./RepairOwnerShell";
import { useRepairTheme } from "./repairTheme";
import { WorkspaceBanner } from "./WorkspaceTitle";

const TITLES: Record<string, string> = {
  "/repair/bad-orders": "Bad Orders",
  "/repair/estimates/brc": "Estimates · BRC",
  "/repair/outbound-dispos": "Outbound Dispos",
  "/repair/invoices": "Invoices",
  "/repair/shops": "Shops",
  "/repair/bo-reasons": "Reference · BO reasons",
  "/repair/billing-roads": "Reference · Billing roads",
  "/repair/admin": "Admin",
  "/repair/help": "Help",
};

function titleFor(path: string): string {
  const bare = path.split("?")[0] ?? path;
  return TITLES[bare] ?? "Repair";
}

function ComingSoonBody({ title }: { title: string }) {
  const { theme } = useRepairTheme();
  const dark = theme === "dark";
  return (
    <>
      <WorkspaceBanner pageTitle={title} />
      <div className={`p-8 max-w-xl ${dark ? "text-slate-100" : "text-slate-900"}`}>
        <h1 className="text-xl font-semibold mb-2">{title}</h1>
        <p className={`text-sm leading-relaxed ${dark ? "text-slate-300" : "text-slate-800"}`}>
          Coming soon. This screen is on the Owner UI map but is not built in the
          current slice. Use{" "}
          <a href="#/repair" className="text-blue-700 dark:text-sky-300 underline font-medium">
            Estimates History
          </a>{" "}
          or{" "}
          <a href="#/repair/shops" className="text-blue-700 dark:text-sky-300 underline font-medium">
            Shop Master
          </a>
          .
        </p>
      </div>
    </>
  );
}

export default function RepairComingSoon() {
  const [location] = useLocation();
  const title = titleFor(location);

  return (
    <RepairOwnerShell>
      <ComingSoonBody title={title} />
    </RepairOwnerShell>
  );
}
