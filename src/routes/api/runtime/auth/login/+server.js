import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { runtimeStatus, readPayload, publicError } from '#lib/server/runtime/config.js';
import { SESSION_COOKIE, readLocalUsers, authenticateCredentials, createSession, sessionCookieOptions, isLoginAllowed, recordLoginFailure, clearLoginFailures, invalidateSession } from '#lib/server/runtime/auth.js';
export async function POST(event) {
  try {
    const status = runtimeStatus(event,env);
    if (!status.enabled || !status.authConfigured) return json({error:'Local runtime or user credentials are not configured'}, {status:503});
    if (event.request.headers.get('origin') !== event.url.origin) return json({error:'Same-origin request required'}, {status:403});
    const address = event.getClientAddress();
    if (!isLoginAllowed(address)) return json({error:'Too many sign-in attempts; retry later'}, {status:429});
    const body=await readPayload(event.request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['id','password'].includes(k)) ||
        typeof body.id !== 'string' || typeof body.password !== 'string' || body.id.length>64 || body.password.length>1024)
      return json({error:'Invalid credentials'}, {status:401});
    const user=authenticateCredentials(readLocalUsers(),body.id,body.password);
    if (!user) { recordLoginFailure(address); return json({error:'Invalid credentials'}, {status:401}); }
    clearLoginFailures(address);
    invalidateSession(event.cookies.get(SESSION_COOKIE));
    const session=createSession(user.id);
    event.cookies.set(SESSION_COOKIE,session.token,sessionCookieOptions(event,session.maxAge));
    return json({actor:{id:user.id,role:user.role}}, {headers:{'cache-control':'no-store'}});
  } catch(error) { return publicError(error); }
}
