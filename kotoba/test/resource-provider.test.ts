import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
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
} from "../src/index.js";

const OWNER = "did:web:resource-provider.etzhayyim.com";

describe("resource-provider kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("resourceListing (PLAINTEXT public catalog)", () => {
    it("registers, dedups, validates, gets, lists/filters", async () => {
      expect((await registerListing(e, { listingId: "l1", resourceType: "gpu", region: "us-west", capacity: 120 })).status).toBe("registered");
      expect((await registerListing(e, { listingId: "l1", resourceType: "gpu", region: "us-west", capacity: 120 })).status).toBe("alreadyExists");
      expect((await registerListing(e, { listingId: "lX", resourceType: "bogus" as any, region: "x", capacity: 1 })).status).toBe("rejected");
      expect((await registerListing(e, { listingId: "lY", resourceType: "gpu", region: "x", capacity: -1 })).status).toBe("rejected");
      await registerListing(e, { listingId: "l2", resourceType: "storage", region: "eu-central", capacity: 4096 });
      expect((await getListing(e, { listingId: "l1" })).listing?.capacity).toBe(120);
      expect((await getListing(e, { listingId: "nope" })).error).toBe("notFound");
      expect((await listListings(e)).total).toBe(2);
      expect((await listListings(e, { resourceType: "gpu" })).total).toBe(1);
      expect((await listListings(e, { region: "eu-central" })).total).toBe(1);
    });
  });

  describe("contributionStat (PLAINTEXT aggregate, FK → resourceListing)", () => {
    it("requires the listing FK, dedups, lists/filters", async () => {
      // FK enforced: no listing yet.
      expect((await recordStat(e, { statId: "s1", listingId: "l1", resourceType: "gpu", contributionCount: 10, acceptedUnits: 8 })).status).toBe("rejected");
      await registerListing(e, { listingId: "l1", resourceType: "gpu", region: "us-west", capacity: 120 });
      expect((await recordStat(e, { statId: "s1", listingId: "l1", resourceType: "gpu", contributionCount: 10, acceptedUnits: 8 })).status).toBe("recorded");
      expect((await recordStat(e, { statId: "s1", listingId: "l1", resourceType: "gpu", contributionCount: 10, acceptedUnits: 8 })).status).toBe("alreadyExists");
      expect((await recordStat(e, { statId: "sX", listingId: "l1", resourceType: "gpu", contributionCount: -1, acceptedUnits: 0 })).status).toBe("rejected");
      expect((await listStats(e)).total).toBe(1);
      expect((await listStats(e, { resourceType: "storage" })).total).toBe(0);
    });
  });

  describe("providerProfile (E2E PII)", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, gets/lists/filters", async () => {
      const ok = await upsertProfile(e, { profileId: "pr1", providerDid: "did:web:alice", displayName: "Alice", geo: "37.77,-122.41", deviceFingerprint: "fp-abc", contact: "alice@example" });
      expect(ok.status).toBe("recorded");
      expect(ok.keyId).toBeTruthy();
      expect((await upsertProfile(e, { profileId: "", providerDid: "d", displayName: "x", geo: "", deviceFingerprint: "", contact: "" })).status).toBe("rejected");
      const got = await getProfile(e, { profileId: "pr1" });
      expect(got.profile?.geo).toBe("37.77,-122.41");
      expect(got.profile?.deviceFingerprint).toBe("fp-abc");
      await upsertProfile(e, { profileId: "pr2", providerDid: "did:web:bob", displayName: "Bob", geo: "", deviceFingerprint: "", contact: "" });
      expect((await listProfiles(e)).total).toBe(2);
      expect((await listProfiles(e, { providerDid: "did:web:alice" })).total).toBe(1);
    });

    it("enforces read-cap: a fresh non-recipient actor sees zero profiles", async () => {
      await upsertProfile(e, { profileId: "pr1", providerDid: "did:web:alice", displayName: "Alice", geo: "1,2", deviceFingerprint: "fp", contact: "c" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listProfiles(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:trainer.example";
      const r = await upsertProfile(e, { profileId: "pr1", providerDid: "did:web:alice", displayName: "Alice", geo: "1,2", deviceFingerprint: "fp", contact: "c", recipients: [partner] });
      expect(r.status).toBe("recorded");
      expect((await listProfiles(e)).total).toBe(1);
    });
  });

  describe("contributionEntry (E2E private content)", () => {
    it("seals, round-trips, validates qualityScore 0-100, gets/lists/filters", async () => {
      const ok = await submitContribution(e, { entryId: "ce1", providerDid: "did:web:alice", listingId: "l1", resourceType: "data", payloadRef: "cid-1", qualityScore: 92 });
      expect(ok.status).toBe("recorded");
      expect((await submitContribution(e, { entryId: "ceX", providerDid: "d", listingId: "l", resourceType: "data", payloadRef: "r", qualityScore: 200 })).status).toBe("rejected");
      const got = await getContribution(e, { entryId: "ce1" });
      expect(got.entry?.payloadRef).toBe("cid-1");
      expect(got.entry?.qualityScore).toBe(92);
      await submitContribution(e, { entryId: "ce2", providerDid: "did:web:bob", listingId: "l1", resourceType: "gpu", payloadRef: "cid-2", qualityScore: 50 });
      expect((await listContributions(e)).total).toBe(2);
      expect((await listContributions(e, { providerDid: "did:web:alice" })).total).toBe(1);
      expect((await listContributions(e, { resourceType: "gpu" })).total).toBe(1);
    });
  });

  describe("rewardLedgerEntry + rewardBalance (E2E ledger / balances)", () => {
    it("posts ledger entries (decimal-string amount), gets/lists/filters", async () => {
      const ok = await postLedger(e, { ledgerId: "rl1", providerDid: "did:web:alice", entryId: "ce1", amount: "12.50", currency: "USDC" });
      expect(ok.status).toBe("recorded");
      expect((await postLedger(e, { ledgerId: "rlX", providerDid: "d", entryId: "e", amount: "abc", currency: "USDC" })).status).toBe("rejected");
      const got = await getLedger(e, { ledgerId: "rl1" });
      expect(got.entry?.amount).toBe("12.50");
      expect(got.entry?.status).toBe("pending");
      await postLedger(e, { ledgerId: "rl2", providerDid: "did:web:alice", entryId: "ce2", amount: "3.00", currency: "USDC", status: "settled" });
      expect((await listLedger(e, { providerDid: "did:web:alice" })).total).toBe(2);
      expect((await listLedger(e, { status: "settled" })).total).toBe(1);
    });

    it("sets/gets a derived balance (decimal-string)", async () => {
      expect((await setBalance(e, { balanceId: "b1", providerDid: "did:web:alice", balance: "15.50", currency: "USDC" })).status).toBe("recorded");
      expect((await setBalance(e, { balanceId: "bX", providerDid: "d", balance: "notnum", currency: "USDC" })).status).toBe("rejected");
      const got = await getBalance(e, { balanceId: "b1" });
      expect(got.balance?.balance).toBe("15.50");
    });

    it("enforces read-cap on ledger: outsider sees zero", async () => {
      await postLedger(e, { ledgerId: "rl1", providerDid: "did:web:alice", entryId: "ce1", amount: "12.50", currency: "USDC" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listLedger(outsider)).total).toBe(0);
    });
  });

  describe("coverage rollup", () => {
    it("counts all five collections + listingsByType", async () => {
      await registerListing(e, { listingId: "l1", resourceType: "gpu", region: "us-west", capacity: 100 });
      await registerListing(e, { listingId: "l2", resourceType: "gpu", region: "eu", capacity: 200 });
      await registerListing(e, { listingId: "l3", resourceType: "data", region: "us-west", capacity: 1000 });
      await recordStat(e, { statId: "s1", listingId: "l1", resourceType: "gpu", contributionCount: 5, acceptedUnits: 4 });
      await upsertProfile(e, { profileId: "pr1", providerDid: "did:web:alice", displayName: "Alice", geo: "1,2", deviceFingerprint: "fp", contact: "c" });
      await submitContribution(e, { entryId: "ce1", providerDid: "did:web:alice", listingId: "l1", resourceType: "gpu", payloadRef: "cid", qualityScore: 80 });
      await postLedger(e, { ledgerId: "rl1", providerDid: "did:web:alice", entryId: "ce1", amount: "9.00", currency: "USDC" });
      await setBalance(e, { balanceId: "b1", providerDid: "did:web:alice", balance: "9.00", currency: "USDC" });
      const cov = await coverage(e);
      expect(cov.resourceListingCount).toBe(3);
      expect(cov.contributionStatCount).toBe(1);
      expect(cov.providerProfileCount).toBe(1);
      expect(cov.contributionEntryCount).toBe(1);
      expect(cov.rewardLedgerEntryCount).toBe(1);
      expect(cov.rewardBalanceCount).toBe(1);
      expect(cov.listingsByType?.gpu).toBe(2);
      expect(cov.listingsByType?.data).toBe(1);
    });
  });
});
