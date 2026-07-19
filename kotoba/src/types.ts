/**
 * resource-provider kotoba — kotoba-E2E split for the decentralized resource
 * marketplace (users contribute data / GPU compute / location to earn rewards).
 *
 * Per ADR-2606011400 (Consensys product-front / infra-back) + ADR-2605172400
 * (3-axis Liability/Custody/Settlement) + ADR-2605181100 (kotoba E2E
 * encrypted-record envelope). Founder directive 2026-06-03: MAXIMAL migration —
 * front everything that can move; only the irreducible regulated EXECUTION stays
 * etzhayyim.
 *
 * SPLIT:
 *   PUBLIC (plaintext AT records) — marketplace catalog + aggregate stats with
 *   no per-person PII:
 *     resourceListing  — advertised resource offers (type/capacity/region). FK
 *                        target. Intentionally public marketplace metadata.
 *     contributionStat — aggregate contribution totals by resourceType, FK →
 *                        resourceListing via exists(). Read-view rollup.
 *   PII / PRIVATE-CONTENT / LEDGER (kotoba E2E, com.etzhayyim.encrypted.record) —
 *   sealed via sdk.encryptedWrite (read-cap = owner DID + explicit recipients):
 *     providerProfile    — per-person PII (precise geo, device/hardware
 *                          fingerprint, contact). Never plaintext on-substrate.
 *     contributionEntry  — per-contribution private content (provider DID, payload
 *                          ref, quality score). Per-person, confidential.
 *     rewardLedgerEntry  — reward ledger entry (provider DID, amount as decimal
 *                          STRING, status). Transaction-history DATA migrates E2E.
 *     rewardBalance      — per-provider running balance (decimal STRING), a
 *                          derived rollup of the E2E ledger.
 *
 *   STAYS etzhayyim (consumed via consent-capability, NOT a collection) — the
 *   irreducible regulated EXECUTION: GPU/LLM inference run, data quality-
 *   validation compute, raw-credential / secret custody, and the fiat
 *   merchant-of-record / payout settlement rail. We front the ledger + balances +
 *   tx-history as E2E records, but the fiat-rail settlement CALL stays etzhayyim
 *   (per Operating Entity Boundary: etzhayyim never becomes the fiat MoR /
 *   counterparty).
 *
 * AT-Lexicon: no float. Counts/capacity = integers; quality/percent = integer
 * 0-100; money = decimal STRINGS.
 */

// ─── Collection / inner-type NSIDs ──────────────────────────────────

// Plaintext public collections.
export const RESOURCE_LISTING_COLLECTION = "com.etzhayyim.apps.resourceProvider.resourceListing";
export const CONTRIBUTION_STAT_COLLECTION = "com.etzhayyim.apps.resourceProvider.contributionStat";

// E2E inner-type NSIDs (body shape inside the encrypted envelope).
export const PROVIDER_PROFILE_INNER_TYPE = "com.etzhayyim.apps.resourceProvider.providerProfile";
export const CONTRIBUTION_ENTRY_INNER_TYPE = "com.etzhayyim.apps.resourceProvider.contributionEntry";
export const REWARD_LEDGER_INNER_TYPE = "com.etzhayyim.apps.resourceProvider.rewardLedgerEntry";
export const REWARD_BALANCE_INNER_TYPE = "com.etzhayyim.apps.resourceProvider.rewardBalance";

export const RESOURCE_PROVIDER_DID_PREFIX = "did:web:resource-provider.etzhayyim.com:" as const;

export type ResourceType = "gpu" | "storage" | "data" | "location";

// ─── resourceListing (PLAINTEXT, public catalog) ────────────────────

export interface ResourceListingRecord {
  did: string;
  listingId: string;
  resourceType: ResourceType;
  region: string;
  /** Advertised capacity in resource-native integer units (TFLOPS / GiB / rows). */
  capacity: number;
  createdAt: string;
}
export interface ResourceListingView extends ResourceListingRecord {
  listingUri: string;
}
export interface RegisterListingInput {
  listingId: string;
  resourceType: ResourceType;
  region: string;
  capacity: number;
}
export interface RegisterListingOutput {
  status: "registered" | "alreadyExists" | "rejected";
  listingUri?: string;
  did?: string;
  listingId?: string;
  error?: string;
}
export interface GetListingInput {
  listingId: string;
}
export interface GetListingOutput {
  listing?: ResourceListingView;
  error?: string;
}
export interface ListListingsInput {
  resourceType?: ResourceType;
  region?: string;
  limit?: number;
  cursor?: string;
}
export interface ListListingsOutput {
  items: ResourceListingView[];
  cursor?: string;
  total: number;
}

// ─── contributionStat (PLAINTEXT, aggregate, FK → resourceListing) ──

export interface ContributionStatRecord {
  did: string;
  statId: string;
  listingId: string;
  resourceType: ResourceType;
  /** Aggregate contribution count (no per-person attribution). */
  contributionCount: number;
  /** Aggregate accepted units (resource-native integer). */
  acceptedUnits: number;
  generatedAt: string;
  createdAt: string;
}
export interface ContributionStatView extends ContributionStatRecord {
  statUri: string;
}
export interface RecordStatInput {
  statId: string;
  listingId: string;
  resourceType: ResourceType;
  contributionCount: number;
  acceptedUnits: number;
  generatedAt?: string;
}
export interface RecordStatOutput {
  status: "recorded" | "alreadyExists" | "rejected";
  statUri?: string;
  did?: string;
  statId?: string;
  error?: string;
}
export interface ListStatsInput {
  resourceType?: ResourceType;
  limit?: number;
  cursor?: string;
}
export interface ListStatsOutput {
  items: ContributionStatView[];
  cursor?: string;
  total: number;
}

