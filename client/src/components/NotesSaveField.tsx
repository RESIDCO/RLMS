import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export default function NotesSaveField({
  value,
  onSave,
  disabled,
}: {
  value: string | null | undefined;
  onSave: (v: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = text !== (value ?? "");

  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  async function save() {
    setSaving(true);
    try {
      await onSave(text);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        className="text-sm min-h-[88px]"
        placeholder="Free-text notes…"
      />
      {!disabled && (
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save notes"}
        </Button>
      )}
    </div>
  );
}
