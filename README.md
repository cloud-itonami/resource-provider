# resource-provider

**The kotoba-side implementation of the etzhayyim Resource Provider Network** — a
marketplace where providers contribute GPU capacity, storage, data, and location
signal in exchange for rewards.

The name does not say what this repo decides, so: this repo owns **the boundary
between what the substrate may read in plaintext and what it may only ever hold as
ciphertext.** Everything else about the network lives elsewhere.

→ **[docs/operator-quickstart.md](docs/operator-quickstart.md)** — install, run the
tests, and see the sealed-data guarantee hold *and* fail.

## The split this repo exists to enforce

| Path | Collections / inner types | Written with | Substrate sees |
|---|---|---|---|
| **Plaintext** — public catalog + aggregates | `resourceListing`, `contributionStat` | `sdk.write` / `sdk.read` | everything |
| **Sealed (E2E)** — PII, contributed content, money | `providerProfile`, `contributionEntry`, `rewardLedgerEntry`, `rewardBalance` | `sdk.encryptedWrite` / `encryptedRead` | ciphertext only |

Read-cap on the sealed path is the owner DID plus explicit recipients
(ADR-2605181100). Provider PII, payload refs, and reward amounts are never in
plaintext on the substrate.

Resource types are `gpu | storage | data | location`. `contributionStat` carries a
foreign key to `resourceListing` and is rejected when the listing does not exist.

Record ids (`listingId`, `statId`, `profileId`, `entryId`, `ledgerId`, `balanceId`)
must match `[A-Za-z0-9._~-]{1,256}`. Ids outside that set are **rejected**, not
folded onto another record's key: the record key is where a record lives and the
DID is what it calls itself, so those two derivations have to stay in step.

## What stays on etzhayyim

GPU/LLM inference, quality-validation compute, raw-credential custody, and the fiat
MoR / payout settlement rail are reached via consent-capability and are **not
modeled here as collections**. If you came looking for the regulated execution path:
it is deliberately absent, not missing.

## Layout

| Path | What |
|---|---|
| `kotoba/src/types.ts` | collection names, inner types, `ResourceType`, validators |
| `kotoba/src/registry.ts` | the 17 exported operations; plaintext vs sealed paths |
| `kotoba/src/index.ts` | public barrel |
| `kotoba/test/resource-provider.test.ts` | 10 vitest tests over the same operations; needs `npm install` |
| `test/resource_provider_test.cljs` | 80 checks, **no dependencies** — the boundary, record identity, and the validators |
| `PROJECT.jsonld` | project metadata and task tracking |
| `migration.edn`, `MIGRATION-TODO.md` | extraction record from `etzhayyim/root` |

The strategy, capabilities, activities, and architecture documents were
**consolidated into `PROJECT.jsonld`**; they are no longer separate top-level
`.jsonld` files. (Earlier revisions of this README listed them as separate files,
which they have not been since the consolidation.)

## Status

- **kotoba implementation** — 17 operations. `nbb test/resource_provider_test.cljs`
  runs 80 checks against them and passes; it installs nothing.
- **The vitest suite is not runnable on every machine.** It needs two git
  dependencies, and installing those needs package `prepare` scripts. Measured
  2026-09-01 on npm 11.19.0 / node v26.7.0 with an `allow-scripts[]` entry in the
  user-level `~/.npmrc`: plain `npm install` fails `EALLOWSCRIPTS`, and the
  workaround in the quickstart gets past that but had not finished compiling the
  git deps after 420s. So the "10 passing tests, `tsc --noEmit` clean" line that
  used to stand here is **not something this checkout can currently reproduce** —
  it is reported from the machines named in the quickstart, not from every one.
  That is why the suite below takes no dependencies.
- **Resource Provider Portal, collector/reward actors** — pending, per
  `PROJECT.jsonld`.

## License

Apache-2.0. See `NOTICE`.
