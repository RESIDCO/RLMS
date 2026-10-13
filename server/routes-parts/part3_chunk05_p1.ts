import type { Express } from "express";
import type { Server } from "http";
import {
  autoFleetStatusFromLegacyText, createContactOnRider, deleteCompanyContact,
  deriveActiveBool, deriveManagedCategory, getCompanyContact, insertRiderContactSchema,
  normalizeRow, normalizeStoredCarNumber, parseDateCell, parseIntCell, parseNumberCell,
  requireContactsDelete, requireContactsWrite, splitCarNumber,
  statusAlignedToActiveFlag, supabaseAdmin, updateCompanyContact
} from "../routes-deps";
import {
  errHandler
} from "../routes-lib";

export async function registerRoutesChunk05_p1(_httpServer: Server,
  app: Express,): Promise<void> {

  app.delete("/api/contacts/:id", async (req, res) => {
    try {
      const writerId = await requireContactsDelete(req, res);
      if (!writerId) return;
      const id = Number(req.params.id);
      const { data: legacy } = await supabaseAdmin.from("rider_contacts").select("id").eq("id", id).maybeSingle();
      if (legacy) {
        const { error } = await supabaseAdmin.from("rider_contacts").delete().eq("id", id);
        if (error) throw error;
        return res.json({ ok: true });
      }
      const existing = await getCompanyContact(id);
      if (!existing) return res.status(404).json({ message: "Contact not found" });
      await deleteCompanyContact(id);
      res.json({ ok: true });
    } catch (err) { errHandler(res, err); }
  });

  // ---------- Bulk Import ----------
  // Builds a normalized row from a workbook row using flexible header matching
  // (see shared/residco-import.ts). Used by both /preview and /commit so the
  // shape rendered to the operator matches what is written to the DB.
  function buildRailcarFromRow(row: any) {
    const n = normalizeRow(row);
    const get = (k: string): string => {
      const v = (n as any)[k];
      return v == null ? "" : String(v).trim();
    };
    // Workbook "Car Number" is the full identifier (e.g. "TFOX88031"). Split
    // into reporting_marks ("TFOX") and the numeric portion ("88031") so the
    // RLMS data model — which stores them separately and uniquely on
    // (reporting_marks, car_number) — stays intact. If the workbook also
    // provides explicit "Reporting Marks" / "Car Initial" columns, they win.
    const rawCarNum = get("car_number");
    const explicitMarks = get("reporting_marks") || null;
    const explicitInitial = get("car_initial") || null;
    const split = splitCarNumber(rawCarNum);
    const marks = explicitMarks ?? split.reporting_marks;
    const carInitial = explicitInitial ?? split.car_initial ?? marks;
    const rawNum = split.car_number || rawCarNum;
    const padded = normalizeStoredCarNumber(rawNum);
    const carNum = padded.ok ? padded.car_number : String(rawNum).toUpperCase();
    const carType = get("car_type") || null;
    const statusRaw = get("status");
    const status = statusRaw || "Active/In-Service";
    const fleetName = get("fleet_name") || get("lessee_name") || null;
    const riderName = get("rider_name") || null;
    const notes = get("notes") || null;

    const entityRaw = get("entity") || null;
    const description = get("general_description") || null;
    const mechDesig = get("mechanical_designation") || null;
    const buildYearRaw = get("build_year");
    const buildYear = buildYearRaw ? parseIntCell(buildYearRaw) : null;
    const capacityRaw = get("capacity_cf");
    const capacityCf = capacityRaw ? parseIntCell(capacityRaw) : null;
    const lining = get("lining") || null;
    const oecRaw = get("oec");
    const oec = oecRaw ? parseNumberCell(oecRaw) : null;
    const nbvRaw = get("nbv");
    const nbv = nbvRaw ? parseNumberCell(nbvRaw) : null;
    const oacRaw = get("oac");
    const oac = oacRaw ? parseNumberCell(oacRaw) : null;

    // Master-list extended fields
    const riderExternalId = get("rider_external_id") || null;
    const lesseeName = get("lessee_name") || null;
    const activeStatus = get("active_status") || null;
    const dataSource = get("data_source") || null;
    const assignmentLabel = get("assignment_label") || null;
    const leaseType = get("lease_type") || null;
    const leaseStartDate = parseDateCell((n as any).lease_start_date);
    const leaseEndDate = parseDateCell((n as any).lease_end_date);
    const leaseExpiry = parseDateCell((n as any).lease_expiry);
    const monthlyRentPerCar = parseNumberCell((n as any).monthly_rent_per_car);
    const monthlyDeprPerCar = parseNumberCell((n as any).monthly_depr_per_car);
    const totalBvRider = parseNumberCell((n as any).total_bv_rider);
    const carsOnRiderAr = parseIntCell((n as any).cars_on_rider_ar);
    const commodityFamily = get("commodity_family") || null;
    const commodity = get("commodity") || null;
    const dotCode = get("dot_code") || null;
    const commentEventNote = get("comment_event_note") || null;

    const managedCategory = deriveManagedCategory(entityRaw);
    const activeBool = activeStatus ? deriveActiveBool(activeStatus) : true;
    const alignedStatus = statusAlignedToActiveFlag(status, activeBool);

    return {
      car_number: carNum,
      reporting_marks: marks,
      car_initial: carInitial,
      // Full original workbook identifier — preserved for search/export so
      // operators can still query by "TFOX88031" even though the DB stores
      // marks and number separately.
      full_car_number: marks ? `${marks}${carNum}` : carNum,
      car_type: carType,
      status: alignedStatus,
      fleet_name: fleetName,
      rider_name: riderName,
      notes,
      entity: entityRaw,
      managed_category: managedCategory,
      description,
      general_description: description,
      mechanical_designation: mechDesig,
      build_year: buildYear,
      built_year: buildYear,
      capacity_cf: capacityCf,
      lining,
      oec, nbv, oac,
      rider_external_id: riderExternalId,
      lessee_name: lesseeName,
      active_status: activeBool ? "Active" : "Inactive",
      active: activeBool,
      data_source: dataSource,
      assignment_label: assignmentLabel,
      lease_type: leaseType,
      lease_start_date: leaseStartDate,
      lease_end_date: leaseEndDate,
      lease_expiry: leaseExpiry,
      monthly_rent_per_car: monthlyRentPerCar,
      monthly_depr_per_car: monthlyDeprPerCar,
      total_bv_rider: totalBvRider,
      cars_on_rider_ar: carsOnRiderAr,
      commodity_family: commodityFamily,
      commodity,
      dot_code: dotCode,
      dot_specification: dotCode, // mirror — keeps DV calculator path working
      comment_event_note: commentEventNote,
      fleet_status: autoFleetStatusFromLegacyText({
        active: activeBool,
        rider_external_id: riderExternalId,
        assignment_label: assignmentLabel,
        fleet_name: fleetName,
        managed_category: managedCategory,
      }),
      fleet_status_source: "auto",
      // Raw original headers preserved for debugging / round-trip
      _normalized: n,
    };
  }

}
