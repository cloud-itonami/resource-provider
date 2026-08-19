# Operator quickstart — resource-provider

Get the implementation running, see its central guarantee hold, and see it fail
when you break it. Every command below was executed; the outputs are transcribed,
not predicted. Where something was *not* verified, this document says so.

## What this repo is

`resource-provider` is the **kotoba-side implementation** of the etzhayyim Resource
Provider Network: a marketplace where providers contribute GPU capacity, storage,
data, and location signal in exchange for rewards.

Its whole design question is **which data the substrate is allowed to see**. The
answer is split in two, and that split is the thing worth verifying:

| Path | Collections / inner types | Written with | Substrate sees |
|---|---|---|---|
| **Plaintext** — public catalog + aggregates | `resourceListing`, `contributionStat` | `sdk.write` / `sdk.read` | everything |
| **Sealed (E2E)** — PII, content, money | `providerProfile`, `contributionEntry`, `rewardLedgerEntry`, `rewardBalance` | `sdk.encryptedWrite` / `encryptedRead` | ciphertext only |

Read-cap on the sealed path is the owner DID plus explicit recipients (ADR-2605181100).

**Not implemented here, by design.** GPU/LLM inference, quality-validation compute,
raw-credential custody, and the fiat MoR / payout settlement rail stay on etzhayyim
via consent-capability. They are not modeled as collections in this repo. If you are
looking for the regulated execution path, it is not here and is not missing.

## Prerequisites

Node and npm. The implementation lives in `kotoba/`.

### The one trap that will cost you an hour

`npm install` fails on **npm ≥ 11 when your user-level `~/.npmrc` contains an
`allow-scripts[]` entry** — because this package has git dependencies, and npm's
internal git-dep preparation subprocess rejects that config as a "project-scoped
install". The error names `--allow-scripts` but points at a file you did not edit,
so it reads like a problem with this repo. It is not.

```
npm error git dep preparation failed
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs.
```

Measured across three machines, isolating config from version:

| npm | node | user-level `allow-scripts[]` | `npm install` |
|---|---|---|---|
| 10.9.8 | v22.22.3 | absent | ok — 135 packages in 58s |
| 10.9.8 | v22.22.3 | **present** | ok — 136 packages in 24s |
| 11.17.0 | v26.4.0 | absent | ok (`prepare` deferred, see below) |
| 11.17.0 | v26.4.0 | **present** | **fails** `EALLOWSCRIPTS` |
| 11.16.0 | v26.3.0 | **present** | **fails** `EALLOWSCRIPTS` |

So the trigger is the **config**, not the npm version: npm 11.17.0 installs fine
without the entry and fails with it, while npm 10.9.8 installs fine either way.

**Workaround** — run the install with that user config neutralised. Do not edit
`~/.npmrc`; the entry is there for other tooling:

```bash
npm_config_userconfig=/dev/null npm install
```

On npm 11.16.0 this clears the error and the install proceeds to compile the git
dependencies with `tsc`, which is slow. *Full local completion was not observed —
the runs that completed end-to-end were on npm 10.9.8 and 11.17.0.*

### A second surprise that is harmless

On npm 11.17.0 the git deps' `prepare` scripts are deferred, so
`node_modules/@etzhayyim/sdk-mock/dist/` is **empty**. Tests still pass, because
`@etzhayyim/sdk-mock` sets `"main": "src/index.ts"` and vitest transforms the
TypeScript source directly. An empty `dist/` is not a broken install.

## Install, test, typecheck

```bash
cd kotoba
npm install
npm test
npm run typecheck
```

Verified on npm 10.9.8 / node v22.22.3 and npm 11.17.0 / node v26.4.0:

```
 ✓ test/resource-provider.test.ts (10 tests) 4ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

`npm run typecheck` (`tsc --noEmit`) exits 0. Note that `@etzhayyim/sdk` is consumed
as `import type` only, so typecheck passes even when the dep's `dist/` is unbuilt.

## Confirm the tests actually discriminate

A green suite only means something if it can go red. This one can — verified by
regressing the repo's central claim. In `src/registry.ts`, `upsertProfile` seals the
provider profile:

```ts
const receipt = await e.encryptedWrite<Record<string, unknown>>({
  innerType: PROVIDER_PROFILE_INNER_TYPE,
```

Swap that sealed write for a plaintext one:

```ts
const receipt = await e.write<Record<string, unknown>>({
  collection: PROVIDER_PROFILE_INNER_TYPE,
```

`npm test` then reports **3 failed | 7 passed**. Restore the file and it returns to
10 passed. If you are changing the sealed path, this is the cheapest way to confirm
your test run is actually exercising it.

### A known weakness — do not use this test as your proof

`-t "enforces read-cap"` (the test asserting a non-recipient sees zero profiles)
**still passes under the break above.** With a plaintext write, `scanProfiles` reads
via `encryptedRead` and finds nothing, so the outsider sees zero — the assertion is
satisfied because the data is *absent*, not because it is *access-controlled*. The
test cannot distinguish those two states.

So: verify read-cap with the **full** `npm test`, not with that scenario alone. The
test would be strengthened by asserting in the same case that the *owner* still sees
the profile while the outsider does not.

## Where things are

| Path | What |
|---|---|
| `kotoba/src/types.ts` | collection names, inner types, `ResourceType`, validators |
| `kotoba/src/registry.ts` | the 17 exported operations; plaintext vs sealed paths |
| `kotoba/src/index.ts` | public barrel |
| `kotoba/test/resource-provider.test.ts` | 10 tests — the executable specification |
| `PROJECT.jsonld` | project metadata and task tracking |
| `migration.edn`, `MIGRATION-TODO.md` | extraction record from `etzhayyim/root` |

Resource types are `gpu | storage | data | location`. `contributionStat` carries a
foreign key to `resourceListing` and is rejected if the listing does not exist —
`coverage()` reports per-type counts across both paths.
