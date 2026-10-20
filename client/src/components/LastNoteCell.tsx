import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatLastNoteWhen, lastNoteForRow } from "@shared/lineage-notes";

export function LastNoteCell({
  row,
  className,
}: {
  row: {
    notes?: string | null;
    latest_note?: string | null;
    latest_note_at?: string | null;
  };
  className: string;
}) {
  const note = lastNoteForRow(row);
  if (!note) {
    return <td className={className}>—</td>;
  }
  const when = formatLastNoteWhen(note.at);
  const full = when ? `${when}\n${note.text}` : note.text;
  return (
    <td className={`${className} max-w-[220px]`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="block min-w-0 cursor-help" title={full}>
            <span className="block truncate">{note.text}</span>
            {when ? (
              <span className="block truncate text-[10px] text-muted-foreground">{when}</span>
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm whitespace-pre-wrap">{full}</TooltipContent>
      </Tooltip>
    </td>
  );
}
