import { logger } from "../../logger.js";

function trimItems(items, limit = 20) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.slice(0, limit);
}

export function emitBusinessEvent({
  eventType,
  status = "success",
  requestId = null,
  transactionId = null,
  idempotencyKey = null,
  actorUserId = null,
  actorRole = null,
  actorService = null,
  organizationId = null,
  storeId = null,
  registerName = null,
  subjectType = null,
  subjectId = null,
  financial = null,
  details = null
}) {
  logger.info(
    {
      event_type: eventType,
      status,
      request_id: requestId,
      transaction_id: transactionId,
      idempotency_key: idempotencyKey,
      actor: {
        staff_id: actorUserId,
        role: actorRole,
        service: actorService
      },
      store: {
        organization_id: organizationId,
        store_id: storeId,
        register_name: registerName
      },
      subject: {
        type: subjectType,
        id: subjectId
      },
      financial,
      details: details && details.items ? { ...details, items: trimItems(details.items) } : details
    },
    eventType
  );
}
