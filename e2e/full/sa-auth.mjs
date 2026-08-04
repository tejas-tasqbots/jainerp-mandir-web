/**
 * Shared super-admin login for the e2e suites.
 *
 * Super Admin auth is password + TOTP, and `/admin/auth/mfa/setup` only hands
 * back an otpauth_uri while the account is *un*-enrolled — enrolment is
 * one-shot. That made every suite after the first one in a run fail with
 * "mfa/setup returned no secret", so suites were not independently runnable.
 *
 * Caching the secret was not enough either: `mfaSetup` rotates
 * `totp_secret_enc` on every successful call, so as soon as anything re-enrols
 * the account (another suite, a reseed, the superadmin-web suite) a cached
 * secret silently stops matching and login fails with "Invalid MFA code".
 *
 * So instead of guessing at the stored secret, each login **clears the QA
 * account's TOTP first** and then walks the normal enrolment flow. That makes
 * every suite independently runnable in any order, with no reseed needed
 * between them. It only ever touches the dedicated QA account on the local dev
 * database.
 */
import { execFileSync } from 'node:child_process';
import { authenticator } from '../../../superadmin-web/node_modules/otplib/index.js';

export const QA_ID = 'qa-tester@tasqbots.com';
export const QA_PASSWORD = 'QaTest@12345';

const PG_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'jainerp-superadmin-pg';
const PG_DB = process.env.E2E_PG_DB ?? 'jainerp';
const PG_USER = process.env.E2E_PG_USER ?? 'jainerp';

/**
 * Put the QA super-admin back in the "never enrolled" state so `mfa/setup`
 * issues a fresh secret we actually know. Also clears any lockout left by a
 * previous run's failed codes.
 */
function clearQaTotp() {
  const sql = `UPDATE public.super_admin_credentials c
                  SET totp_secret_enc = NULL,
                      totp_enrolled_at = NULL,
                      recovery_codes_hash = '{}',
                      recovery_codes_used = 0,
                      failed_attempts = 0,
                      locked_until = NULL
                 FROM public.global_users u
                WHERE u.id = c.global_user_id AND u.email = '${QA_ID}'`;
  try {
    execFileSync('docker', ['exec', PG_CONTAINER, 'psql', '-U', PG_USER, '-d', PG_DB, '-tAc', sql], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    // No docker/psql here — fall through and hope the account is un-enrolled.
    return false;
  }
}

/**
 * @param {(method: string, path: string, opts?: object) => Promise<{data?: any, json?: any}>} sa
 *        request helper bound to the superadmin-api base URL
 * @returns {Promise<string>} a super-admin access token
 */
export async function superAdminLogin(sa) {
  const reset = clearQaTotp();

  const login = await sa('POST', '/admin/auth/login', {
    body: { identifier: QA_ID, password: QA_PASSWORD },
  });
  const mfaToken = login.data?.mfa_token;
  if (!mfaToken) throw new Error(`SA login failed: ${JSON.stringify(login.json)}`);

  const setup = await sa('POST', '/admin/auth/mfa/setup', { body: { mfa_token: mfaToken } });
  const secret = setup.data?.otpauth_uri?.match(/secret=([A-Z0-9]+)/)?.[1];
  if (!secret) {
    throw new Error(
      `mfa/setup returned no secret${reset ? '' : ' (could not clear TOTP — is the postgres container running?)'}` +
        ` — re-run seed-qa-tester.ts: ${JSON.stringify(setup.json)}`,
    );
  }

  const verify = await sa('POST', '/admin/auth/mfa/verify', {
    body: { mfa_token: mfaToken, type: 'totp', code: authenticator.generate(secret) },
  });
  if (!verify.data?.access_token) {
    throw new Error(`SA mfa/verify failed: ${JSON.stringify(verify.json)} — re-run seed-qa-tester.ts`);
  }
  return verify.data.access_token;
}
