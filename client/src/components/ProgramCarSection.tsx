import { useLayoutEffect, useState, type ReactNode } from "react";
import { History, Paperclip } from "lucide-react";
import ShopCombobox, { type ShopOption } from "@/components/ShopCombobox";
import { OpsFlagBadge } from "@/components/OpsFlagBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { COMPLETION_LABEL, TRAIL_MILESTONES, type CompletionLevel } from "@shared/programs";
import { formatProgramDate } from "@shared/program-dates";
import {
  commitmentScopeLabel,
  programCarFieldsEditable,
  programCarKeepOpenEditable,
  programCarSectionCanSave,
  programCarSectionEdit,
  programCarSectionPatch,
  programCarSectionSavePatch,
  programCarSectionSwitchBlocked,
  programCarSectionVersion,
  type ProgramCarSectionEdit,
  type ProgramCarSectionSource,
} from "@shared/program-car-section";

export type ProgramCarSectionCar = ProgramCarSectionSource & {
  id: number;
  railcar_id: number;
  doc_count?: number;
  completion_level?: CompletionLevel | null;
  kpi?: { derived_status?: string | null } | null;
  open_commitment?: { name?: string | null; type?: string | null } | null;
  shop?: { name?: string | null } | null;
  in_multiple_programs?: boolean;
  railcar?: ProgramCarSectionSource["railcar"] & {
    reporting_marks?: string | null;
    car_number?: string | null;
  } | null;
};

export type ProgramCarTrailRow = {
  id: number;
  milestone: string;
  milestone_date: string;
  note?: string | null;
};

