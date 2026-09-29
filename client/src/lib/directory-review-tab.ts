export function isDirectoryLeaseReviewTab(params: URLSearchParams): boolean {
  const t = params.get("tab");
  return t === "leases" || t === "lease_gaps";
}
