import { RiderDirectoryContacts } from "@/components/RiderDirectoryContacts";

export function OlDirectoryContacts({
  riderId,
  emptyHint = "No directory people linked to this OL yet.",
  onPersonClick,
}: {
  riderId: number | null | undefined;
  emptyHint?: string;
  onPersonClick?: () => void;
}) {
  if (!riderId || riderId <= 0) return null;
  return (
    <RiderDirectoryContacts
      riderId={riderId}
      variant="compact"
      emptyHint={emptyHint}
      onPersonClick={onPersonClick}
    />
  );
}
