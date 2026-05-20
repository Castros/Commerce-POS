import { notFound } from "./http/errors.js";

export async function getOrganizationSettings(client, organizationId) {
  const result = await client.query(
    `
      SELECT id, currency, tax_enabled AS "taxEnabled", tax_rate_bps AS "taxRateBps"
      FROM commerce_organizations
      WHERE id = $1
        AND active = TRUE
      LIMIT 1
    `,
    [organizationId]
  );

  const organization = result.rows[0];
  if (!organization) {
    throw notFound("Organization not found");
  }

  return organization;
}

export function calculateTaxCents({ taxableSubtotalCents, taxRateBps, taxEnabled }) {
  if (!taxEnabled || !taxRateBps || taxableSubtotalCents <= 0) {
    return 0;
  }

  return Math.round((taxableSubtotalCents * taxRateBps) / 10000);
}
