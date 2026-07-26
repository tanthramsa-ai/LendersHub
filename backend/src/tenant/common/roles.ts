/** The six tenant user roles, from broadest to most restricted access. */
export const ROLE = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'STAFF', 'CUSTOMER'] as const;
export type UserRole = (typeof ROLE)[number];

/** Add User: Owner/Admin only. */
export const USER_ADMIN_ROLES: UserRole[] = ['OWNER', 'ADMIN'];
/** Add/View all loans, approvals, ledger-tier management: Owner/Admin/Manager. */
export const MANAGER_ROLES: UserRole[] = ['OWNER', 'ADMIN', 'MANAGER'];
/** Field-level roles that create loans but need approval and can't edit after. */
export const FIELD_ROLES: UserRole[] = ['AGENT', 'STAFF'];
/** Ledger: Admin/Owner only. */
export const LEDGER_ROLES: UserRole[] = ['ADMIN', 'OWNER'];
