import { asOne } from "@shared/lease-type";
import { displayLeaseNumber } from "@shared/residco-import";
import { formatCalendarDate } from "@shared/lease-authority";
import { LeaseTypeBadge } from "@/components/LeaseTypeBadge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { navigateHash } from "@/lib/hash-location";

export type LeaseGlanceLease = {
  id?: number | null;
  lease_number?: string | null;
  agreement_number?: string | null;
  lessor?: string | null;
  lessee?: string | null;
  lease_type?: string | null;
  sold_to?: string | null;
};

export type LeaseGlanceRider = {
  id: number;
  rider_name?: string | null;
  schedule_number?: string | null;
  effective_date?: string | null;
  expiration_date?: string | null;
  monthly_rate_pct?: number | string | null;
  lessors_cost?: number | string | null;
  car_count?: number | null;
  master_lease?: LeaseGlanceLease | LeaseGlanceLease[] | null;
};

export function glanceRiderFromCar(car: any, carCount?: number | null): LeaseGlanceRider | null {
  const rider = asOne(car?.assignment?.rider) as LeaseGlanceRider | null;
  if (!rider?.id) return null;
  return {
    ...rider,
    car_count: carCount ?? rider.car_count ?? car?.cars_on_rider_ar ?? null,
    master_lease: asOne(rider.master_lease),
  };
}

function fmtPct(n: number | string | null | undefined) {
  if (n == null || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `${v.toFixed(3)}%` : "—";
}

function fmtMoney(n: number | string | null | undefined) {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function LeaseGlanceSheet({
  rider,
  onClose,
}: {
  rider: LeaseGlanceRider | null;
  onClose: () => void;
}) {
  const lease = asOne(rider?.master_lease);
  const soldTo = String(lease?.sold_to ?? "").trim();
  const olLabel =
    String(rider?.schedule_number || rider?.rider_name || "").trim() || "OL";

  return (
    <Sheet open={!!rider} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col overflow-hidden p-0">
        <SheetHeader className="px-6 py-4 border-b border-border text-left space-y-1">
          <SheetTitle className="font-mono-num text-lg">
            {displayLeaseNumber(lease?.lease_number) || "Lease"}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2 flex-wrap">
            <LeaseTypeBadge mlaType={lease?.lease_type} />
            {soldTo ? (
              <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded border bg-umler-amber/15 text-umler-amber border-umler-amber/30">
                SOLD
              </span>
            ) : null}
            {lease?.agreement_number ? (
              <span className="text-xs text-muted-foreground">{lease.agreement_number}</span>
            ) : null}
          </SheetDescription>
        </SheetHeader>
        {rider ? (
          <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
            <div className="text-sm text-muted-foreground">
              {lease?.lessor ?? "—"} <span className="opacity-50">lessor</span>
              <span className="mx-2 opacity-30">·</span>
              {lease?.lessee ?? "—"} <span className="opacity-50">lessee</span>
              {soldTo ? <span className="ml-2 text-amber-400">→ {soldTo}</span> : null}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                Rider / OL
              </div>
              <div className="font-mono-num font-medium">{olLabel}</div>
              {rider.rider_name && rider.schedule_number && rider.rider_name !== rider.schedule_number ? (
                <div className="text-xs text-muted-foreground mt-0.5">{rider.rider_name}</div>
              ) : null}
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Effective</dt>
                  <dd className="font-mono-num mt-0.5">{formatCalendarDate(rider.effective_date) || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Expiration</dt>
                  <dd className="font-mono-num mt-0.5">{formatCalendarDate(rider.expiration_date) || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Rate</dt>
                  <dd className="font-mono-num mt-0.5">{fmtPct(rider.monthly_rate_pct)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Lessor's cost</dt>
                  <dd className="font-mono-num mt-0.5">{fmtMoney(rider.lessors_cost)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">Cars on OL</dt>
                  <dd className="font-mono-num mt-0.5">
                    {rider.car_count == null ? "—" : Number(rider.car_count).toLocaleString()}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        ) : null}
        <div className="shrink-0 px-6 py-4 border-t border-border">
          <Button
            className="w-full"
            disabled={!rider?.id}
            data-testid="button-view-full-lease"
            onClick={() => {
              if (!rider?.id) return;
              onClose();
              navigateHash(`/leases?rider=${rider.id}`);
            }}
          >
            View full lease
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
