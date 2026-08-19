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
| `kotoba/test/resource-provider.test.ts` | 10 tests — the executable specification |
| `PROJECT.jsonld` | project metadata and task tracking |
| `migration.edn`, `MIGRATION-TODO.md` | extraction record from `etzhayyim/root` |

The strategy, capabilities, activities, and architecture documents were
**consolidated into `PROJECT.jsonld`**; they are no longer separate top-level
`.jsonld` files. (Earlier revisions of this README listed them as separate files,
which they have not been since the consolidation.)

## Status

- **kotoba implementation** — present and green: 17 operations, 10 passing tests,
  `tsc --noEmit` clean. See the quickstart for verified commands and versions.
- **Resource Provider Portal, collector/reward actors** — pending, per
  `PROJECT.jsonld`.

## License

Apache-2.0. See `NOTICE`.