// ─── providerProfile (E2E, PII) ─────────────────────────────────────

export interface ProviderProfileBody {
  profileId: string;
  providerDid: string;
  displayName: string;
  /** Precise geo as "lat,lng" string (PII). */
  geo: string;
  /** Device / hardware fingerprint (PII). */
  deviceFingerprint: string;
  contact: string;
  registeredAt: string;
}
export interface ProviderProfileView extends ProviderProfileBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface UpsertProfileInput {
  profileId: string;
  providerDid: string;
  displayName: string;
  geo: string;
  deviceFingerprint: string;
  contact: string;
  registeredAt?: string;
  recipients?: string[];
}
export interface UpsertProfileOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  profileId?: string;
  error?: string;
}
export interface GetProfileInput {
  profileId: string;
}
export interface GetProfileOutput {
  profile?: ProviderProfileView;
  error?: string;
}
export interface ListProfilesInput {
  providerDid?: string;
  limit?: number;
  cursor?: string;
}
export interface ListProfilesOutput {
  items: ProviderProfileView[];
  cursor?: string;
  total: number;
}

// ─── contributionEntry (E2E, private content) ───────────────────────

export interface ContributionEntryBody {
  entryId: string;
  providerDid: string;
  listingId: string;
  resourceType: ResourceType;
  /** Reference to the contributed payload (CID / opaque ref). */
  payloadRef: string;
  /** integer 0-100. */
  qualityScore: number;
  contributedAt: string;
}
export interface ContributionEntryView extends ContributionEntryBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface SubmitContributionInput {
  entryId: string;
  providerDid: string;
  listingId: string;
  resourceType: ResourceType;
  payloadRef: string;
  qualityScore: number;
  contributedAt?: string;
  recipients?: string[];
}
export interface SubmitContributionOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  entryId?: string;
  error?: string;
}
export interface GetContributionInput {
  entryId: string;
}
export interface GetContributionOutput {
  entry?: ContributionEntryView;
  error?: string;
}
export interface ListContributionsInput {
  providerDid?: string;
  resourceType?: ResourceType;
  limit?: number;
  cursor?: string;
}
export interface ListContributionsOutput {
  items: ContributionEntryView[];
  cursor?: string;
  total: number;
}

// ─── rewardLedgerEntry (E2E, ledger / tx-history) ───────────────────

export type LedgerStatus = "pending" | "settled" | "reversed";

export interface RewardLedgerBody {
  ledgerId: string;
  providerDid: string;
  entryId: string;
  /** Reward amount, decimal STRING (no float). */
  amount: string;
  currency: string;
  status: LedgerStatus;
  postedAt: string;
}
export interface RewardLedgerView extends RewardLedgerBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface PostLedgerInput {
  ledgerId: string;
  providerDid: string;
  entryId: string;
  amount: string;
  currency: string;
  status?: LedgerStatus;
  postedAt?: string;
  recipients?: string[];
}
export interface PostLedgerOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  ledgerId?: string;
  error?: string;
}
export interface GetLedgerInput {
  ledgerId: string;
}
export interface GetLedgerOutput {
  entry?: RewardLedgerView;
  error?: string;
}
export interface ListLedgerInput {
  providerDid?: string;
  status?: LedgerStatus;
  limit?: number;
  cursor?: string;
}
export interface ListLedgerOutput {
  items: RewardLedgerView[];
  cursor?: string;
  total: number;
}

// ─── rewardBalance (E2E, derived rollup) ────────────────────────────

export interface RewardBalanceBody {
  balanceId: string;
  providerDid: string;
  /** Running balance, decimal STRING (no float). */
  balance: string;
  currency: string;
  asOf: string;
}
export interface RewardBalanceView extends RewardBalanceBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface SetBalanceInput {
  balanceId: string;
  providerDid: string;
  balance: string;
  currency: string;
  asOf?: string;
  recipients?: string[];
}
export interface SetBalanceOutput {
  status: "recorded" | "rejected";
  uri?: string;
  keyId?: string;
  balanceId?: string;
  error?: string;
}
export interface GetBalanceInput {
  balanceId: string;
}
export interface GetBalanceOutput {
  balance?: RewardBalanceView;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  resourceListingCount?: number;
  contributionStatCount?: number;
  providerProfileCount?: number;
  contributionEntryCount?: number;
  rewardLedgerEntryCount?: number;
  rewardBalanceCount?: number;
  listingsByType?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isPct(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100;
}
/** Decimal money string: optional leading '-', digits, optional fractional part. */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^-?\d+(\.\d+)?$/.test(s);
}
export function isResourceType(s: unknown): s is ResourceType {
  return s === "gpu" || s === "storage" || s === "data" || s === "location";
}
export function listingDidFor(id: string): string {
  return `${RESOURCE_PROVIDER_DID_PREFIX}listing:${id.toLowerCase()}`;
}
export function statDidFor(id: string): string {
  return `${RESOURCE_PROVIDER_DID_PREFIX}stat:${id.toLowerCase()}`;
}
export function rkeyOf(prefix: string, id: string): string {
  return `${prefix}-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
