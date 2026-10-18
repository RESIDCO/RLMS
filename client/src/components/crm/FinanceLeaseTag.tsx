import { financeLeaseTag } from "@shared/crm";

/** Informational badge. Renders nothing unless the OL number starts with FL. */
export default function FinanceLeaseTag({ code }: { code: string | null | undefined }) {
  const tag = financeLeaseTag(code);
  if (!tag) return null;
  return (
    <span className="ml-2 inline-flex rounded bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {tag}
    </span>
  );
}
