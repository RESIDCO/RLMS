import { ReactNode } from "react";

export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="px-4 sm:px-8 pt-5 sm:pt-7 pb-4 sm:pb-5 border-b border-border flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6">
      <div>
        <div className="font-eyebrow mb-1.5">
          RLMS
        </div>
        <h1 className="font-serif text-lg sm:text-xl font-semibold tracking-tight text-foreground" data-testid="text-page-title">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex gap-2 items-center flex-wrap">{actions}</div>}
    </div>
  );
}
