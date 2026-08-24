import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import ClearableSearchInput from "@/components/ClearableSearchInput";
import ActivityTimeline from "@/components/ActivityTimeline";
import { hashSearchParams } from "@/lib/hash-location";

export default function HistoryPage() {
  const [search, setSearch] = useState(() => hashSearchParams().get("q") ?? "");

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PageHeader
        title="History"
        subtitle="Lineage of railcars and leases — mark changes, assignments, notes, status, and rent events"
      />

      <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-8 py-4 sm:py-6 gap-4 overflow-auto">
        <ClearableSearchInput
          placeholder="Search current or prior mark+number, or OL / rider…"
          value={search}
          onChange={setSearch}
          testId="input-search-history"
        />
        <ActivityTimeline q={search.trim() || undefined} showSearchHint />
      </div>
    </div>
  );
}
