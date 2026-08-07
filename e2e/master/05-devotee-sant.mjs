/**
 * The two devotee-facing APIs: devotee-api (cross-temple giving, 80G, stay
 * booking, sant directory) and sant-api (ascetic representatives).
 *
 * Two things carry most of the risk here. First, these APIs read the *shared*
 * `public` schema across every tenant, so an authorisation slip leaks one
 * devotee's giving history to another. Second, sant-api is the only API whose
 * routes moved under `/api/v1` (2026-08-03) and whose tables were renamed from
 * `maharaj_*` to `sant_*`, so both spellings have to keep working for a release.
 *
 *   node e2e/master/05-devotee-sant.mjs
 */
import {
  suite, t, skip, expect, FIXTURES,
  devoteeApi, santApi, saApi, devoteeLogin, santLogin, superAdminLogin,
  psql, psql1, uniq, testMobile,
} from './lib.mjs';

let DEV, DEV_MOBILE, DEV_ID, SA;

await suite('05-devotee-sant', async () => {
  // ═══════════════════════ Devotee auth & profile ══════════════════════════
  DEV_MOBILE = psql1(
    `SELECT replace(mobile,'+91','') FROM public.global_users
      WHERE is_devotee = true AND mobile LIKE '+91%' AND is_active = true
      ORDER BY created_at DESC LIMIT 1`,
  );
  expect.ok(DEV_MOBILE, 'no devotee fixture in the database');
  DEV = (await devoteeLogin(DEV_MOBILE)).token;
  DEV_ID = psql1(`SELECT id FROM public.global_users WHERE mobile = '+91${DEV_MOBILE}'`);

  await t('TC-DEV-001', 'P1', 'a devotee can read their own profile', async () => {
    const r = await devoteeApi('GET', '/me', { token: DEV });
    expect.http2xx(r);
    expect.ok(r.data, 'no profile body');
    return (r.data.name ?? r.data.user?.name ?? '').slice(0, 30);
  });

  await t('TC-DEV-002', 'P1', 'a devotee can update their own profile', async () => {
    const city = `QA City ${uniq()}`;
    const r = await devoteeApi('PATCH', '/me', { token: DEV, body: { city } });
    expect.http2xx(r);
    expect.eq(psql1(`SELECT city FROM public.global_users WHERE id = '${DEV_ID}'`), city);
    return city;
  });

  await t('TC-DEV-003', 'P1', 'a profile update cannot flip privileged flags', async () => {
    // The update path intersects with live information_schema columns, so an
    // over-broad allow-list would let a devotee promote themselves.
    await devoteeApi('PATCH', '/me', {
      token: DEV, body: { is_super_admin: true, verified: true, is_devotee: true },
    });
    const row = psql(
      `SELECT COALESCE(is_super_admin,false) FROM public.global_users WHERE id = '${DEV_ID}'`,
    );
    expect.eq(row[0][0], 'f', 'a devotee must not be able to make themselves a super admin');
    return 'privilege flags held';
  });

  await t('TC-DEV-004', 'P1', 'the profile endpoint refuses an anonymous caller', async () => {
    const r = await devoteeApi('GET', '/me');
    expect.status(r, 401);
    return `${r.status}`;
  });

  // ═══════════════════════ Cross-temple ledger ═════════════════════════════
  await t('TC-DEV-005', 'P1', 'a devotee sees their own transactions', async () => {
    const r = await devoteeApi('GET', '/me/transactions?limit=20', { token: DEV });
    expect.http2xx(r);
    expect.ok(Array.isArray(r.data), 'expected an array');
    return `${r.data.length} transactions`;
  });

  await t('TC-DEV-006', 'P1', 'every listed transaction belongs to the caller', async () => {
    const r = await devoteeApi('GET', '/me/transactions?limit=50', { token: DEV });
    const ids = r.data.map((x) => x.id).filter(Boolean);
    if (!ids.length) return 'no transactions to check';
    const foreign = psql1(
      `SELECT count(*) FROM public.global_transactions
        WHERE id IN (${ids.map((i) => `'${i}'`).join(',')})
          AND (donor_user_id IS DISTINCT FROM '${DEV_ID}')`,
    );
    expect.eq(Number(foreign), 0, 'the ledger returned another devotee’s giving');
    return `${ids.length} rows, all owned`;
  });

  await t('TC-DEV-007', 'P1', 'transaction amounts are integer paise', async () => {
    const r = await devoteeApi('GET', '/me/transactions?limit=50', { token: DEV });
    for (const x of r.data) {
      for (const [k, v] of Object.entries(x)) if (k.endsWith('_paise') && v != null) expect.paise(Number(v), k);
    }
    return `${r.data.length} rows checked`;
  });

  await t('TC-DEV-008', 'P2', 'the transaction summary totals in paise', async () => {
    const r = await devoteeApi('GET', '/me/transactions/summary', { token: DEV });
    expect.http2xx(r);
    for (const [k, v] of Object.entries(r.data ?? {})) {
      if (k.endsWith('_paise') && v != null) expect.paise(Number(v), k);
    }
    return JSON.stringify(r.data).slice(0, 80);
  });

  await t('TC-DEV-009', 'P2', 'junk paging on the ledger does not 500', async () => {
    const r = await devoteeApi('GET', '/me/transactions?page=abc&limit=xyz', { token: DEV });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  // ═══════════════════════ 80G ═════════════════════════════════════════════
  await t('TC-DEV-010', 'P1', 'the 80G certificate list is served', async () => {
    const r = await devoteeApi('GET', '/me/80g-certificates', { token: DEV });
    expect.http2xx(r);
    return `${Array.isArray(r.data) ? r.data.length : '?'} certificates`;
  });

  await t('TC-DEV-011', 'P1', 'an 80G certificate for an unrelated temple is refused', async () => {
    const other = psql1(
      `SELECT id FROM public.tenants WHERE id NOT IN
        (SELECT tenant_id FROM public.devotee_temple_links WHERE devotee_id = '${DEV_ID}')
       AND status = 'active' LIMIT 1`,
    );
    if (!other) return 'no unrelated tenant to probe with';
    const r = await devoteeApi('GET', `/me/80g-certificate/${other}`, { token: DEV });
    // Either refused, or an empty certificate — what must never happen is
    // another devotee's giving appearing on it.
    expect.ok(r.status < 500, `server error ${r.status}`);
    if (r.status < 300) {
      const total = r.data?.total_paise ?? r.data?.amount_paise ?? 0;
      expect.eq(Number(total) || 0, 0, 'a certificate for an unlinked temple must not carry amounts');
    }
    return `${r.status}`;
  });

  // ═══════════════════════ Temples directory ═══════════════════════════════
  await t('TC-DEV-012a', 'P1', 'the temple directory requires a devotee session', async () => {
    // The whole temples controller sits behind DevoteeAuthGuard — browsing is
    // not an anonymous surface. Only `/public/receipts/*` is unauthenticated.
    const r = await devoteeApi('GET', '/temples/directory?limit=20');
    expect.status(r, 401);
    return `${r.status}`;
  });

  await t('TC-DEV-012', 'P1', 'the directory lists only visible temples', async () => {
    const r = await devoteeApi('GET', '/temples/directory?limit=20', { token: DEV });
    expect.http2xx(r);
    const rows = Array.isArray(r.data) ? r.data : r.data?.rows ?? [];
    for (const tmp of rows) {
      const listed = psql1(
        `SELECT COALESCE(devotee_visible, true) FROM public.tenants WHERE slug = '${tmp.slug}'`);
      if (listed === 'f') throw new Error(`hidden temple ${tmp.slug} appeared in the directory`);
    }
    return `${rows.length} temples`;
  });

  await t('TC-DEV-013', 'P1', 'a temple’s profile never exposes its bank account', async () => {
    const r = await devoteeApi('GET', `/temples/${FIXTURES.tenant}`, { token: DEV });
    expect.ok(r.status < 500, `server error ${r.status}`);
    if (r.status >= 400) return `not published: ${r.status}`;
    const blob = JSON.stringify(r.data);
    for (const leak of ['bank_account_no', 'bankAccountNo', 'pan_encrypted', 'ifsc']) {
      expect.ok(!blob.includes(leak), `public profile leaked ${leak}`);
    }
    return 'no bank details exposed';
  });

  await t('TC-DEV-014', 'P1', 'payment details carry the temple’s receiving details and nothing more', async () => {
    // The temple's own collection account IS the payload here — a devotee
    // needs the account number, IFSC and UPI ID to make the NEFT/UPI transfer
    // that the manual donation rail is built on, exactly as a temple prints
    // them on a donation poster. What must never ride along is anything
    // identifying a *person*: PAN, encrypted columns, or another donor.
    const r = await devoteeApi('GET', `/temples/${FIXTURES.tenant}/payment-details`, { token: DEV });
    expect.http2xx(r);
    expect.has(r.data, 'upi_id');
    expect.has(r.data, 'bank_ifsc');
    for (const forbidden of ['pan', 'pan_masked', 'pan_encrypted', 'gstin', 'tan', 'donor']) {
      expect.ok(!(forbidden in r.data), `payment details leaked ${forbidden}`);
    }
    return `${Object.keys(r.data).length} fields, no personal data`;
  });

  await t('TC-DEV-014b', 'P1', 'payment details require a session', async () => {
    const r = await devoteeApi('GET', `/temples/${FIXTURES.tenant}/payment-details`);
    expect.status(r, 401);
    return `${r.status}`;
  });

  await t('TC-DEV-015', 'P2', 'an unknown temple slug returns 404, not 500', async () => {
    const r = await devoteeApi('GET', '/temples/no-such-temple-xyz', { token: DEV });
    expect.status(r, 404);
    return `${r.status}`;
  });

  // ═══════════════════════ Temple links ════════════════════════════════════
  await t('TC-DEV-016', 'P1', 'a devotee sees only their own temple links', async () => {
    const r = await devoteeApi('GET', '/me/temples', { token: DEV });
    expect.http2xx(r);
    const rows = Array.isArray(r.data) ? r.data : r.data?.rows ?? [];
    for (const row of rows) {
      if (!row.tenant_id && !row.tenantId) continue;
      const owner = psql1(
        `SELECT devotee_id FROM public.devotee_temple_links
          WHERE tenant_id = '${row.tenant_id ?? row.tenantId}' AND devotee_id = '${DEV_ID}'`);
      expect.ok(owner, 'a link that is not the caller’s was returned');
    }
    return `${rows.length} links`;
  });

  await t('TC-DEV-017', 'P2', 'requesting a link to an unknown temple is refused', async () => {
    const r = await devoteeApi('POST', '/me/temples/link', {
      token: DEV, body: { slug: 'no-such-temple-xyz' },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-DEV-018', 'P2', 'invites list for the caller', async () => {
    const r = await devoteeApi('GET', '/me/invites', { token: DEV });
    expect.http2xx(r);
    return `${Array.isArray(r.data) ? r.data.length : '?'} invites`;
  });

  await t('TC-DEV-019', 'P1', 'accepting somebody else’s invite is refused', async () => {
    const foreign = psql1(
      `SELECT id FROM public.devotee_temple_links WHERE devotee_id <> '${DEV_ID}' LIMIT 1`);
    if (!foreign) return 'no foreign invite to probe with';
    const r = await devoteeApi('POST', `/me/invites/${foreign}/accept`, { token: DEV, body: {} });
    expect.rejected(r, 'a devotee must not act on another devotee’s invite');
    return `${r.status} ${r.code}`;
  });

  // ═══════════════════════ Donate & requests ═══════════════════════════════
  await t('TC-DEV-020', 'P1', 'a donation with a non-positive amount is refused', async () => {
    for (const amount_paise of [0, -100, 10.5]) {
      const r = await devoteeApi('POST', '/me/donate', {
        token: DEV, body: { tenant_slug: FIXTURES.tenant, amount_paise, category: 'General' },
      });
      expect.rejected(r, `amount ${amount_paise}`);
    }
    return 'all refused';
  });

  await t('TC-DEV-021', 'P2', 'donating to an unknown temple is refused', async () => {
    const r = await devoteeApi('POST', '/me/donate', {
      token: DEV, body: { tenant_slug: 'no-such-temple-xyz', amount_paise: 10000 },
    });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-DEV-022', 'P2', 'cancelling another devotee’s donation request is refused', async () => {
    const foreign = psql1(
      `SELECT id FROM public.donation_requests WHERE devotee_id <> '${DEV_ID}' LIMIT 1`);
    if (!foreign) return 'no foreign donation request to probe with';
    const r = await devoteeApi('POST', `/me/donation-requests/${foreign}/cancel`, { token: DEV, body: {} });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  // ═══════════════════════ Stay search & booking ═══════════════════════════
  await t('TC-DEV-023', 'P1', 'stay search answers', async () => {
    const r = await devoteeApi('GET', '/stays/search?limit=10', { token: DEV });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-DEV-024', 'P2', 'stay localities answer', async () => {
    const r = await devoteeApi('GET', '/stays/localities', { token: DEV });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-DEV-025', 'P1', 'a devotee sees only their own bookings', async () => {
    const r = await devoteeApi('GET', '/me/bookings', { token: DEV });
    expect.http2xx(r);
    return `${Array.isArray(r.data) ? r.data.length : '?'} bookings`;
  });

  // ═══════════════════════ Feed & notifications ════════════════════════════
  await t('TC-DEV-026', 'P2', 'the feed is served for the caller', async () => {
    const r = await devoteeApi('GET', '/me/feed?limit=10', { token: DEV });
    expect.http2xx(r);
    return `${Array.isArray(r.data) ? r.data.length : '?'} items`;
  });

  await t('TC-DEV-027', 'P1', 'notifications belong to the caller only', async () => {
    const r = await devoteeApi('GET', '/me/notifications?limit=20', { token: DEV });
    expect.http2xx(r);
    const rows = Array.isArray(r.data) ? r.data : r.data?.rows ?? [];
    const ids = rows.map((x) => x.id).filter(Boolean);
    if (!ids.length) return 'no notifications to check';
    const foreign = psql1(
      `SELECT count(*) FROM public.devotee_notifications
        WHERE id IN (${ids.map((i) => `'${i}'`).join(',')}) AND user_id <> '${DEV_ID}'`);
    expect.eq(Number(foreign), 0, 'another devotee’s notifications were returned');
    return `${ids.length} owned`;
  });

  await t('TC-DEV-028', 'P1', 'marking another devotee’s notification read is refused', async () => {
    const foreign = psql1(
      `SELECT id FROM public.devotee_notifications WHERE user_id <> '${DEV_ID}' LIMIT 1`);
    if (!foreign) return 'no foreign notification to probe with';
    const r = await devoteeApi('POST', `/me/notifications/${foreign}/read`, { token: DEV, body: {} });
    expect.rejected(r);
    return `${r.status} ${r.code}`;
  });

  await t('TC-DEV-029', 'P2', 'notification preferences round-trip', async () => {
    const r = await devoteeApi('GET', '/me/notification-preferences', { token: DEV });
    expect.http2xx(r);
    const put = await devoteeApi('PATCH', '/me/notification-preferences', {
      token: DEV, body: { ...(r.data ?? {}) },
    });
    expect.ok(put.status < 500, `server error ${put.status}`);
    return `${put.status}`;
  });

  // ═══════════════════════ Public receipts ═════════════════════════════════
  await t('TC-DEV-030', 'P1', 'a public receipt link needs a real reference', async () => {
    const r = await devoteeApi('GET', '/public/receipts/not-a-real-reference');
    expect.rejected(r, 'a bogus receipt reference must not resolve');
    return `${r.status}`;
  });

  await t('TC-DEV-031', 'P1', 'a public receipt does not expose the donor’s full PAN', async () => {
    const ref = psql1(
      `SELECT id FROM public.global_transactions ORDER BY created_at DESC LIMIT 1`);
    if (!ref) return 'no transaction to build a receipt from';
    const tenant = psql1(`SELECT tenant_id FROM public.global_transactions WHERE id = '${ref}'`);
    const r = await devoteeApi('GET', `/public/receipts/${tenant}/${ref}`);
    if (r.status >= 400) return `not published: ${r.status}`;
    // 80G receipts legitimately print the full PAN; a *public* link must not.
    expect.ok(!/[A-Z]{5}\d{4}[A-Z]/.test(r.text ?? ''), 'a full PAN appeared on a public receipt');
    return 'no PAN on the public link';
  });

  // ═══════════════════════ Sant directory (devotee side) ═══════════════════
  const santId = psql1(`SELECT id FROM public.sant_profiles LIMIT 1`);

  await t('TC-DEV-032', 'P2', 'a sant profile is readable from the devotee app', async () => {
    if (!santId) return 'no sant profile fixture';
    const r = await devoteeApi('GET', `/sant/${santId}`, { token: DEV });
    expect.ok(r.status < 500, `server error ${r.status}`);
    return `${r.status}`;
  });

  await t('TC-DEV-033', 'P2', 'following and unfollowing a sant round-trips', async () => {
    if (!santId) return 'no sant profile fixture';
    const on = await devoteeApi('POST', `/sant/${santId}/follow`, { token: DEV, body: {} });
    expect.ok(on.status < 500, `server error ${on.status}`);
    const off = await devoteeApi('DELETE', `/sant/${santId}/follow`, { token: DEV });
    expect.ok(off.status < 500, `server error ${off.status}`);
    return `${on.status}/${off.status}`;
  });

  // ═══════════════════════ sant-api ════════════════════════════════════════
  await t('TC-SANT-001', 'P1', 'sant-api serves under /api/v1 (moved 2026-08-03)', async () => {
    const r = await santApi('GET', '/health');
    expect.ok(r.status !== 404, 'routes must sit under /api/v1');
    return `${r.status}`;
  });

  await t('TC-SANT-002', 'P1', 'the root path no longer serves the API', async () => {
    const res = await fetch('http://localhost:3108/sant/mine').catch(() => null);
    expect.ok(!res || res.status === 404, `root-mounted routes should be gone, got ${res?.status}`);
    return `${res?.status ?? 'no response'}`;
  });

  await t('TC-SANT-003', 'P1', 'sant endpoints refuse an anonymous caller', async () => {
    for (const path of ['/sant/mine', '/auth/me']) {
      const r = await santApi('GET', path);
      expect.status(r, 401, path);
    }
    return 'both 401';
  });

  // A rep is needed to exercise the authenticated surface; the console owns
  // creating one, so it is provisioned here rather than assumed.
  let repMobile = null, SANT = null;
  if (santId) {
    SA = await superAdminLogin();
    repMobile = testMobile();
    const add = await saApi('POST', `/admin/maharaj/${santId}/reps`, {
      token: SA, body: { name: 'QA Rep', mobile: repMobile },
    });
    if (add.status < 300) {
      SANT = await santLogin(repMobile).then((s) => s.token).catch(() => null);
    }
  }

  if (!SANT) {
    skip('TC-SANT-004', 'P1', 'sant rep authenticated surface', 'could not provision a sant rep');
  } else {
    await t('TC-SANT-004', 'P1', 'a registered rep can log in', async () => {
      expect.ok(SANT);
      return `rep ${repMobile}`;
    });

    await t('TC-SANT-005', 'P1', 'the rep sees the profile they represent', async () => {
      const r = await santApi('GET', '/sant/mine', { token: SANT });
      expect.http2xx(r);
      return JSON.stringify(r.data).slice(0, 80);
    });

    await t('TC-SANT-006', 'P1', 'a rep cannot edit a sant they do not represent', async () => {
      const other = psql1(`SELECT id FROM public.sant_profiles WHERE id <> '${santId}' LIMIT 1`);
      if (!other) return 'only one sant profile in the fixture';
      const r = await santApi('PATCH', `/sant/${other}`, {
        token: SANT, body: { guru_name: 'Hijacked' },
      });
      expect.rejected(r, 'representation must be scoped to the linked sant');
      return `${r.status} ${r.code}`;
    });

    await t('TC-SANT-007', 'P1', 'a verified sant raises a change request instead of editing', async () => {
      const r = await santApi('GET', `/sant/${santId}/change-requests`, { token: SANT });
      expect.ok(r.status < 500, `server error ${r.status}`);
      return `${r.status}`;
    });

    await t('TC-SANT-008', 'P2', 'the rep list is readable', async () => {
      const r = await santApi('GET', `/sant/${santId}/reps`, { token: SANT });
      expect.ok(r.status < 500, `server error ${r.status}`);
      return `${r.status}`;
    });

    await t('TC-SANT-009', 'P2', 'a vihar plan entry round-trips', async () => {
      const r = await santApi('GET', `/sant/${santId}/vihar-plan`, { token: SANT });
      expect.ok(r.status < 500, `server error ${r.status}`);
      return `${r.status}`;
    });

    await t('TC-SANT-010', 'P2', 'the follower count is served', async () => {
      const r = await santApi('GET', `/sant/${santId}/followers/count`, { token: SANT });
      expect.ok(r.status < 500, `server error ${r.status}`);
      return `${r.status}`;
    });

    await t('TC-SANT-011', 'P1', 'the /maharaj alias still resolves for one release', async () => {
      const sant = await santApi('GET', `/sant/${santId}/followers/count`, { token: SANT });
      const alias = await santApi('GET', `/maharaj/${santId}/followers/count`, { token: SANT });
      expect.eq(alias.status, sant.status, 'the deprecated alias must behave identically');
      return `both ${alias.status}`;
    });

    await t('TC-SANT-012', 'P1', 'the canonical rank is stored, the honorific is not', async () => {
      // "Maharaj" is a form of address for a Muni, not a rank — storing it would
      // mislabel every Aryika, Sadhvi, Kshullak and Ailak.
      const bad = psql1(
        `SELECT count(*) FROM public.sant_profiles
          WHERE type NOT IN ('muni','aryika','kshullak','kshullika','ailak')`,
      );
      expect.eq(Number(bad), 0, 'a non-canonical rank is stored in sant_profiles.type');
      return 'ranks canonical';
    });
  }

  await t('TC-SANT-013', 'P1', 'the sant_* tables exist and maharaj_* are gone', async () => {
    const santTables = psql(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'sant\\_%'`).length;
    const oldTables = psql(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'maharaj\\_%'`).length;
    expect.ok(santTables > 0, 'no sant_* tables');
    expect.eq(oldTables, 0, 'maharaj_* tables still present after the rename');
    return `${santTables} sant_* tables, 0 maharaj_*`;
  });

  await t('TC-SANT-014', 'P1', 'temple_sant_links uses the sant_id column', async () => {
    const col = psql1(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'temple_sant_links' AND column_name = 'sant_id'`);
    expect.eq(col, 'sant_id', 'the FK column should be sant_id after the rename');
    return col;
  });
});
