import { Link, Redirect } from "wouter";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useHashSearch } from "@/lib/hash-location";
import { moveLegacyDestinationFromSources } from "@shared/move-legacy";

export default function MoveCars() {
  const hashSearch = useHashSearch();
  const locationSearch = typeof window !== "undefined" ? window.location.search : "";
  const dest = moveLegacyDestinationFromSources(hashSearch, locationSearch);
  switch (dest.kind) {
    case "redirect":
      return <Redirect to={dest.path} />;
    case "notice":
      return (
        <div className="h-full min-h-0 overflow-auto">
          <PageHeader
            title="Move Cars has moved"
            subtitle="Start a move from Railcars. Recent moves are the Moves filter on Lineage."
          />
          <div className="max-w-lg space-y-4 px-4 py-6 sm:px-8">
            <p className="text-sm text-muted-foreground">
              This page no longer moves cars. Pick the cars on Railcars and use Move.
            </p>
            <Button asChild>
              <Link href="/railcars" data-testid="move-retired-railcars">Open Railcars</Link>
            </Button>
          </div>
        </div>
      );
    default: {
      const unreachable: never = dest;
      return unreachable;
    }
  }
}
