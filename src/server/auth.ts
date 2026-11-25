import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface VerifiedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

let cachedProjectId: string | null = null;

function getFirebaseProjectId(): string | null {
  if (cachedProjectId !== null) return cachedProjectId;
  const envProjectId = (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    ''
  ).trim();
  if (envProjectId) {
    cachedProjectId = envProjectId;
    return cachedProjectId;
  }
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(cfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
    if (!raw.projectId || raw.projectId === 'remixed-project-id') return null;
    cachedProjectId = raw.projectId;
    return cachedProjectId;
  } catch {
    return null;
  }
}

function getAdminAuth() {
  const projectId = getFirebaseProjectId();
  if (!projectId) return null;
  const app = getApps().length ? getApp() : initializeApp({ projectId });
  return getAuth(app);
}

/**
 * Verifies a Bearer Firebase ID token using verifyIdToken(token) (requires no IAM).
 */
export async function verifyBearerUser(req: Request): Promise<VerifiedUser | null> {
  const authHeader = req.header('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const adminAuth = getAdminAuth();
  if (!adminAuth) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email || null,
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch {
    return null;
  }
}

export interface AuthenticatedRequest extends Request {
  user?: VerifiedUser;
}

export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  req.user = (await verifyBearerUser(req)) || undefined;
  next();
}

export async function requireAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const user = await verifyBearerUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in with Google first.' });
    return;
  }
  req.user = user;
  next();
}
