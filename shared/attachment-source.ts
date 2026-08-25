export const ATTACHMENT_SOURCE_MODULES = [
  "manual",
  "account_transitions",
  "lease_management",
  "programs",
] as const;

export type AttachmentSourceModule = (typeof ATTACHMENT_SOURCE_MODULES)[number];

export const ATTACHMENT_SOURCE_LABEL: Record<AttachmentSourceModule, string> = {
  manual: "Manual",
  account_transitions: "Account Transitions",
  lease_management: "Lease Management",
  programs: "Programs",
};

export function attachmentSourceLabel(raw: string | null | undefined): string {
  const v = String(raw ?? "manual");
  return ATTACHMENT_SOURCE_LABEL[v as AttachmentSourceModule] ?? ATTACHMENT_SOURCE_LABEL.manual;
}

export function formatAttachmentProvenance(
  source: string | null | undefined,
  uploadedAt: string | null | undefined,
): string {
  const when = uploadedAt
    ? new Date(uploadedAt).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })
    : "—";
  return `${attachmentSourceLabel(source)} · ${when}`;
}

/**
 * Provenance for the generic /api/attachments uploader.
 * Client-supplied source_module is ignored — stamp from which entity path was used.
 */
export function stampGenericAttachmentSource(entityType: string): AttachmentSourceModule {
  if (entityType === "master_lease" || entityType === "rider") return "lease_management";
  return "manual";
}

export const ACCOUNT_TRANSITIONS_SOURCE: AttachmentSourceModule = "account_transitions";
