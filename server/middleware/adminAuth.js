import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'lumina-admin-vault-secure-signing-key-92847291';

export const ADMIN_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  OPERATIONS_AGENT: 'OPERATIONS_AGENT',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
  FINANCE_ADMIN: 'FINANCE_ADMIN',
  READ_ONLY_ADMIN: 'READ_ONLY_ADMIN',
};

export const PERMISSIONS = {
  VIEW_TELEMETRY: 'VIEW_TELEMETRY',
  VIEW_USERS: 'VIEW_USERS',
  MANAGE_USERS: 'MANAGE_USERS',
  VIEW_EVENTS: 'VIEW_EVENTS',
  BREAK_GLASS_EVENT: 'BREAK_GLASS_EVENT',
  VIEW_JOBS: 'VIEW_JOBS',
  MANAGE_JOBS: 'MANAGE_JOBS',
  VIEW_STORAGE: 'VIEW_STORAGE',
  RECONCILE_STORAGE: 'RECONCILE_STORAGE',
  VIEW_BILLING: 'VIEW_BILLING',
  MANAGE_BILLING: 'MANAGE_BILLING',
  VIEW_SUPPORT: 'VIEW_SUPPORT',
  MANAGE_SUPPORT: 'MANAGE_SUPPORT',
  VIEW_INCIDENTS: 'VIEW_INCIDENTS',
  MANAGE_INCIDENTS: 'MANAGE_INCIDENTS',
  VIEW_FEATURES: 'VIEW_FEATURES',
  MANAGE_FEATURES: 'MANAGE_FEATURES',
  VIEW_AUDIT_LOGS: 'VIEW_AUDIT_LOGS',
  MANAGE_ADMINS: 'MANAGE_ADMINS',
};

export const ROLE_PERMISSIONS = {
  [ADMIN_ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [ADMIN_ROLES.PLATFORM_ADMIN]: [
    PERMISSIONS.VIEW_TELEMETRY,
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.VIEW_EVENTS,
    PERMISSIONS.VIEW_JOBS,
    PERMISSIONS.MANAGE_JOBS,
    PERMISSIONS.VIEW_STORAGE,
    PERMISSIONS.RECONCILE_STORAGE,
    PERMISSIONS.VIEW_BILLING,
    PERMISSIONS.VIEW_SUPPORT,
    PERMISSIONS.MANAGE_SUPPORT,
    PERMISSIONS.VIEW_INCIDENTS,
    PERMISSIONS.MANAGE_INCIDENTS,
    PERMISSIONS.VIEW_FEATURES,
    PERMISSIONS.MANAGE_FEATURES,
    PERMISSIONS.VIEW_AUDIT_LOGS,
  ],
  [ADMIN_ROLES.OPERATIONS_AGENT]: [
    PERMISSIONS.VIEW_TELEMETRY,
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.VIEW_EVENTS,
    PERMISSIONS.VIEW_JOBS,
    PERMISSIONS.MANAGE_JOBS,
    PERMISSIONS.VIEW_STORAGE,
    PERMISSIONS.RECONCILE_STORAGE,
    PERMISSIONS.VIEW_INCIDENTS,
    PERMISSIONS.MANAGE_INCIDENTS,
    PERMISSIONS.VIEW_FEATURES,
  ],
  [ADMIN_ROLES.SUPPORT_AGENT]: [
    PERMISSIONS.VIEW_TELEMETRY,
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.VIEW_EVENTS,
    PERMISSIONS.BREAK_GLASS_EVENT,
    PERMISSIONS.VIEW_JOBS,
    PERMISSIONS.MANAGE_JOBS,
    PERMISSIONS.VIEW_SUPPORT,
    PERMISSIONS.MANAGE_SUPPORT,
    PERMISSIONS.VIEW_INCIDENTS,
  ],
  [ADMIN_ROLES.FINANCE_ADMIN]: [
    PERMISSIONS.VIEW_TELEMETRY,
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.VIEW_STORAGE,
    PERMISSIONS.VIEW_BILLING,
    PERMISSIONS.MANAGE_BILLING,
  ],
  [ADMIN_ROLES.READ_ONLY_ADMIN]: [
    PERMISSIONS.VIEW_TELEMETRY,
    PERMISSIONS.VIEW_USERS,
    PERMISSIONS.VIEW_EVENTS,
    PERMISSIONS.VIEW_JOBS,
    PERMISSIONS.VIEW_STORAGE,
    PERMISSIONS.VIEW_BILLING,
    PERMISSIONS.VIEW_SUPPORT,
    PERMISSIONS.VIEW_INCIDENTS,
    PERMISSIONS.VIEW_FEATURES,
    PERMISSIONS.VIEW_AUDIT_LOGS,
  ],
};

/**
 * Sign short-lived Admin session token (4h)
 */
export function signAdminToken(admin) {
  return jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      token_type: 'admin',
    },
    ADMIN_JWT_SECRET,
    { expiresIn: '4h' }
  );
}

/**
 * Authenticate incoming Admin Request
 */
export function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Administrative authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    if (decoded.token_type !== 'admin') {
      return res.status(403).json({ error: 'Invalid token: Not an administrative credential' });
    }

    // Verify admin is active in database
    const admin = db.prepare('SELECT id, email, name, role, status FROM admin_users WHERE id = ?').get(decoded.id);
    if (!admin || admin.status !== 'active') {
      return res.status(403).json({ error: 'Administrative account disabled or revoked' });
    }

    req.admin = admin;
    next();
  } catch (err) {
    // Check if it's a non-admin token (e.g. photographer session attempting privilege escalation)
    try {
      const photogTokenSecret = process.env.JWT_SECRET || 'lumina-photographer-super-secret-key-92837482';
      const photogDecoded = jwt.verify(token, photogTokenSecret);
      if (photogDecoded) {
        return res.status(403).json({ error: 'Forbidden: Photographer credentials cannot access administrative endpoints (Privilege Escalation Blocked)' });
      }
    } catch (e) {}

    return res.status(401).json({ error: 'Invalid or expired administrative session token' });
  }
}

/**
 * Require specific administrative permission
 */
export function requireAdminPermission(permission) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const allowedPermissions = ROLE_PERMISSIONS[req.admin.role] || [];
    if (!allowedPermissions.includes(permission)) {
      return res.status(403).json({
        error: `Forbidden: Administrative role "${req.admin.role}" lacks required permission "${permission}"`,
        requiredPermission: permission,
        role: req.admin.role,
      });
    }

    next();
  };
}

/**
 * Append entry to immutable admin audit log
 */
export function recordAdminAudit({
  adminId,
  adminEmail,
  action,
  targetType,
  targetId = null,
  previousState = null,
  newState = null,
  reason,
  req = null,
}) {
  try {
    const logId = uuidv4();
    const ipAddress = req?.ip || req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '127.0.0.1';
    const requestId = req?.headers?.['x-request-id'] || uuidv4();

    db.prepare(`
      INSERT INTO admin_audit_logs (
        id, admin_id, admin_email, action, target_type, target_id,
        previous_state, new_state, reason, ip_address, request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      adminId,
      adminEmail,
      action,
      targetType,
      targetId ? String(targetId) : null,
      previousState ? (typeof previousState === 'string' ? previousState : JSON.stringify(previousState)) : null,
      newState ? (typeof newState === 'string' ? newState : JSON.stringify(newState)) : null,
      reason || 'Operational action performed by authorized admin',
      String(ipAddress),
      String(requestId)
    );

    return logId;
  } catch (err) {
    console.error('[Admin Audit Log Error]:', err.message);
    return null;
  }
}
