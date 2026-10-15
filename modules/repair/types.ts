/** Shared types for the RLMS Repair Module (Phase 1 first slice). */

export type RepairRole =
  | "admin"
  | "car_owner"
  | "mech_manager"
  | "reviewer"
  | "fleet_manager";

export type StatusEntity = "EVENT" | "ESTIMATE";

export type CarsRefRow = {
  rlms_railcar_id: number;
  car_mark: string;
  car_number: string;
  active_flag: boolean;
  in_vcf: boolean;
  lease_rider: string | null;
  current_assignment: string | null;
  current_assignment_id: string | null;
  lessee_name: string | null;
  remarks: string | null;
  fleet_status: string | null;
  managed: string | null;
  managed_category: string | null;
  /** railcars.entity source value (Main / Coal / Rail Partners Select) */
  entity_source?: string | null;
};

export type VcfCheckResult =
  | { ok: true; car: CarsRefRow }
  | { ok: false; reason: string; carMark: string; carNumber: string };

export type StatusRow = {
  id: string;
  tenant_id: string;
  entity: StatusEntity;
  code: string;
  display_name: string;
  sort_order: number;
  is_terminal: boolean;
  is_locking: boolean;
  active: boolean;
};

export type StatusTransitionRow = {
  id: string;
  tenant_id: string;
  entity: StatusEntity;
  from_status_id: string;
  to_status_id: string;
  action_name: string;
  allowed_actors: string[];
  requires: string[];
  active: boolean;
};
