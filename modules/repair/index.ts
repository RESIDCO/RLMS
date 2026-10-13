export { registerRepairPublicRoutes, registerRepairAuthedRoutes } from "./routes";
export type { RepairRouteDeps } from "./routes";
export { assertCarInVcf, getCarsRef, listVcfRowsForCar } from "./integration/rlms";
export { requireVcfCar } from "./services/vcf";
export {
  listStatuses,
  listTransitions,
  assertTransitionAllowed,
  getStatusByCode,
} from "./services/status-machine";
export { createBadOrder, getEvent } from "./services/bo";
export {
  issueEventLink,
  revokeEventLink,
  reissueEventLink,
  resolveActiveLink,
} from "./services/event-links";
export { shopAccept, shopReject, shopOnHand } from "./services/shop-actions";
export {
  uploadEstimate,
  listRevisions,
  submitForApproval,
  requestRevision,
  approveEstimate,
} from "./services/estimates";
export { parseAarFile, serializeLine, roundTripOk } from "./services/aar-parser";
export { listResponsibilityCodes, lookupRepairCategory } from "./services/categories";
export {
  sendLesseeApprovalRequest,
  approveViaLesseeLink,
  confirmLesseeReply,
} from "./services/lessee-approval";
export { getEmailProvider, setEmailProvider, LogEmailProvider } from "./providers/email";
export {
  getStorageProvider,
  setStorageProvider,
  LocalDiskStorageProvider,
} from "./providers/storage";
export {
  getInboundEmailProvider,
  setInboundEmailProvider,
  DevInboundEmailProvider,
} from "./providers/inbound-email";
export { DEFAULT_TENANT_ID, getRepairPool } from "./db";
