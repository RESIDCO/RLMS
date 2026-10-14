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
  ingestLesseeReply,
  getLesseeViewForToken,
} from "./services/lessee-approval";
export { resolveLesseeAttachments, listShopOriginalDocuments } from "./services/lessee-attachments";
export { enterPodErd, listPodDates, runPodReminders } from "./services/pod";
export { setCompletedDate, rollbackCompletedDate } from "./services/completion";
export { submitShopInvoice, listInvoicesForEvent } from "./services/invoices";
export { relayDispo, listDispo } from "./services/dispo";
export {
  listContacts,
  upsertContact,
  addAdhocEmails,
  listNotificationRules,
} from "./services/contacts";
export {
  isOtpRequired,
  issueStepOtp,
  setOtpStepFlag,
  setShopOtpStepFlag,
  getShopOtpSteps,
} from "./services/otp";
export { maybeMarkReadyToClose, closeEvent } from "./services/close";
export {
  runMonthlyClose,
  collectRebillEvents,
  collectLesseeRebillEvents,
  listCloseRuns,
  ensureBillingPeriod,
} from "./services/monthly-close";
export { buildCripFile } from "./services/crb-writer";
export { validateCripBytes, validateCripRecords } from "./services/crb-validate";
export {
  listBilledPartyMappings,
  upsertBilledPartyMapping,
  resolveBilledParty,
  getCarOwnerMark,
  resolveInboundShopMarks,
  partyRoleForRespCode,
} from "./services/billed-party-map";
export { notify, resolveRecipients } from "./services/notifications";
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
