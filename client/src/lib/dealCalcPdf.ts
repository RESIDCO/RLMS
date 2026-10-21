import { jsPDF } from "jspdf";
import { formatValueOrDash, type DealCalcResult } from "@shared/dealCalc";
import { LEGACY_BID_MODEL_LABEL } from "@shared/dealCalcApi";

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

/** One-page summary. Includes the value-at-purchase block. */
export function downloadDealCalcPdf(name: string, result: DealCalcResult): void {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const lines = [
    name || "Deal calculator",
    `Verdict: ${result.verdict}`,
    `Max bid / car: ${money(result.cash.maxBidPerCar)}`,
    `IRR: ${result.cash.irr == null ? "—" : `${(result.cash.irr * 100).toFixed(2)}%`}`,
    `${LEGACY_BID_MODEL_LABEL} bid / car: ${money(result.wayne?.bidPerCar ?? null)}`,
    "",
    "Value at purchase vs at lease expiry",
    `Basis: ${result.valuation.basisBadge ?? "—"}`,
    `Age at purchase: ${result.valuation.ageAtClose == null ? "—" : result.valuation.ageAtClose.toFixed(1)} years`,
    `Value at purchase: ${formatValueOrDash(result.valuation.valueAtClose)}`,
    `Age at lease expiry: ${result.valuation.ageAtExpiry == null ? "—" : result.valuation.ageAtExpiry.toFixed(1)} years`,
    `Value at lease expiry: ${formatValueOrDash(result.valuation.valueAtExpiry)}`,
    `Value change: ${formatValueOrDash(result.valuation.valueChange)}`,
    `Scrap floor: ${formatValueOrDash(result.valuation.scrapFloor)}`,
    `AAR limit year: ${result.valuation.aarLimitYear ?? "—"}`,
    `Years of life left: ${result.valuation.yearsLeftAtExpiry == null ? "—" : result.valuation.yearsLeftAtExpiry.toFixed(1)}`,
    `Portfolio value at purchase: ${formatValueOrDash(result.valuation.portfolio.valueAtPurchase)}`,
    `Portfolio value at expiry: ${formatValueOrDash(result.valuation.portfolio.valueAtExpiry)}`,
    `Total decline: ${formatValueOrDash(result.valuation.portfolio.totalDecline)}`,
    `Price / value at purchase: ${result.valuation.portfolio.priceToValue == null ? "—" : result.valuation.portfolio.priceToValue.toFixed(2)}`,
    "",
    "Before income tax.",
  ];
  let y = 48;
  doc.setFontSize(11);
  for (const line of lines) {
    doc.text(line, 48, y);
    y += 16;
  }
  const safe = name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "deal-calc";
  doc.save(`${safe}.pdf`);
}
