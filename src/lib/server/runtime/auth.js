/** Local-development authentication only. This never enables production hosting. */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RecordError } from '../../studio/records.js';

export const SESSION_COOKIE = 'vas_local_session';
export const ROLE_ORDER = Object.freeze({ viewer: 0, editor: 1, admin: 2 });
const SESSION_MS = 4 * 60 * 60 * 1000;
const SESSIONS = new Map();
const LOGIN_ATTEMPTS = new Map();
const LOGIN_LIMIT = 6;
const LOGIN_WINDOW = 60_000;
const LOGIN_LOCK = 5 * 60_000;
const MAX_SESSIONS = 128;
const MAX_ATTEMPT_KEYS = 1024;
const usernamePattern = /^[a-z][a-z0-9_-]{2,63}$/;

function bytes(value) { return Buffer.from(value, 'base64url'); }
function digest(token) { return createHash('sha256').update(token).digest('hex'); }
export function hashPassword(password, salt = randomBytes(24).toString('base64url')) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 1024) throw new Error('Password must be between 14 and 1024 characters');
  const hash = scryptSync(password, bytes(salt), 64, { N: 16384, r: 8, p: 1 }).toString('base64url');
  return `scrypt$16384$8$1$${salt}$${hash}`;
}
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 1024 || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' || parts[2] !== '8' || parts[3] !== '1') return false;
  try {
    const salt = bytes(parts[4]); const expected = bytes(parts[5]);
    if (salt.length !== 24 || expected.length !== 64) return false;
    const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}
export function validateUsers(users) {
  if (!Array.isArray(users) || users.length < 1 || users.length > 20) throw new Error('Local user file must contain 1–20 users');
  const seen = new Set();
  return users.map(user => {
    if (!user || typeof user !== 'object' || Array.isArray(user) ||
        Object.keys(user).some(key => !['id', 'role', 'passwordHash'].includes(key)) ||
        !usernamePattern.test(user.id) || !Object.hasOwn(ROLE_ORDER, user.role) ||
        typeof user.passwordHash !== 'string' || !/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{32}\$[A-Za-z0-9_-]{86}$/.test(user.passwordHash) ||
        seen.has(user.id)) throw new Error('Invalid local user entry');
    seen.add(user.id);
    return {id:user.id, role:user.role, passwordHash:user.passwordHash};
  });
}
export function readLocalUsers(filePath = resolve(process.cwd(), '.vas/users.local.json')) {
  try { return validateUsers(JSON.parse(readFileSync(filePath, 'utf8'))); }
  catch { return null; } // fail closed, including malformed or missing files
}
export function requireRole(actor, minimum) {
  if (!actor) throw new RecordError('Sign in to use the local MySQL runtime', 401);
  if (!Object.hasOwn(ROLE_ORDER, minimum) || ROLE_ORDER[actor.role] < ROLE_ORDER[minimum]) throw new RecordError('Insufficient runtime permissions', 403);
  return actor;
}
export function canExecuteWorkflow(actor, workflow) {
  const required = workflow.steps.some(step => step.type === 'delete') ? 'admin' :
    workflow.steps.some(step => ['create', 'update'].includes(step.type)) ? 'editor' : 'viewer';
  return requireRole(actor, required);
}
function prune(now) {
  for (const [id, session] of SESSIONS) if (session.expiresAt <= now) SESSIONS.delete(id);
  for (const [key, state] of LOGIN_ATTEMPTS) if (state.lockUntil <= now && state.windowEnd <= now) LOGIN_ATTEMPTS.delete(key);
}
export function isLoginAllowed(address, now = Date.now()) {
  prune(now);
  const state = LOGIN_ATTEMPTS.get(address);
  return !state || state.lockUntil <= now;
}
export function recordLoginFailure(address, now = Date.now()) {
  prune(now);
  const current = LOGIN_ATTEMPTS.get(address);
  const state = !current || current.windowEnd <= now ? { count: 0, windowEnd: now + LOGIN_WINDOW, lockUntil: 0 } : current;
  state.count += 1;
  if (state.count >= LOGIN_LIMIT) state.lockUntil = now + LOGIN_LOCK;
  if (LOGIN_ATTEMPTS.size >= MAX_ATTEMPT_KEYS && !LOGIN_ATTEMPTS.has(address)) LOGIN_ATTEMPTS.delete(LOGIN_ATTEMPTS.keys().next().value);
  LOGIN_ATTEMPTS.set(address, state);
}
export function clearLoginFailures(address) { LOGIN_ATTEMPTS.delete(address); }
export function createSession(userId, now = Date.now()) {
  prune(now);
  if (SESSIONS.size >= MAX_SESSIONS) SESSIONS.delete(SESSIONS.keys().next().value);
  const token = randomBytes(32).toString('base64url');
  SESSIONS.set(digest(token), {userId, expiresAt: now + SESSION_MS});
  return { token, maxAge: SESSION_MS / 1000 };
}
export function invalidateSession(token) { if (typeof token === 'string') SESSIONS.delete(digest(token)); }
export function resolveSession(token, users, now = Date.now()) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || !users) return null;
  const stored = SESSIONS.get(digest(token));
  if (!stored) return null;
  if (stored.expiresAt <= now) { invalidateSession(token); return null; }
  const user = users.find(item => item.id === stored.userId);
  if (!user) { invalidateSession(token); return null; }
  return {id:user.id, role:user.role};
}
export function currentActor(event, users = readLocalUsers()) {
  return resolveSession(event.cookies?.get(SESSION_COOKIE), users);
}
export function sessionCookieOptions(event, maxAge) {
  return {path:'/api/runtime',httpOnly:true,sameSite:'strict',secure:event.url.protocol==='https:',maxAge};
}
export function authenticateCredentials(users, id, password) {
  // Compute an expensive fallback hash for non-existing IDs to avoid a trivial timing oracle.
  const fallback = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$' + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const user = users?.find(item => item.id === id);
  return verifyPassword(password, user?.passwordHash ?? fallback) ? user : null;
}
