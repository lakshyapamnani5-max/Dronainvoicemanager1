import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';
import { generateId, generateToken, sha256 } from './cryptoUtils.ts';
import type { ImpersonationSession, UserRecord } from '../src/shared/types.ts';

export interface AuthContext {
  sessionId: string;
  actorUser: UserRecord;
  effectiveUser: UserRecord;
  isImpersonating: boolean;
  impersonationSession: ImpersonationSession | null;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

interface RawUserRow {
  uid: string;
  email: string;
  password_hash: string;
  role: 'super_admin' | 'business';
  status: 'active' | 'inactive';
  owner_name: string;
  business_name: string;
  phone: string;
  gstin: string;
  subscription_plan: string;
  subscription_amount: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export function mapUserRow(row: RawUserRow): UserRecord {
  return {
    uid: row.uid,
    email: row.email,
    role: row.role,
    status: row.status,
    ownerName: row.owner_name,
    businessName: row.business_name,
    phone: row.phone,
    gstin: row.gstin,
    subscriptionPlan: row.subscription_plan,
    subscriptionAmount: row.subscription_amount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export function createSession(userUid: string, ttlHours = 24): { token: string; sessionId: string; expiresAt: string } {
  const token = generateToken(32);
  const tokenHash = sha256(token);
  const sessionId = generateId('ses');
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO sessions (id, token_hash, user_uid, expires_at, created_at, revoked)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(sessionId, tokenHash, userUid, expires.toISOString(), now.toISOString());

  return { token, sessionId, expiresAt: expires.toISOString() };
}

export function revokeSessionByToken(token: string): void {
  if (!token) return;
  db.prepare('UPDATE sessions SET revoked = 1 WHERE token_hash = ?').run(sha256(token));
}

export function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const val = header.slice(7).trim();
    if (val) return val;
  }
  const cookieToken = req.cookies?.drona_session;
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const tokenHash = sha256(token);
  const sessionRow = db
    .prepare(
      `SELECT id, user_uid, impersonating_uid, impersonation_session_id, expires_at, revoked
       FROM sessions WHERE token_hash = ?`
    )
    .get(tokenHash) as
    | {
        id: string;
        user_uid: string;
        impersonating_uid: string | null;
        impersonation_session_id: string | null;
        expires_at: string;
        revoked: number;
      }
    | undefined;

  if (!sessionRow || sessionRow.revoked === 1) {
    res.status(401).json({ error: 'Session invalid or expired' });
    return;
  }

  if (new Date(sessionRow.expires_at).getTime() <= Date.now()) {
    db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(sessionRow.id);
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  const actorRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(sessionRow.user_uid) as
    | RawUserRow
    | undefined;

  if (!actorRow) {
    res.status(401).json({ error: 'Account not found' });
    return;
  }

  if (actorRow.status !== 'active') {
    res.status(403).json({ error: 'Account is deactivated. Contact Drona Admin.' });
    return;
  }

  const actorUser = mapUserRow(actorRow);
  let effectiveUser = actorUser;
  let isImpersonating = false;
  let impersonationSession: ImpersonationSession | null = null;

  if (sessionRow.impersonating_uid && sessionRow.impersonation_session_id) {
    if (actorUser.role !== 'super_admin') {
      db.prepare(
        'UPDATE sessions SET impersonating_uid = NULL, impersonation_session_id = NULL WHERE id = ?'
      ).run(sessionRow.id);
      res.status(403).json({ error: 'Unauthorized impersonation state' });
      return;
    }

    const impRow = db
      .prepare('SELECT * FROM impersonation_sessions WHERE id = ? AND active = 1')
      .get(sessionRow.impersonation_session_id) as
      | {
          id: string;
          admin_uid: string;
          admin_email: string;
          target_uid: string;
          target_business_name: string;
          started_at: string;
          expires_at: string;
          ended_at: string | null;
          active: number;
        }
      | undefined;

    if (!impRow || new Date(impRow.expires_at).getTime() <= Date.now()) {
      if (impRow) {
        db.prepare('UPDATE impersonation_sessions SET active = 0, ended_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          impRow.id
        );
      }
      db.prepare(
        'UPDATE sessions SET impersonating_uid = NULL, impersonation_session_id = NULL WHERE id = ?'
      ).run(sessionRow.id);
    } else {
      const targetRow = db
        .prepare('SELECT * FROM users WHERE uid = ? AND role = ?')
        .get(sessionRow.impersonating_uid, 'business') as RawUserRow | undefined;

      if (targetRow) {
        effectiveUser = mapUserRow(targetRow);
        isImpersonating = true;
        impersonationSession = {
          id: impRow.id,
          adminUid: impRow.admin_uid,
          adminEmail: impRow.admin_email,
          targetUid: impRow.target_uid,
          targetBusinessName: impRow.target_business_name,
          startedAt: impRow.started_at,
          expiresAt: impRow.expires_at,
          endedAt: impRow.ended_at,
          active: true,
        };
      }
    }
  }

  req.auth = {
    sessionId: sessionRow.id,
    actorUser,
    effectiveUser,
    isImpersonating,
    impersonationSession,
  };

  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.auth.actorUser.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden: Drona Admin privilege required' });
    return;
  }
  next();
}

export function requireTenantWorkspace(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.auth.effectiveUser.role !== 'business') {
    res.status(403).json({
      error: 'A business workspace is required. Use Login as Customer to inspect a tenant.',
    });
    return;
  }
  next();
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (bucket.count >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    bucket.count += 1;
    next();
  };
}
