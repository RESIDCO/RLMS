import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const ADD_NOTE_PLACEHOLDER =
  "Added to the Activity timeline with a timestamp; earlier notes are kept";

export function AddNoteField({
  value,
  onChange,
  hidden,
  id = "add-note",
}: {
  value: string;
  onChange: (value: string) => void;
  hidden?: boolean;
  id?: string;
}) {
  if (hidden) return null;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        Add note <span className="text-muted-foreground font-normal">(optional)</span>
      </Label>
      <Textarea
        id={id}
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={ADD_NOTE_PLACEHOLDER}
      />
    </div>
  );
}

export function appendNoteBody(note: string): { append_note?: string } {
  const text = note.trim();
  return text ? { append_note: text } : {};
}

export function noteSkipDescription(body: unknown): string | undefined {
  const skipped = (body as { note_skipped?: unknown } | null)?.note_skipped;
  if (!Array.isArray(skipped) || skipped.length === 0) return undefined;
  return `Note skipped for ${skipped.length} inactive car${skipped.length === 1 ? "" : "s"}.`;
}
