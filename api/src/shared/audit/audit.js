export async function insertAuditEvent(client, {
  organizationId,
  storeId = null,
  actorUserId = null,
  actorService = null,
  action,
  targetType,
  targetId = null,
  summary = null,
  metadata = null,
  requestId,
  idempotencyKey = null,
  ipAddress = null,
  userAgent = null
}) {
  await client.query(
    `
      INSERT INTO commerce_audit_events (
        organization_id,
        store_id,
        actor_user_id,
        actor_service,
        action,
        target_type,
        target_id,
        summary,
        metadata,
        request_id,
        idempotency_key,
        ip_address,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      organizationId,
      storeId,
      actorUserId,
      actorService,
      action,
      targetType,
      targetId,
      summary,
      metadata,
      requestId,
      idempotencyKey,
      ipAddress,
      userAgent
    ]
  );
}

