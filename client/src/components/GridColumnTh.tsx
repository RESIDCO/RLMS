import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GRID_COL_MIN } from "@/lib/grid-columns";
import { ColumnHelp } from "@/components/ColumnHelp";

export function GridColumnTh({
  colKey,
  listKey,
  width,
  minWidth = GRID_COL_MIN,
  pinned,
  stickyLeft,
  className,
  children,
  onResize,
  onMove,
  onSort,
  sortDir,
  accessory,
}: {
  colKey: string;
  listKey?: string;
  width?: number;
  minWidth?: number;
  pinned?: boolean;
  stickyLeft?: number;
  className?: string;
  children: ReactNode;
  onResize?: (key: string, width: number) => void;
  onMove?: (fromKey: string, toKey: string) => void;
  onSort?: (key: string) => void;
  sortDir?: "asc" | "desc" | null;
  /** Extra control rendered beside the label. Omitted columns stay unchanged. */
  accessory?: ReactNode;
}) {
  const startX = useRef(0);
  const startW = useRef(width ?? minWidth);

  function startResize(e: React.MouseEvent) {
    if (!onResize) return;
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    startW.current = width ?? minWidth;
    const onMoveMove = (ev: MouseEvent) => {
      const next = Math.max(minWidth, startW.current + (ev.clientX - startX.current));
      onResize(colKey, next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMoveMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMoveMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <th
      draggable={!pinned && !!onMove}
      onDragStart={(e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest("[data-col-resize]")) {
          e.preventDefault();
          return;
        }
        if (pinned || !onMove) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/plain", colKey);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (pinned || !onMove) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        if (pinned || !onMove) return;
        e.preventDefault();
        const from = e.dataTransfer.getData("text/plain");
        if (from) onMove(from, colKey);
      }}
      style={{
        ...(width ? { width, minWidth: width, maxWidth: width } : {}),
        ...(stickyLeft != null ? { left: stickyLeft } : {}),
      }}
      className={cn(
        "relative whitespace-nowrap select-none",
        !pinned && onMove && "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1 min-w-0">
        {onSort ? (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onSort(colKey);
            }}
          >
            {children}
            {sortDir === "asc" ? " ↑" : sortDir === "desc" ? " ↓" : ""}
          </button>
        ) : (
          children
        )}
        {accessory}
        {listKey ? <ColumnHelp listKey={listKey} colKey={colKey} /> : null}
      </span>
      {onResize && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${colKey}`}
          data-col-resize=""
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-20 hover:bg-primary/50"
          onMouseDown={startResize}
          onClick={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      )}
    </th>
  );
}
