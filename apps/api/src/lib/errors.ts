/** SQL business-rule codes (raised as message = <code>, detail = <sentence>) → HTTP status. */
export const RULE_STATUS: Record<string, number> = {
  campaign_not_found: 404,
  perk_not_found: 404,
  backing_not_found: 404,
  tranche_not_found: 404,
  profile_not_found: 409,
  campaign_closed: 409,
  perk_sold_out: 409,
  too_many_open_checkouts: 409,
  invalid_quantity: 400,
  self_backing: 403,
  reviewer_is_owner: 403,
  refund_not_available: 409,
  evidence_not_accepted: 409,
  evidence_required: 409,
  campaign_not_funded: 409,
  earlier_tranche_pending: 409,
};
