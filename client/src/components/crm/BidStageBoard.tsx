import { Link } from "wouter";
import { BID_STAGE_OPTIONS, bidStageLabel, nextBidDeadline, type BidStageId } from "@shared/crm";

export type BidCard = {
  id: number;
  offering_name: string | null;
  account_name?: string | null;
  seller_name?: string | null;
  stage: string;
  outcome: string | null;
  bid_substage: string | null;
  cars_bid: number;
  cars_total: number;
  dollars: number | null;
  won_lines: number;
  line_count: number;
  bid_due_prelim: string | null;
  bid_due_final: string | null;
  award_date: string | null;
  expected_close: string | null;
};

const TONE_CLASS: Record<string, string> = {
  red: "bg-red-500/15 text-red-800",
  amber: "bg-amber-500/15 text-amber-900",
  neutral: "bg-muted text-foreground",
  past: "bg-muted text-muted-foreground",
};

function money(value: number | null): string {
  if (value == null) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function DeadlineChip({ card, today }: { card: BidCard; today: string }) {
  const next = nextBidDeadline([card.bid_due_prelim, card.bid_due_final, card.award_date, card.expected_close], today);
  if (!next) return null;
  const label = next.tone === "past" ? `Past ${next.date}` : next.date;
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] ${TONE_CLASS[next.tone]}`}>{label}</span>;
}

export default function BidStageBoard({ cards, canSeePrices, today }: { cards: BidCard[]; canSeePrices: boolean; today: string }) {
  const groups = BID_STAGE_OPTIONS.map((option) => ({
    option,
    rows: cards.filter((card) => (bidStageLabel(card.stage, card.outcome, card.bid_substage) === option.label)),
  }));
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {groups.map((group) => (
        <section key={group.option.id} className="min-w-[220px] w-[240px] shrink-0">
          <h2 className="text-xs font-semibold mb-2">{group.option.label} · {group.rows.length}</h2>
          <div className="space-y-2">
            {group.rows.map((card) => (
              <Link key={card.id} href={`/opportunities/${card.id}`} className="block border rounded-md p-2 hover:bg-muted/40">
                <div className="text-sm font-medium">{card.offering_name || card.seller_name || card.account_name || `Offering ${card.id}`}</div>
                <div className="text-xs text-muted-foreground mt-1">{card.seller_name || card.account_name || "Seller not set"}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono-num">{card.cars_bid.toLocaleString()} / {card.cars_total.toLocaleString()} cars</span>
                  {canSeePrices && card.dollars != null ? <span className="font-mono-num">{money(card.dollars)}</span> : null}
                  <DeadlineChip card={card} today={today} />
                </div>
                {card.won_lines > 0 ? <div className="text-[11px] text-muted-foreground mt-1">Won {card.won_lines} of {card.line_count} lines</div> : null}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function bidStageKey(stage: string, outcome: string | null, sub: string | null): BidStageId | null {
  const label = bidStageLabel(stage, outcome, sub);
  return BID_STAGE_OPTIONS.find((option) => option.label === label)?.id ?? null;
}
