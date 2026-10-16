/**
 * Shared Repair UI theme tokens (single source for AA contrast).
 * CSS variables live in client/src/index.css under .repair-owner-ui.
 * Owner repair is light-only — see RepairOwnerShell / repairTheme.
 */

/** Hex values for non-CSS consumers (e.g. Leaflet). Keep in sync with index.css. */
export const REPAIR_THEME_HEX = {
  bg: "#f3f4f6",
  surface: "#ffffff",
  text: "#0f172a",
  muted: "#334155",
  mutedOk: "#475569",
  border: "#94a3b8",
  borderStrong: "#64748b",
  inputBg: "#ffffff",
  inputText: "#0f172a",
  placeholder: "#475569",
  btnPrimaryBg: "#1e3a5f",
  btnPrimaryText: "#ffffff",
  btnSecondaryBg: "#e2e8f0",
  btnSecondaryText: "#0f172a",
  btnDisabledBg: "#e2e8f0",
  btnDisabledText: "#334155",
  checkboxBg: "#ffffff",
  checkboxBorder: "#64748b",
  checkboxAccent: "#1e3a5f",
  rowHighlight: "#fffbeb",
  badgeBg: "#fef3c7",
  badgeText: "#78350f",
  brand: "#8B1E1E",
  brandHover: "#6f1818",
  brandSoft: "#c43c3c",
  navBg: "#243b55",
  navBorder: "#1a2b3f",
  navActive: "#1e3a5f",
  panelMuted: "#e8eaed",
  rowAlt: "#e8f4fc",
  lesseeBg: "#f7f4ef",
  focusRing: "#334155",
} as const;

/**
 * Tailwind / className helpers bound to shared CSS classes (index.css).
 * Prefer these over raw slate-* / hex in repair pages.
 */
export const repairUi = {
  page: "repair-page",
  text: "repair-text",
  muted: "repair-muted",
  label: "repair-label",
  value: "repair-value",
  panel: "repair-panel repair-aa-panel",
  input: "repair-input",
  select: "repair-select",
  textarea: "repair-textarea",
  btnPrimary: "repair-btn-primary",
  btnSecondary: "repair-btn-secondary",
  checkbox: "repair-checkbox",
  rowHighlight: "repair-row-highlight",
  badge: "repair-badge",
  crumb: "repair-crumb",
  crumbCurrent: "repair-crumb-current",
  link: "repair-link",
  brandBar: "repair-brand-bar",
  nav: "repair-nav",
  navItem: "repair-nav-item",
  navItemActive: "repair-nav-item-active",
} as const;