/** Optional context passed into the railcar sheet when it was opened from a program. */
export type ProgramCarSheetContext = {
  programId: number;
  /** Last saved program-car row. The patch diffs against this. */
  saved: ProgramCarSectionCar;
  /** Visible row, including unsaved grid drafts. Seeds the form. */
  car: ProgramCarSectionCar;
  canEdit: boolean;
  statusOptions: string[];
  shops: ShopOption[];
  trail: ProgramCarTrailRow[];
  onSave: (updates: Record<string, unknown>) => void | Promise<void>;
  onOpenHistory: () => void;
  onOpenFiles: () => void;
  saving?: boolean;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

function StatusEditor({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  if (disabled) return <span>{value || "—"}</span>;
  if (custom) {
    return (
      <input
        autoFocus
        aria-label="Status"
        className="h-8 w-full bg-transparent border border-border rounded px-2 text-sm"
        value={value}
        placeholder="Custom status"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setCustom(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") setCustom(false);
        }}
      />
    );
  }
  const inList = !value || options.some((option) => option.toLowerCase() === value.toLowerCase());
  return (
    <select
      aria-label="Status"
      className="h-8 w-full bg-transparent border border-border rounded px-1 text-sm [color-scheme:dark]"
      value={value}
      onChange={(e) => {
        if (e.target.value === "__custom__") {
          setCustom(true);
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">—</option>
      {!inList && value ? <option value={value}>{value}</option> : null}
      {options.map((option) => (
        <option key={option} value={option}>{option}</option>
      ))}
      <option value="__custom__">Custom…</option>
    </select>
  );
}

function ProgramCarSectionForm({ context }: { context: ProgramCarSheetContext }) {
  const { car, saved } = context;
  const [edit, setEdit] = useState<ProgramCarSectionEdit>(() => programCarSectionEdit(car));
  const [savingLocal, setSavingLocal] = useState(false);
  const exited = Boolean(saved.exited_date ?? car.exited_date);
  const gate = {
    canEdit: context.canEdit,
    exited,
    active: saved.railcar?.active,
    railcarStatus: saved.railcar?.status,
    customFields: saved.custom_fields,
  };
  const fieldsEditable = programCarFieldsEditable(gate);
  const keepOpenEditable = programCarKeepOpenEditable(gate);
  const canSave = programCarSectionCanSave(gate);
  const patch = programCarSectionSavePatch(saved, edit, gate);
  const panelDirty = programCarSectionPatch(car, edit) != null;
  const busy = Boolean(context.saving) || savingLocal;
  useLayoutEffect(() => {
    rememberProgramCarSectionEdit(car.id, panelDirty);
    return () => forgetProgramCarSectionEdit(car.id);
  }, [car.id, panelDirty]);
  const milestoneOptions = Array.from(new Set<string>([...TRAIL_MILESTONES, edit.milestone].filter(Boolean)));
  const level = car.completion_level ?? saved.completion_level ?? null;
  const commitment = car.open_commitment ?? saved.open_commitment;
  const commitmentLabel = commitment?.name
    ? `${commitment.type ? `${commitment.type} · ` : ""}${commitment.name}`
    : "—";

  function set<K extends keyof ProgramCarSectionEdit>(key: K, value: ProgramCarSectionEdit[K]) {
    setEdit((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!patch || busy) return;
    setSavingLocal(true);
    try {
      await context.onSave(patch);
    } finally {
      setSavingLocal(false);
    }
  }

  return (
    <section
      data-testid="program-car-section"
      className="rounded-md border border-border bg-muted/20 px-3 py-3 space-y-3 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">This program</h3>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={context.onOpenHistory} data-testid="button-program-car-history">
            <History className="h-3.5 w-3.5" /> History
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={context.onOpenFiles} data-testid="button-program-car-files">
            <Paperclip className="h-3.5 w-3.5" /> Files
            {(car.doc_count ?? 0) > 0 ? <span className="text-[10px]">{car.doc_count}</span> : null}
          </Button>
        </div>
      </div>
      {exited ? (
        <p className="text-xs text-muted-foreground">Exited {formatProgramDate(saved.exited_date ?? car.exited_date)}</p>
      ) : null}

      <Field label="Status">
        <StatusEditor
          value={edit.status}
          options={context.statusOptions}
          disabled={!fieldsEditable}
          onChange={(value) => set("status", value)}
        />
      </Field>

      <Field label="Milestone">
        {fieldsEditable ? (
          <div className="flex gap-2">
            <select
              aria-label="Milestone"
              className="h-8 min-w-0 flex-1 bg-transparent border border-border rounded px-1 text-sm [color-scheme:dark]"
              value={edit.milestone}
              onChange={(e) => set("milestone", e.target.value)}
            >
              <option value="">—</option>
              {milestoneOptions.map((milestone) => (
                <option key={milestone} value={milestone}>{milestone}</option>
              ))}
            </select>
            <input
              aria-label="Milestone date"
              className="h-8 w-32 bg-transparent border border-border rounded px-2 text-sm"
              value={edit.milestoneAt}
              placeholder="MM/DD/YYYY"
              onChange={(e) => set("milestoneAt", e.target.value)}
            />
          </div>
        ) : (
          <div>
            {edit.milestone || "—"}
            {edit.milestoneAt ? ` · ${formatProgramDate(edit.milestoneAt) || edit.milestoneAt}` : ""}
          </div>
        )}
      </Field>

      <Field label="Trail">
        {context.trail.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No trail rows yet. Saving a milestone keeps each date.</p>
        ) : (
          <ol className="space-y-1.5">
            {context.trail.map((row) => (
              <li key={row.id} className="text-xs border-l-2 border-primary/40 pl-2">
                <span className="font-medium">{row.milestone}</span>
                <span className="text-muted-foreground"> · {formatProgramDate(row.milestone_date)}</span>
                {row.note ? <div>{row.note}</div> : null}
              </li>
            ))}
          </ol>
        )}
      </Field>

      <Field label="Shop / yard">
        {fieldsEditable ? (
          <ShopCombobox
            shops={context.shops}
            value={edit.shopId}
            programId={context.programId}
            onChange={(shopId) => set("shopId", shopId)}
          />
        ) : (
          <span>{car.shop?.name ?? saved.shop?.name ?? "—"}</span>
        )}
      </Field>

      <Field label="Notes">
        {fieldsEditable ? (
          <Textarea
            aria-label="Notes"
            className="min-h-16 text-sm"
            value={edit.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        ) : (
          <div className="whitespace-pre-wrap text-xs">{edit.notes || "—"}</div>
        )}
      </Field>

      {/* The grid's comment column writes program_cars.notes, same as Notes. */}
      <Field label="Comment">
        {fieldsEditable ? (
          <Textarea
            aria-label="Comment"
            className="min-h-16 text-sm"
            value={edit.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        ) : (
          <div className="whitespace-pre-wrap text-xs">{edit.notes || "—"}</div>
        )}
      </Field>

      <Field label="Scrap flag">
        {car.railcar?.ops_flag ? <OpsFlagBadge flag={car.railcar.ops_flag} /> : <span>—</span>}
      </Field>

      <Field label="Scrapped date">
        <span>{formatProgramDate(car.railcar?.scrapped_at) || "—"}</span>
      </Field>

      <Field label="Outcome">
        <label className="inline-flex items-center gap-2 text-xs">
          <Checkbox
            checked={edit.outcomeReached}
            disabled={!fieldsEditable}
            onCheckedChange={(value) => set("outcomeReached", value === true)}
            aria-label="Outcome"
          />
          Reached
        </label>
      </Field>

      <Field label="Completion">
        <span>{level ? COMPLETION_LABEL[level] : "—"}</span>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Active">
          <span>{car.railcar?.active === true ? "Yes" : "No"}</span>
        </Field>
        <Field label="Keep open">
          <Checkbox
            checked={edit.keepOpen}
            disabled={!keepOpenEditable}
            onCheckedChange={(value) => set("keepOpen", value === true)}
            aria-label="Keep open"
          />
        </Field>
      </div>

      <Field label="KPI bucket">
        <span>{car.kpi?.derived_status || saved.kpi?.derived_status || "—"}</span>
      </Field>

      <Field label={commitmentScopeLabel("program")}>
        <div className="text-xs">
          {commitmentLabel}
          {car.in_multiple_programs ? <div className="text-[10px] text-umler-amber">In 2 programs</div> : null}
        </div>
      </Field>

      {canSave ? (
        <Button
          type="button"
          size="sm"
          disabled={!patch || busy}
          onClick={() => { void save(); }}
          data-testid="button-save-program-car-section"
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      ) : null}
    </section>
  );
}

type SectionEditGuard = { carId: number; dirty: boolean };

let sectionEditGuard: SectionEditGuard | null = null;

function rememberProgramCarSectionEdit(carId: number, dirty: boolean) {
  sectionEditGuard = { carId, dirty };
}

function forgetProgramCarSectionEdit(carId: number) {
  if (sectionEditGuard?.carId === carId) sectionEditGuard = null;
}

export function programCarSectionHasUnsavedEdits(): boolean {
  return sectionEditGuard?.dirty === true;
}

/** Ask before the keyed form remounts onto another car or unmounts on close. */
export function programCarSectionDiscardConfirmed(nextCarId: number | null): boolean {
  const current = sectionEditGuard;
  if (!current || !programCarSectionSwitchBlocked(current.carId, current.dirty, nextCarId)) return true;
  const message = nextCarId == null
    ? "This car has unsaved edits. Discard them?"
    : "This car has unsaved edits. Discard them and switch cars?";
  return window.confirm(message);
}

export function ProgramCarSection({ context }: { context: ProgramCarSheetContext }) {
  const version = programCarSectionVersion(context.saved);
  return <ProgramCarSectionForm key={`${context.car.id}:${version}`} context={context} />;
}
