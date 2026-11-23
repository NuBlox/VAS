import { json } from '@sveltejs/kit';
import { SESSION_COOKIE, invalidateSession, sessionCookieOptions } from '#lib/server/runtime/auth.js';
import { env } from '$env/dynamic/private';
import { runtimeStatus } from '#lib/server/runtime/config.js';
export function POST(event) {
  const status=runtimeStatus(event,env);
  if (!status.enabled || event.request.headers.get('origin') !== event.url.origin)
    return json({error:'Local runtime and same-origin requests required'}, {status:403});
  invalidateSession(event.cookies.get(SESSION_COOKIE));
  event.cookies.delete(SESSION_COOKIE,sessionCookieOptions(event,0));
  return json({signedOut:true},{headers:{'cache-control':'no-store'}});
}
