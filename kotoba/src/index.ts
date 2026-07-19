/**
 * resource-provider kotoba — barrel. kotoba-E2E split (ADR-2605181100):
 * public marketplace catalog + aggregate stats plaintext; provider PII,
 * contribution content, reward ledger + balances sealed E2E. The regulated
 * EXECUTION (GPU/LLM inference, quality-validation compute, raw-credential
 * custody, fiat MoR / payout settlement rail) stays etzhayyim via consent-capability.
 */
export * from "./types.js";
export {
  registerListing,
  getListing,
  listListings,
  recordStat,
  listStats,
  upsertProfile,
  getProfile,
  listProfiles,
  submitContribution,
  getContribution,
  listContributions,
  postLedger,
  getLedger,
  listLedger,
  setBalance,
  getBalance,
  coverage,
} from "./registry.js";
