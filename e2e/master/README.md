# Master test pack

419 executable cases across all four APIs, all four portals, the three Flutter
apps and the Electron desktop edition. Every case asserts something specific and
fails for exactly one reason.

```bash
node e2e/master/run-all.mjs          # everything (~4 min)
node e2e/master/run-all.mjs 02 03    # only those suites
SKIP_SLOW=1 node e2e/master/run-all.mjs   # skip builds + Flutter (~1 min)
node e2e/master/02-donations-money.mjs    # one suite directly
```

## Prerequisites

| Need | How |
|---|---|
| Postgres on `:5434` | `cd apps/superadmin-api && docker compose up -d postgres` |
| 4 APIs + 4 portals running | `bash start-all.sh`, or per app `npm run start:dev` / `npm run dev` |
| `OTP_MOCK=true` | already set in `apps/mandir-api/.env` |
| QA super admin seeded | `cd apps/superadmin-api && npx ts-node scripts/seed-qa-tester.ts` |
| Flutter (suite 08 only) | `~/development/flutter` — not on `PATH` by design |

Run from `apps/mandir-web/`. The suites talk to `localhost`, never `127.0.0.1`:
Vite binds IPv6 localhost only, and the v4 address connection-refuses in a way
that reads as "the app is down".

## Suites

| Suite | Cases | Covers |
|---|--:|---|
| `01-auth-rbac` | 53 | OTP login (all 3 flows), super-admin password+TOTP, JWT forgery/expiry/`alg=none`, sessions, refresh, the tenant role gate |
| `02-donations-money` | 76 | Integer-paise validation, gapless receipt series, void + reissue, 80G/PAN, cheque lifecycle, global-ledger mirror, audit |
| `03-modules` | 57 | Rooms, halls, prasad, seva, events, bhojanshala, expenses, bolis, generic resource registry |
| `04-superadmin` | 66 | Tenant lifecycle, the 4 access controls, plans + custom plans, module entitlements, licensing, billing, the change-request queue |
| `05-devotee-sant` | 49 | Cross-temple ledger ownership, 80G, temple directory, stays, notifications, sant reps, the `maharaj_*` → `sant_*` rename |
| `06-tenancy-security` | 49 | Cross-tenant isolation, SQL injection, stored XSS, PAN handling, CORS, secrets, rate limits, audit completeness |
| `07-static-contract` | 38 | CSS class drift, double-stringified bodies, envelope shape, `check:sql`, migrations, lint, typecheck, build, i18n parity |
| `08-mobile-desktop` | 31 | `dart analyze`, `flutter test` per package, vendored-package drift, release config, Electron sync/licence |

## What this pack does that the older suites do not

**Every case is isolated.** `t()` runs each case in its own try/catch, so one
throw cannot silently mark the rest of a suite as passing. A suite that dies
during setup records a P1 failure instead of exiting quietly.

**Failures are totalled from results files, not exit codes.** `run-all.mjs`
reads `results/*.json`, so a `| head` in CI cannot swallow a failure, and a
suite that never produced results is reported as CRASHED rather than skipped.

**It checks things no other tool looks at.** Typecheck, lint and every API test
passed on a Change Requests page that rendered as unstyled text over a 400.
`07-static-contract` catches both halves of that: class names absent from the
built stylesheet, and request bodies serialised twice.

## Fixture and idempotency notes

Re-running the pack must not change its result. Two places needed care:

- **Bookings** (`03-modules`) take a date window starting after every booking
  that already exists, so a rerun cannot collide with a previous one. Fixed
  offsets from today collide on the second run; a *random* far-future offset
  only makes the collision rare, which is worse — it fails intermittently and
  reads as a booking regression.
- **Whole-table invariants** are scoped to rows the run created (`RUN_START`).
  The fixture database carries legacy damage — receipt-series gaps from before
  the numbering joined its transaction, over-collected bolis from before the
  ceiling was enforced on both routes — that cannot be un-done and would make
  those cases permanently red instead of guarding current behaviour.

`vendored-drift-baseline.json` declares the 8 `packages/core` files that differ
between the three mobile repos **by design** — each app targets its own API port,
only mandir carries module entitlements, only devotee has its own auth
repository. They are not debt, and copying between the repos to "fix" them is how
the sant app once shipped calling mandir-api on the wrong port. `packages/ui`
genuinely is one source in three places and is byte-identical. The check fails on
any *undeclared* difference, which is what catches a real un-ported change.

## Adding a case

```js
import { suite, t, expect, mandirApi, mandirLogin, psql1 } from './lib.mjs';

await suite('09-my-area', async () => {
  const token = (await mandirLogin()).token;

  await t('TC-MINE-001', 'P1', 'states the invariant, not the mechanics', async () => {
    const r = await mandirApi('GET', '/donations?limit=1', { token });
    expect.http2xx(r);
    expect.paise(r.data[0].amount_paise, 'amount');
    return `${r.meta.total} rows`;   // becomes the PASS detail
  });
});
```

Priorities: **P1** money, auth, receipts, entitlements, isolation — a P1 failure
blocks release. **P2** important but not money-losing. **P3** cosmetic.

Assert the rule, not the fixture: prefer "five sequential donations take five
consecutive numbers" over "the next number is 1558".
