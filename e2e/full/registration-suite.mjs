/**
 * Functional E2E suite for self-serve Trust/Temple registration.
 *
 * Drives the live superadmin-api (:3105) public onboarding API end to end:
 *   register → verify mobile → choose plan → checkout → verify payment
 *   → auto-provision → invoice → log in to mandir-api with the new mobile.
 *
 * Also covers the negative paths that matter, because they are the ones a
 * customer's money depends on:
 *   - checkout refused before the mobile is verified
 *   - a forged/absent claim token cannot read or change a draft
 *   - a tampered plan/module request cannot buy Enterprise modules on Standard
 *   - a bad signature is refused
 *   - re-verifying the same payment is idempotent (no second tenant)
 *   - a paid registration is frozen against edits
 *   - Custom plan raises a lead, never a tenant
 *
 *   node e2e/full/registration-suite.mjs
 *
 * Requires: superadmin-api on :3105 and mandir-api on :3106, OTP_MOCK=true,
 * and NO Razorpay keys configured (so checkout runs in mock mode).
 * Exit 1 if any P1 fails.
 */
const SA = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';
const MANDIR = process.env.E2E_API ?? 'http://localhost:3106/api/v1';
const ONBOARD = `${SA}/public/onboarding`;

// A fresh mobile per run: registering the same number twice is legal (one
// person can administer several trusts), but a stable number would accumulate
// memberships and make the login assertion ambiguous.
const RUN = Date.now().toString().slice(-8);
const MOBILE = `98${RUN}`;
const TRUST_NAME = `E2E Test Trust ${RUN}`;

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${ok ? 'PASS' : 'FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function http(base, method, path, { body, token, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-registration-token': token } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* HTML invoice, or empty */ }
  return { status: res.status, json, data: json?.data, code: json?.error?.code };
}

const ob = (method, path, opts) => http(ONBOARD, method, path, opts);

