import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GRID_COL_MIN } from "@/lib/grid-columns";

export function GridColumnTh({
  colKey,
  width,
  minWidth = GRID_COL_MIN,
  pinned,
  className,
  children,
  onResize,
  onMove,
}: {
  colKey: string;
  width?: number;
  minWidth?: number;
  pinned?: boolean;
  className?: string;
  children: ReactNode;
  onResize?: (key: string, width: number) => void;
  onMove?: (fromKey: string, toKey: string) => void;
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
      style={width ? { width, minWidth: width, maxWidth: width } : undefined}
      className={cn(
        "relative whitespace-nowrap select-none",
        !pinned && onMove && "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      {children}
      {onResize && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${colKey}`}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-20 hover:bg-primary/50"
          onMouseDown={startResize}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </th>
  );
}
