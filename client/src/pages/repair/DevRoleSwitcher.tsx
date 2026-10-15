/**
 * §G r2 — DEV-ONLY role switcher (REPAIR_DEV_BYPASS / local review).
 * Never shown when VITE_REPAIR_LOCAL_REVIEW is unset/false in production builds.
 * Sets localStorage + custom event so fetch headers use the real role on API.
 */
import { useEffect, useState } from "react";

export type DevRepairRole =
  | "owner"
  | "managing_partner"
  | "shop"
  | "lessee";

const STORAGE_ROLE = "repairDevRole";
const STORAGE_MARK = "repairShopMark";

export function readDevRole(): DevRepairRole {
  try {
    const v = localStorage.getItem(STORAGE_ROLE);
    if (
      v === "owner" ||
      v === "managing_partner" ||
      v === "shop" ||
      v === "lessee"
    ) {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "shop";
}

export function isDevBypassUi(): boolean {
  try {
    return (
      import.meta.env.VITE_REPAIR_LOCAL_REVIEW === "1" ||
      import.meta.env.DEV === true
    );
  } catch {
    return false;
  }
}

/** Headers for repair API calls — respects DEV role switcher. */
export function repairDevHeaders(extra?: HeadersInit): HeadersInit {
  const role = readDevRole();
  const mark = localStorage.getItem(STORAGE_MARK) || "";
  return {
    "x-repair-role": role,
    "x-repair-shop-mark": mark,
    "x-repair-actor": `dev-${role}`,
    ...(extra ?? {}),
  };
}

export default function DevRoleSwitcher({
  shopMark,
}: {
  shopMark?: string;
}) {
  const [role, setRole] = useState<DevRepairRole>(() => readDevRole());
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(isDevBypassUi());
  }, []);

  if (!visible) return null;

  function apply(next: DevRepairRole) {
    setRole(next);
    try {
      localStorage.setItem(STORAGE_ROLE, next);
      if (shopMark) localStorage.setItem(STORAGE_MARK, shopMark);
      window.dispatchEvent(new CustomEvent("repair-dev-role", { detail: next }));
    } catch {
      /* ignore */
    }
  }

  const mark = shopMark || localStorage.getItem(STORAGE_MARK) || "????";

  return (
    <div
      className="border-b border-amber-700 bg-amber-100 px-4 py-2 text-sm text-slate-900"
      data-testid="dev-role-banner"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <span className="font-semibold tracking-wide">
          DEV ROLE: {role === "shop" ? `Shop ${mark}` : role.replace("_", " ")}
        </span>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["owner", "Owner"],
              ["managing_partner", "Managing Partner"],
              ["shop", `Shop ${mark}`],
              ["lessee", "Lessee"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => apply(value)}
              className={
                role === value
                  ? "rounded border border-slate-900 bg-slate-900 px-2 py-1 text-xs font-medium text-white"
                  : "rounded border border-slate-400 bg-white px-2 py-1 text-xs font-medium text-slate-900 hover:border-slate-700"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
