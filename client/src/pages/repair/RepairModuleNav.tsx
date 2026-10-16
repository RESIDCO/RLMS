/**
 * Sticky repairSMART-style module nav for every owner /#/repair* page.
 * Unbuilt targets route to coming-soon placeholders (not 404).
 * Admin = gear at right end; Assignments removed; light/dark toggle (per user).
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, Moon, Settings, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRepairTheme } from "./repairTheme";

type NavLink = { href: string; label: string; match?: (path: string) => boolean };
type NavItem =
  | { kind: "link"; href: string; label: string; match?: (path: string) => boolean }
  | { kind: "menu"; label: string; items: NavLink[]; match?: (path: string) => boolean };

const NAV: NavItem[] = [
  {
    kind: "link",
    href: "/repair/bad-orders",
    label: "Bad Orders",
    match: (p) => p.startsWith("/repair/bad-orders"),
  },
  {
    kind: "link",
    href: "/repair/shops",
    label: "Shops",
    match: (p) => p.startsWith("/repair/shops"),
  },
  {
    kind: "menu",
    label: "Estimates",
    match: (p) =>
      p === "/repair" ||
      p.startsWith("/repair?") ||
      p.startsWith("/repair/estimates"),
    items: [
      {
        href: "/repair",
        label: "History",
        match: (p) => p === "/repair" || p.startsWith("/repair?"),
      },
      {
        href: "/repair/estimates/brc",
        label: "BRC",
        match: (p) => p.startsWith("/repair/estimates/brc"),
      },
    ],
  },
  {
    kind: "link",
    href: "/repair/outbound-dispos",
    label: "Outbound Dispos",
    match: (p) => p.startsWith("/repair/outbound-dispos"),
  },
  {
    kind: "link",
    href: "/repair/invoices",
    label: "Invoices",
    match: (p) => p.startsWith("/repair/invoices"),
  },
  {
    kind: "link",
    href: "/repair/payments",
    label: "Payments",
    match: (p) => p.startsWith("/repair/payments"),
  },
  {
    kind: "link",
    href: "/repair/months",
    label: "Months",
    match: (p) => p.startsWith("/repair/months"),
  },
  {
    kind: "menu",
    label: "Reference",
    match: (p) =>
      p.startsWith("/repair/bo-reasons") ||
      p.startsWith("/repair/billing-roads"),
    items: [
      { href: "/repair/bo-reasons", label: "BO reasons" },
      { href: "/repair/billing-roads", label: "Billing roads" },
    ],
  },
  {
    kind: "link",
    href: "/repair/help",
    label: "Help",
    match: (p) => p.startsWith("/repair/help"),
  },
];

function pathOf(location: string): string {
  const q = location.indexOf("?");
  return q >= 0 ? location.slice(0, q) : location;
}

function itemActive(item: NavItem, path: string): boolean {
  if (item.match) return item.match(path);
  if (item.kind === "link") {
    return path === item.href || path.startsWith(item.href + "/");
  }
  return item.items.some(
    (sub) =>
      (sub.match?.(path) ?? false) ||
      path === sub.href ||
      path.startsWith(sub.href + "/"),
  );
}

function Dropdown({
  label,
  items,
  active,
  path,
}: {
  label: string;
  items: NavLink[];
  active: boolean;
  path: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 px-3 py-2 text-sm whitespace-nowrap transition-colors",
          active
            ? "bg-[#1e3a5f] text-white font-semibold"
            : "text-white/95 hover:bg-white/10",
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 opacity-90" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-[60] min-w-[180px] border border-slate-300 bg-white py-1 shadow-lg"
        >
          {items.map((sub) => {
            const subActive =
              sub.match?.(path) ||
              path === sub.href ||
              path.startsWith(sub.href + "/");
            return (
              <Link
                key={sub.href}
                href={sub.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  "block px-3 py-2 text-sm text-slate-900 hover:bg-sky-50",
                  subActive && "bg-sky-100 font-semibold",
                )}
              >
                {sub.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function RepairModuleNav() {
  const [location] = useLocation();
  const path = pathOf(location);
  const { theme, toggleTheme } = useRepairTheme();
  const adminActive =
    path.startsWith("/repair/admin") || path.startsWith("/repair/reference-data");
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!gearRef.current?.contains(e.target as Node)) setGearOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <nav
      aria-label="Repair module"
      className="sticky top-0 z-50 flex flex-wrap items-stretch bg-[#243b55] text-white border-b border-[#1a2b3f] shadow-sm"
      data-testid="repair-module-nav"
    >
      <div className="flex flex-wrap items-stretch flex-1 min-w-0">
        {NAV.map((item) => {
          const active = itemActive(item, path);
          if (item.kind === "menu") {
            return (
              <Dropdown
                key={item.label}
                label={item.label}
                items={item.items}
                active={active}
                path={path}
              />
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "inline-flex items-center px-3 py-2 text-sm whitespace-nowrap transition-colors",
                active
                  ? "bg-[#1e3a5f] text-white font-semibold"
                  : "text-white/95 hover:bg-white/10",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="flex items-stretch ml-auto border-l border-white/10">
        <button
          type="button"
          className="inline-flex items-center justify-center px-3 py-2 text-white/95 hover:bg-white/10 transition-colors"
          aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          title={theme === "light" ? "Dark mode" : "Light mode"}
          onClick={toggleTheme}
          data-testid="repair-theme-toggle"
        >
          {theme === "light" ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </button>
        <div className="relative" ref={gearRef}>
          <button
            type="button"
            aria-label="Admin menu"
            aria-expanded={gearOpen}
            title="Admin"
            className={cn(
              "inline-flex items-center justify-center px-3 py-2 transition-colors",
              adminActive || gearOpen
                ? "bg-[#1e3a5f] text-white"
                : "text-white/95 hover:bg-white/10",
            )}
            data-testid="repair-admin-gear"
            onClick={() => setGearOpen((o) => !o)}
          >
            <Settings className="h-4 w-4" />
          </button>
          {gearOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full mt-0 min-w-[12rem] bg-white text-slate-900 shadow-lg border border-slate-200 z-50"
            >
              <Link
                href="/repair/admin"
                role="menuitem"
                onClick={() => setGearOpen(false)}
                className={cn(
                  "block px-3 py-2 text-sm hover:bg-sky-50",
                  path.startsWith("/repair/admin") && "bg-sky-100 font-semibold",
                )}
              >
                Shop catalogs
              </Link>
              <Link
                href="/repair/reference-data"
                role="menuitem"
                onClick={() => setGearOpen(false)}
                className={cn(
                  "block px-3 py-2 text-sm hover:bg-sky-50",
                  path.startsWith("/repair/reference-data") &&
                    "bg-sky-100 font-semibold",
                )}
                data-testid="repair-reference-data"
              >
                Reference Data
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