async function main() {
  console.log(`\nSelf-serve registration E2E — trust "${TRUST_NAME}", mobile ${MOBILE}\n`);

  // ---------------------------------------------------------------- catalogue
  const cat = await ob('GET', '/plans');
  const plans = cat.data?.plans ?? [];
  record('REG-01', 'P1', 'Public plan catalogue is served', cat.status === 200 && plans.length > 0,
    `${plans.length} plans`);

  const standard = plans.find((p) => p.name === 'standard');
  const enterprise = plans.find((p) => p.name === 'enterprise');
  const custom = plans.find((p) => p.is_custom);

  record('REG-02', 'P1', 'Standard is published and pooled',
    !!standard && standard.tenancy_tier === 'pooled', standard?.tenancy_tier);
  record('REG-03', 'P1', 'Enterprise is published and DEDICATED',
    !!enterprise && enterprise.tenancy_tier === 'dedicated', enterprise?.tenancy_tier);
  record('REG-04', 'P1', 'Standard grants NO enterprise modules',
    !!standard && (standard.modules ?? []).length === 0,
    `modules: ${(standard?.modules ?? []).map((m) => m.key).join(',') || 'none'}`);
  record('REG-05', 'P1', 'Enterprise grants dharamshala + gaushala',
    !!enterprise && ['dharamshala', 'gaushala'].every((k) => (enterprise.modules ?? []).some((m) => m.key === k)));
  record('REG-06', 'P2', 'Custom plan exists and is quote-only', !!custom && custom.is_custom === true);
  record('REG-07', 'P1', 'Prices come with GST already computed',
    !!standard && standard.pricing?.yearly?.total_paise ===
      standard.pricing.yearly.subtotal_paise + standard.pricing.yearly.gst_amount_paise);

  // -------------------------------------------------------------- registration
  const created = await ob('POST', '/registrations', {
    body: {
      trust_name: TRUST_NAME,
      temple_type: 'jain',
      sect: 'digambar',
      address: { line1: '1 Test Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      admin_name: 'E2E Admin',
      admin_mobile: MOBILE,
      admin_email: `e2e${RUN}@example.com`,
      pan: 'AAAAA1111A',
      source: 'website',
    },
  });
  const regId = created.data?.id;
  const token = created.data?.claim_token;
  record('REG-08', 'P1', 'Registration created with a claim token',
    created.status === 201 && !!regId && !!token, created.data?.reference);
  if (!regId || !token) {
    return finish('cannot continue without a registration');
  }

  // A non-Jain trust must not be allowed a Jain sampradaya — same guard the
  // console has, and the reason the row would otherwise be self-contradictory.
  const badSect = await ob('POST', '/registrations', {
    body: {
      trust_name: `${TRUST_NAME} bad`, temple_type: 'hindu', sect: 'digambar',
      admin_name: 'X', admin_mobile: `97${RUN}`,
    },
  });
  record('REG-09', 'P2', 'A non-Jain trust cannot carry a sampradaya',
    badSect.status === 400 && badSect.code === 'SECT_NOT_APPLICABLE', badSect.code);

  // ------------------------------------------------------------ claim token
  const noToken = await ob('GET', `/registrations/${regId}`);
  record('REG-10', 'P1', 'A draft cannot be read without the claim token',
    noToken.status === 403 || noToken.status === 404, `HTTP ${noToken.status}`);

  const forged = await ob('GET', `/registrations/${regId}`, { token: 'rct_forged_token' });
  record('REG-11', 'P1', 'A forged claim token is refused (and cannot probe existence)',
    forged.status === 404, `HTTP ${forged.status} ${forged.code ?? ''}`);

  // --------------------------------------------------------- checkout gating
  const earlyPlan = await ob('POST', `/registrations/${regId}/plan`, {
    token, body: { plan: 'standard', billing_cycle: 'yearly' },
  });
  record('REG-12', 'P1', 'A plan can be chosen before verification', earlyPlan.status === 200);

  const earlyCheckout = await ob('POST', `/registrations/${regId}/checkout`, { token });
  record('REG-13', 'P1', 'Checkout is REFUSED before the mobile is verified',
    earlyCheckout.status === 400 && earlyCheckout.code === 'MOBILE_NOT_VERIFIED', earlyCheckout.code);

  // ------------------------------------------------------------------- OTP
  const sent = await ob('POST', `/registrations/${regId}/send-otp`, { token });
  const otp = sent.data?.dev_otp;
  record('REG-14', 'P1', 'OTP sent (dev mode returns it)', sent.status === 200 && !!otp);
  if (!otp) return finish('OTP_MOCK must be true for this suite');

  const badOtp = await ob('POST', `/registrations/${regId}/verify-otp`, { token, body: { otp: '000000' } });
  record('REG-15', 'P1', 'A wrong OTP is refused',
    badOtp.status === 400 && badOtp.code === 'OTP_INVALID', badOtp.code);

  const verified = await ob('POST', `/registrations/${regId}/verify-otp`, { token, body: { otp } });
  record('REG-16', 'P1', 'Correct OTP verifies the mobile',
    verified.status === 200 && verified.data?.mobile_verified === true);

  // ------------------------------------------------- module tampering defence
  // Ask for Enterprise modules while buying Standard. The server intersects the
  // request with the plan's own entitlement, so this must yield nothing extra.
  const tampered = await ob('POST', `/registrations/${regId}/plan`, {
    token,
    body: { plan: 'standard', billing_cycle: 'yearly', modules: ['dharamshala', 'gaushala', 'bhojanshala'] },
  });
  record('REG-17', 'P1', 'Enterprise modules CANNOT be bought on a Standard checkout',
    tampered.status === 200 && (tampered.data?.modules ?? []).length === 0,
    `granted: ${(tampered.data?.modules ?? []).join(',') || 'none'}`);

  // The server prices it — the client never sends an amount.
  const quote = tampered.data?.quote;
  const expected = standard.pricing.yearly;
  record('REG-18', 'P1', 'The server prices the plan from public.plans',
    quote?.subtotal_paise === expected.subtotal_paise && quote?.total_paise === expected.total_paise,
    `${quote?.total_paise} vs ${expected.total_paise}`);
  record('REG-19', 'P1', 'total = subtotal − discount + charges + GST',
    quote?.total_paise ===
      quote.subtotal_paise - quote.discount_paise + quote.additional_charges_paise + quote.gst_amount_paise);

  // --------------------------------------------------------------- checkout
  const checkout = await ob('POST', `/registrations/${regId}/checkout`, { token });
  const order = checkout.data?.checkout;
  record('REG-20', 'P1', 'Checkout opens an order for the quoted amount',
    checkout.status === 200 && order?.amount_paise === quote.total_paise, order?.razorpay_order_id);
  if (!order?.mock) {
    record('REG-21', 'P1', 'Suite requires MOCK mode (no Razorpay keys)', false,
      'real keys configured — refusing to drive a live payment');
    return finish('configure the suite against a keyless dev API');
  }

  const badSig = await ob('POST', `/registrations/${regId}/verify-payment`, {
    token,
    body: { razorpay_order_id: 'order_not_ours', razorpay_payment_id: 'pay_x', razorpay_signature: 'nope' },
  });
  record('REG-22', 'P1', 'An unverifiable payment signature is refused',
    badSig.status === 400, `${badSig.code}`);

  // ---------------------------------------------------- pay → auto-onboarding
  const paid = await ob('POST', `/registrations/${regId}/verify-payment`, {
    token,
    body: {
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: `pay_mock_${RUN}`,
      razorpay_signature: 'mock',
    },
  });
  record('REG-23', 'P1', 'Verified payment onboards the trust automatically',
    paid.status === 200 && paid.data?.status === 'active' && !!paid.data?.tenant_id,
    `status=${paid.data?.status} tenant=${paid.data?.tenant_slug ?? 'none'}`);

  const tenantId = paid.data?.tenant_id;

  // Idempotency: replaying the same verification must not create a 2nd tenant.
  const replay = await ob('POST', `/registrations/${regId}/verify-payment`, {
    token,
    body: {
      razorpay_order_id: order.razorpay_order_id,
      razorpay_payment_id: `pay_mock_${RUN}`,
      razorpay_signature: 'mock',
    },
  });
  record('REG-24', 'P1', 'Re-verifying the same payment is idempotent',
    replay.status === 200 && replay.data?.tenant_id === tenantId);

  // A paid registration is frozen — otherwise a ₹999 Standard order could be
  // edited into an Enterprise one after the money was taken.
  const frozen = await ob('PATCH', `/registrations/${regId}`, {
    token,
    body: { trust_name: 'Hijacked Trust', admin_name: 'X', admin_mobile: MOBILE },
  });
  record('REG-25', 'P1', 'A paid registration cannot be edited',
    frozen.status === 409 && frozen.code === 'REGISTRATION_LOCKED', frozen.code);

  // ---------------------------------------------------------------- invoice
  const invRes = await fetch(
    `${ONBOARD}/registrations/${regId}/invoice?token=${encodeURIComponent(token)}`,
  );
  const html = await invRes.text();
  record('REG-26', 'P1', 'The tax invoice renders', invRes.status === 200 && html.includes('TAX INVOICE'));
  record('REG-27', 'P1', 'Invoice shows the trust AND its contact person',
    html.includes(TRUST_NAME) && html.includes('E2E Admin'));
  record('REG-28', 'P1', 'Invoice shows the payment method, Order ID and Payment ID',
    html.includes('Payment Method') && html.includes(order.razorpay_order_id) && html.includes(`pay_mock_${RUN}`));
  record('REG-29', 'P1', 'Invoice carries a RECEIPT number (money received)', /RCPT\/\d{4}-\d{2}\//.test(html));
  record('REG-30', 'P1', 'Invoice shows the plan actually bought, not the current one',
    html.includes('Standard') && !html.includes('>Enterprise<'));
  record('REG-31', 'P2', 'Invoice states the mobile it was billed to', html.includes(MOBILE));

  // ------------------------------------------------------ login as the admin
  const send = await fetch(`${MANDIR}/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile: MOBILE, purpose: 'login' }),
  }).then((r) => r.json());
  const loginOtp = send?.data?.dev_otp;
  record('REG-32', 'P1', 'The registered mobile can request a login OTP', !!loginOtp);

  if (loginOtp) {
    const ver = await fetch(`${MANDIR}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: MOBILE, otp: loginOtp }),
    }).then((r) => r.json());
    const choices = ver?.data?.tenants ?? [];
    const mine = choices.find((c) => c.name === TRUST_NAME);
    record('REG-33', 'P1', 'The new Mandir appears in the login picker as temple_admin',
      !!mine && (mine.roles ?? []).includes('temple_admin'), mine?.slug);

    if (ver?.data?.selection_token && mine) {
      const sel = await fetch(`${MANDIR}/auth/select-tenant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection_token: ver.data.selection_token, tenant_slug: mine.slug }),
      }).then((r) => r.json());
      const accessToken = sel?.data?.access_token;
      const modules = sel?.data?.effective_modules ?? [];
      record('REG-34', 'P1', 'Sign-in succeeds and returns a session', !!accessToken);

      // The whole point of the Standard tier: enterprise modules are NOT granted.
      record('REG-35', 'P1', 'A Standard mandir does NOT hold dharamshala/gaushala',
        !modules.includes('dharamshala') && !modules.includes('gaushala'),
        `modules: ${modules.join(',')}`);

      // ...and the API enforces it, not just the sidebar.
      if (accessToken) {
        const blocked = await fetch(`${MANDIR}/room-bookings`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const body = await blocked.json().catch(() => null);
        record('REG-36', 'P1', 'The API 403s an ungranted module (not just the UI hiding it)',
          blocked.status === 403 && body?.error?.code === 'MODULE_NOT_ENABLED',
          `HTTP ${blocked.status} ${body?.error?.code ?? ''}`);

        const core = await fetch(`${MANDIR}/donations?limit=1`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        record('REG-37', 'P1', 'Core modules ARE reachable on Standard', core.status === 200,
          `HTTP ${core.status}`);
      }
    }
  }

  // ------------------------------------------------------------ custom plan
  const cr = await ob('POST', '/custom-requests', {
    body: {
      trust_name: `${TRUST_NAME} Group`,
      contact_name: 'E2E Custom',
      mobile: `96${RUN}`,
      modules: ['dharamshala', 'gaushala'],
      num_mandirs: 5,
      needs_separate_dbs: true,
      special_requirements: 'We have 5 Mandirs and require a centralized system.',
    },
  });
  record('REG-38', 'P1', 'Custom requirements are accepted as a lead',
    cr.status === 201 && !!cr.data?.reference, cr.data?.reference);
  record('REG-39', 'P1', 'The Custom plan cannot be paid for online',
    (await ob('POST', `/registrations/${regId}/plan`, { token, body: { plan: 'custom' } })).status !== 200);

  finish();
}

function finish(fatal) {
  if (fatal) console.log(`\n  ABORTED: ${fatal}`);
  const failed = results.filter((r) => !r.ok);
  const p1 = failed.filter((r) => r.pri === 'P1');
  console.log(`\n  ${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — ${failed.length} failed (${p1.length} P1)` : ''));
  process.exit(p1.length || fatal ? 1 : 0);
}

main().catch((e) => {
  console.error('\n  SUITE ERROR:', e.message);
  process.exit(1);
});
