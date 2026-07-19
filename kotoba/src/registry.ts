/**
 * resource-provider kotoba — kotoba-E2E registry.
 *
 * Plaintext path (resourceListing, contributionStat): sdk.write / sdk.read —
 * public marketplace catalog + aggregate stats. FK contributionStat →
 * resourceListing via exists() (read + check).
 * E2E path (providerProfile, contributionEntry, rewardLedgerEntry,
 * rewardBalance): sdk.encryptedWrite / sdk.encryptedRead — PII / private-content
 * / ledger bodies sealed in the kotoba envelope (ADR-2605181100), read-cap =
 * owner DID + explicit recipients. The substrate never sees provider PII, payload
 * refs, or reward amounts in plaintext.
 *
 * The regulated EXECUTION (GPU/LLM inference, quality-validation compute, raw-
 * credential custody, and the fiat MoR / payout settlement rail) stays etzhayyim via
 * consent-capability — not modeled here as a collection.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  CONTRIBUTION_ENTRY_INNER_TYPE,
  CONTRIBUTION_STAT_COLLECTION,
  PROVIDER_PROFILE_INNER_TYPE,
  REWARD_BALANCE_INNER_TYPE,
  REWARD_LEDGER_INNER_TYPE,
  RESOURCE_LISTING_COLLECTION,
  isDecimalString,
  isPct,
  isResourceType,
  isUint,
  listingDidFor,
  rkeyOf,
  statDidFor,
  type ContributionEntryBody,
  type ContributionEntryView,
  type ContributionStatRecord,
  type ContributionStatView,
  type CoverageInput,
  type CoverageOutput,
  type GetBalanceInput,
  type GetBalanceOutput,
  type GetContributionInput,
  type GetContributionOutput,
  type GetLedgerInput,
  type GetLedgerOutput,
  type GetListingInput,
  type GetListingOutput,
  type GetProfileInput,
  type GetProfileOutput,
  type ListContributionsInput,
  type ListContributionsOutput,
  type ListLedgerInput,
  type ListLedgerOutput,
  type ListListingsInput,
  type ListListingsOutput,
  type ListProfilesInput,
  type ListProfilesOutput,
  type ListStatsInput,
  type ListStatsOutput,
  type PostLedgerInput,
  type PostLedgerOutput,
  type ProviderProfileBody,
  type ProviderProfileView,
  type RecordStatInput,
  type RecordStatOutput,
  type RegisterListingInput,
  type RegisterListingOutput,
  type ResourceListingRecord,
  type ResourceListingView,
  type RewardBalanceBody,
  type RewardBalanceView,
  type RewardLedgerBody,
  type RewardLedgerView,
  type SetBalanceInput,
  type SetBalanceOutput,
  type SubmitContributionInput,
  type SubmitContributionOutput,
  type UpsertProfileInput,
  type UpsertProfileOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Plaintext FK helper (exists via read; mock has no exists()) ─────

async function listingExists(e: Etzhayyim, listingId: string): Promise<boolean> {
  const rkey = rkeyOf("listing", listingId);
  const resp = await e
    .read<ResourceListingRecord>({ collection: RESOURCE_LISTING_COLLECTION, rkey })
    .catch(() => ({ records: [] as Array<{ uri: string; value: ResourceListingRecord }> }));
  return Boolean(resp.records[0]?.value);
}

// ─── resourceListing (PLAINTEXT, public catalog) ────────────────────

export async function registerListing(e: Etzhayyim, input: RegisterListingInput): Promise<RegisterListingOutput> {
  if (!input.listingId || !input.region) return { status: "rejected", error: "missingRequiredFields" };
  if (!isResourceType(input.resourceType)) return { status: "rejected", error: "invalidResourceType" };
  if (!isUint(input.capacity)) return { status: "rejected", error: "invalidCapacity" };
  const rkey = rkeyOf("listing", input.listingId);
  const existing = await e.read<ResourceListingRecord>({ collection: RESOURCE_LISTING_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", listingUri: existing.records[0].uri, did: existing.records[0].value.did, listingId: input.listingId };
  }
  const now = new Date().toISOString();
  const did = listingDidFor(input.listingId);
  const record: ResourceListingRecord = {
    did,
    listingId: input.listingId,
    resourceType: input.resourceType,
    region: input.region,
    capacity: input.capacity,
    createdAt: now,
  };
  const receipt = await e.write({ collection: RESOURCE_LISTING_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "registered", listingUri: receipt.uri, did, listingId: input.listingId };
}

export async function getListing(e: Etzhayyim, input: GetListingInput): Promise<GetListingOutput> {
  if (!input.listingId) return { error: "invalidListingId" };
  const rkey = rkeyOf("listing", input.listingId);
  const resp = await e.read<ResourceListingRecord>({ collection: RESOURCE_LISTING_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { listing: { ...r.value, listingUri: r.uri } };
}

export async function listListings(e: Etzhayyim, input: ListListingsInput = {}): Promise<ListListingsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ResourceListingRecord>({ collection: RESOURCE_LISTING_COLLECTION, cursor: input.cursor, limit });
  const items: ResourceListingView[] = resp.records
    .filter((r) => !input.resourceType || r.value.resourceType === input.resourceType)
    .filter((r) => !input.region || r.value.region === input.region)
    .map((r) => ({ ...r.value, listingUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── contributionStat (PLAINTEXT, aggregate, FK → resourceListing) ──

export async function recordStat(e: Etzhayyim, input: RecordStatInput): Promise<RecordStatOutput> {
  if (!input.statId || !input.listingId) return { status: "rejected", error: "missingRequiredFields" };
  if (!isResourceType(input.resourceType)) return { status: "rejected", error: "invalidResourceType" };
  if (!isUint(input.contributionCount)) return { status: "rejected", error: "invalidContributionCount" };
  if (!isUint(input.acceptedUnits)) return { status: "rejected", error: "invalidAcceptedUnits" };
  if (!(await listingExists(e, input.listingId))) return { status: "rejected", error: "listingNotFound" };
  const rkey = rkeyOf("stat", input.statId);
  const existing = await e.read<ContributionStatRecord>({ collection: CONTRIBUTION_STAT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", statUri: existing.records[0].uri, did: existing.records[0].value.did, statId: input.statId };
  }
  const now = new Date().toISOString();
  const did = statDidFor(input.statId);
  const record: ContributionStatRecord = {
    did,
    statId: input.statId,
    listingId: input.listingId,
    resourceType: input.resourceType,
    contributionCount: input.contributionCount,
    acceptedUnits: input.acceptedUnits,
    generatedAt: input.generatedAt ?? now,
    createdAt: now,
  };
  const receipt = await e.write({ collection: CONTRIBUTION_STAT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "recorded", statUri: receipt.uri, did, statId: input.statId };
}

export async function listStats(e: Etzhayyim, input: ListStatsInput = {}): Promise<ListStatsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ContributionStatRecord>({ collection: CONTRIBUTION_STAT_COLLECTION, cursor: input.cursor, limit });
  const items: ContributionStatView[] = resp.records
    .filter((r) => !input.resourceType || r.value.resourceType === input.resourceType)
    .map((r) => ({ ...r.value, statUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── providerProfile (E2E, PII) ─────────────────────────────────────

export async function upsertProfile(e: Etzhayyim, input: UpsertProfileInput): Promise<UpsertProfileOutput> {
  if (!input.profileId || !input.providerDid || !input.displayName) return { status: "rejected", error: "missingRequiredFields" };
  const body: ProviderProfileBody = {
    profileId: input.profileId,
    providerDid: input.providerDid,
    displayName: input.displayName,
    geo: input.geo ?? "",
    deviceFingerprint: input.deviceFingerprint ?? "",
    contact: input.contact ?? "",
    registeredAt: input.registeredAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: PROVIDER_PROFILE_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("profile", input.profileId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, profileId: input.profileId };
}

async function scanProfiles(e: Etzhayyim, maxScan: number): Promise<ProviderProfileView[]> {
  const out: ProviderProfileView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<ProviderProfileBody>({ innerType: PROVIDER_PROFILE_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getProfile(e: Etzhayyim, input: GetProfileInput): Promise<GetProfileOutput> {
  if (!input.profileId) return { error: "invalidProfileId" };
  const all = await scanProfiles(e, DEFAULT_MAX_SCAN);
  const found = all.find((p) => p.profileId === input.profileId);
  if (!found) return { error: "notFound" };
  return { profile: found };
}

export async function listProfiles(e: Etzhayyim, input: ListProfilesInput = {}): Promise<ListProfilesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanProfiles(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((p) => !input.providerDid || p.providerDid === input.providerDid);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── contributionEntry (E2E, private content) ───────────────────────

export async function submitContribution(e: Etzhayyim, input: SubmitContributionInput): Promise<SubmitContributionOutput> {
  if (!input.entryId || !input.providerDid || !input.listingId || !input.payloadRef) return { status: "rejected", error: "missingRequiredFields" };
  if (!isResourceType(input.resourceType)) return { status: "rejected", error: "invalidResourceType" };
  if (!isPct(input.qualityScore)) return { status: "rejected", error: "invalidQualityScore" };
  const body: ContributionEntryBody = {
    entryId: input.entryId,
    providerDid: input.providerDid,
    listingId: input.listingId,
    resourceType: input.resourceType,
    payloadRef: input.payloadRef,
    qualityScore: input.qualityScore,
    contributedAt: input.contributedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: CONTRIBUTION_ENTRY_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("entry", input.entryId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, entryId: input.entryId };
}

async function scanContributions(e: Etzhayyim, maxScan: number): Promise<ContributionEntryView[]> {
  const out: ContributionEntryView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<ContributionEntryBody>({ innerType: CONTRIBUTION_ENTRY_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getContribution(e: Etzhayyim, input: GetContributionInput): Promise<GetContributionOutput> {
  if (!input.entryId) return { error: "invalidEntryId" };
  const all = await scanContributions(e, DEFAULT_MAX_SCAN);
  const found = all.find((c) => c.entryId === input.entryId);
  if (!found) return { error: "notFound" };
  return { entry: found };
}

export async function listContributions(e: Etzhayyim, input: ListContributionsInput = {}): Promise<ListContributionsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanContributions(e, DEFAULT_MAX_SCAN);
  const filtered = all
    .filter((c) => !input.providerDid || c.providerDid === input.providerDid)
    .filter((c) => !input.resourceType || c.resourceType === input.resourceType);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── rewardLedgerEntry (E2E, ledger / tx-history) ───────────────────

export async function postLedger(e: Etzhayyim, input: PostLedgerInput): Promise<PostLedgerOutput> {
  if (!input.ledgerId || !input.providerDid || !input.entryId || !input.currency) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.amount)) return { status: "rejected", error: "invalidAmount" };
  const body: RewardLedgerBody = {
    ledgerId: input.ledgerId,
    providerDid: input.providerDid,
    entryId: input.entryId,
    amount: input.amount,
    currency: input.currency,
    status: input.status ?? "pending",
    postedAt: input.postedAt ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: REWARD_LEDGER_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("ledger", input.ledgerId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, ledgerId: input.ledgerId };
}

async function scanLedger(e: Etzhayyim, maxScan: number): Promise<RewardLedgerView[]> {
  const out: RewardLedgerView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<RewardLedgerBody>({ innerType: REWARD_LEDGER_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getLedger(e: Etzhayyim, input: GetLedgerInput): Promise<GetLedgerOutput> {
  if (!input.ledgerId) return { error: "invalidLedgerId" };
  const all = await scanLedger(e, DEFAULT_MAX_SCAN);
  const found = all.find((l) => l.ledgerId === input.ledgerId);
  if (!found) return { error: "notFound" };
  return { entry: found };
}

export async function listLedger(e: Etzhayyim, input: ListLedgerInput = {}): Promise<ListLedgerOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanLedger(e, DEFAULT_MAX_SCAN);
  const filtered = all
    .filter((l) => !input.providerDid || l.providerDid === input.providerDid)
    .filter((l) => !input.status || l.status === input.status);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

// ─── rewardBalance (E2E, derived rollup) ────────────────────────────

export async function setBalance(e: Etzhayyim, input: SetBalanceInput): Promise<SetBalanceOutput> {
  if (!input.balanceId || !input.providerDid || !input.currency) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.balance)) return { status: "rejected", error: "invalidBalance" };
  const body: RewardBalanceBody = {
    balanceId: input.balanceId,
    providerDid: input.providerDid,
    balance: input.balance,
    currency: input.currency,
    asOf: input.asOf ?? new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: REWARD_BALANCE_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("balance", input.balanceId),
  });
  return { status: "recorded", uri: receipt.uri, keyId: receipt.keyId, balanceId: input.balanceId };
}

async function scanBalances(e: Etzhayyim, maxScan: number): Promise<RewardBalanceView[]> {
  const out: RewardBalanceView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<RewardBalanceBody>({ innerType: REWARD_BALANCE_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getBalance(e: Etzhayyim, input: GetBalanceInput): Promise<GetBalanceOutput> {
  if (!input.balanceId) return { error: "invalidBalanceId" };
  const all = await scanBalances(e, DEFAULT_MAX_SCAN);
  const found = all.find((b) => b.balanceId === input.balanceId);
  if (!found) return { error: "notFound" };
  return { balance: found };
}

// ─── Coverage rollup ────────────────────────────────────────────────

async function countPlaintext<T>(e: Etzhayyim, collection: string, maxScan: number): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  while (count < maxScan) {
    const page = await e.read<T>({ collection, cursor, limit: PAGE_LIMIT });
    count += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  return count;
}

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const listingsByType: Record<string, number> = {};
  let resourceListingCount = 0;
  let cursor: string | undefined;
  while (resourceListingCount < maxScan) {
    const page = await e.read<ResourceListingRecord>({ collection: RESOURCE_LISTING_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      listingsByType[r.value.resourceType] = (listingsByType[r.value.resourceType] ?? 0) + 1;
      resourceListingCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }

  const contributionStatCount = await countPlaintext<ContributionStatRecord>(e, CONTRIBUTION_STAT_COLLECTION, maxScan);

  const providerProfileCount = (await scanProfiles(e, maxScan)).length;
  const contributionEntryCount = (await scanContributions(e, maxScan)).length;
  const rewardLedgerEntryCount = (await scanLedger(e, maxScan)).length;
  const rewardBalanceCount = (await scanBalances(e, maxScan)).length;

  return {
    resourceListingCount,
    contributionStatCount,
    providerProfileCount,
    contributionEntryCount,
    rewardLedgerEntryCount,
    rewardBalanceCount,
    listingsByType,
    truncated:
      resourceListingCount >= maxScan ||
      contributionStatCount >= maxScan ||
      providerProfileCount >= maxScan ||
      contributionEntryCount >= maxScan ||
      rewardLedgerEntryCount >= maxScan ||
      rewardBalanceCount >= maxScan,
  };
}
