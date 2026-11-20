// Test login: in-memory Redis + a valid session cookie for the seeded admin.
import { installFakeKv } from "../scripts/fake-kv.js";
import { signSession } from "../lib/session.js";

export const TEST_PASSWORD = "test-pass-123";

export function useFakeAuth() {
  process.env.INITIAL_PASSWORD = TEST_PASSWORD;
  return installFakeKv(); // also sets KV_REST_API_TOKEN, which signs sessions
}

/** Cookie header for a seeded user (nastia = admin, eden / noam = members). */
export async function cookieFor(id = "nastia", v = 1) {
  const token = await signSession({ u: id, v, exp: Math.floor(Date.now() / 1000) + 3600 }, process.env.KV_REST_API_TOKEN);
  return `tke_s=${token}`;
}
