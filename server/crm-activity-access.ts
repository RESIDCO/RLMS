import { VIEWER_ACTIVITY_PATCH_KEYS } from "@shared/crm";

export type CrmActivityRole = "admin" | "editor" | "viewer";
export type CrmActivityAction = "create" | "patch" | "delete";

export type CrmActivityDecision =
  | { ok: true }
  | { ok: false; status: 403; message: string };

function deny(message: string): CrmActivityDecision {
  return { ok: false, status: 403, message };
}

/**
 * Viewers may create activities and edit body, due date, and done on their
 * own rows. Viewers can never delete. Editors and admins can create and patch
 * any row. Deleting activities is not available to any role.
 */
export function crmActivityPermission(input: {
  role: CrmActivityRole;
  action: CrmActivityAction;
  actorId?: string | null;
  rowActor?: string | null;
  patchKeys?: string[];
}): CrmActivityDecision {
  switch (input.action) {
    case "create":
      return { ok: true };
    case "delete":
      if (input.role === "viewer") return deny("Viewers cannot delete activities");
      return deny("Deleting activities is not available");
    case "patch": {
      if (input.role === "admin" || input.role === "editor") return { ok: true };
      const actorId = String(input.actorId ?? "");
      const rowActor = String(input.rowActor ?? "");
      if (!actorId || actorId !== rowActor) return deny("Viewers can edit only their own activities");
      const allowed = new Set<string>(VIEWER_ACTIVITY_PATCH_KEYS);
      for (const key of input.patchKeys ?? []) {
        if (!allowed.has(key)) return deny("Viewers can edit only body, due date, and done");
      }
      return { ok: true };
    }
    default: {
      const neverAction: never = input.action;
      return neverAction;
    }
  }
}
