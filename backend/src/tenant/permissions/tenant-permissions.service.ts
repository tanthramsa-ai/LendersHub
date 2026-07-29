import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { USER_ADMIN_ROLES, ROLE, UserRole } from '../common/roles';

/**
 * The authoritative matrix (see HANDOFF_ROLE_MIGRATION.md / the role-model
 * overhaul plan) has 7 columns, and the "value" a cell can hold isn't
 * uniformly boolean — View Loan/View Collection are all/self/no, Add Loan is
 * yes/partial/no, everything else is yes/no. Validate against this rather
 * than a single shared enum so a bad write (e.g. view_loan='yes') can't land.
 */
export const PERMISSION_KEYS = [
  'add_user',
  'add_customer',
  'view_loan',
  'add_loan',
  'update_loan',
  'view_collection',
  'add_collection',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const ALLOWED_VALUES: Record<PermissionKey, string[]> = {
  add_user: ['yes', 'no'],
  add_customer: ['yes', 'no'],
  view_loan: ['all', 'self', 'no'],
  add_loan: ['yes', 'partial', 'no'],
  update_loan: ['yes', 'no'],
  view_collection: ['all', 'self', 'no'],
  add_collection: ['yes', 'no'],
};

// Built-in roles are a fixed literal union (UserRole); tenant admins can additionally
// define custom roles at runtime (see addRole), so anywhere a role is looked up by
// name it's treated as a plain string, not narrowed to UserRole.
export type PermissionMatrix = Record<string, Record<PermissionKey, string>>;

export interface PermissionUpdate {
  role: string;
  permissionKey: PermissionKey;
  value: string;
}

// Custom role keys: 2-30 chars, uppercase letters/digits/underscore, starting with a letter.
const ROLE_KEY_RE = /^[A-Z][A-Z0-9_]{1,29}$/;

@Injectable()
export class TenantPermissionsService {
  constructor(
    private prisma: PrismaService,
    private activity: TenantActivityLogService,
  ) {}

  private async withSchema<T>(
    schemaName: string,
    fn: (client: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private assertAdmin(user: TenantJwtPayload) {
    if (!USER_ADMIN_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Only Owner or Admin can manage permissions');
    }
  }

  /** Roles currently known in this tenant's role_permissions table, union'd with the
   *  fixed built-ins (so a built-in role missing all its rows still shows up). */
  private async knownRoles(client: import('pg').PoolClient): Promise<Set<string>> {
    const roles = new Set<string>(ROLE);
    const res = await client.query<{ role: string }>(`SELECT DISTINCT role FROM role_permissions`);
    for (const row of res.rows) roles.add(row.role);
    return roles;
  }

  private async buildMatrix(client: import('pg').PoolClient): Promise<PermissionMatrix> {
    const roles = await this.knownRoles(client);
    const res = await client.query<{ role: string; permission_key: PermissionKey; value: string }>(
      `SELECT role, permission_key, value FROM role_permissions`,
    );

    const matrix = {} as PermissionMatrix;
    for (const role of roles) {
      matrix[role] = {} as Record<PermissionKey, string>;
      for (const key of PERMISSION_KEYS) {
        // Most-restrictive fallback if a role/key pair is somehow missing a row.
        matrix[role][key] = ALLOWED_VALUES[key][ALLOWED_VALUES[key].length - 1];
      }
    }
    for (const row of res.rows) {
      if (matrix[row.role]) matrix[row.role][row.permission_key] = row.value;
    }
    return matrix;
  }

  async getMatrix(user: TenantJwtPayload): Promise<PermissionMatrix> {
    this.assertAdmin(user);
    return this.withSchema(user.schemaName, (client) => this.buildMatrix(client));
  }

  async updateMatrix(user: TenantJwtPayload, updates: PermissionUpdate[]) {
    this.assertAdmin(user);
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new BadRequestException('updates must be a non-empty array');
    }

    for (const u of updates) {
      if (!PERMISSION_KEYS.includes(u.permissionKey)) {
        throw new BadRequestException(`Invalid permission key: ${u.permissionKey}`);
      }
      if (!ALLOWED_VALUES[u.permissionKey].includes(u.value)) {
        throw new BadRequestException(`Invalid value "${u.value}" for ${u.permissionKey}`);
      }
      // Owner is the tenant's top authority — its row stays fixed at maximum
      // access rather than allowing an edit that could lock everyone out.
      if (u.role === 'OWNER') {
        throw new BadRequestException('Owner permissions cannot be edited');
      }
    }

    return this.withSchema(user.schemaName, async (client) => {
      const roles = await this.knownRoles(client);
      for (const u of updates) {
        if (!roles.has(u.role)) throw new BadRequestException(`Invalid role: ${u.role}`);
      }

      for (const u of updates) {
        await client.query(
          `INSERT INTO role_permissions (role, permission_key, value, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (role, permission_key) DO UPDATE SET value = $3, updated_at = NOW()`,
          [u.role, u.permissionKey, u.value],
        );
      }

      await this.activity.record(client, user, {
        action: 'permissions.updated',
        entityType: 'role_permissions',
        entityLabel: 'Role permission matrix',
        metadata: { changes: updates },
      });

      return { message: 'Permission matrix updated' };
    });
  }

  /** Tenant-defined custom role. Matrix-only: this role gets a row in role_permissions
   *  and can be assigned to users, but route guards elsewhere (loans, customers,
   *  collections, branches, ledger, dashboard) check the fixed built-in role lists in
   *  common/roles.ts, not this table — so a custom role is treated as unprivileged
   *  (STAFF-like or more restrictive) by every feature outside this settings page
   *  until those guards are migrated to read role_permissions dynamically. */
  async addRole(user: TenantJwtPayload, roleKeyRaw: string): Promise<PermissionMatrix> {
    this.assertAdmin(user);
    const roleKey = (roleKeyRaw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!ROLE_KEY_RE.test(roleKey)) {
      throw new BadRequestException(
        'Role name must be 2-30 characters: letters, numbers, underscores, starting with a letter.',
      );
    }

    return this.withSchema(user.schemaName, async (client) => {
      const roles = await this.knownRoles(client);
      if (roles.has(roleKey)) {
        throw new BadRequestException(`Role "${roleKey}" already exists`);
      }

      // Postgres enum values, once added, can't be removed (only renamed) — this is
      // effectively a one-way operation per tenant schema. Safe from injection: roleKey
      // is validated by ROLE_KEY_RE above (uppercase letters/digits/underscore only).
      await client.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS '${roleKey}'`);

      for (const key of PERMISSION_KEYS) {
        const mostRestrictive = ALLOWED_VALUES[key][ALLOWED_VALUES[key].length - 1];
        await client.query(
          `INSERT INTO role_permissions (role, permission_key, value, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (role, permission_key) DO NOTHING`,
          [roleKey, key, mostRestrictive],
        );
      }

      await this.activity.record(client, user, {
        action: 'permissions.role_added',
        entityType: 'role_permissions',
        entityLabel: `Role "${roleKey}" added`,
        metadata: { role: roleKey },
      });

      return this.buildMatrix(client);
    });
  }
}
