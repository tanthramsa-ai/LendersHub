'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getTenantUsers, createTenantUser, updateTenantUser,
  activateTenantUser, deactivateTenantUser, resetTenantUserPassword,
  getBranches, TenantTeamMember, TenantBranch, UserRole, ROLE_LABELS, USER_ADMIN_ROLES,
  getTenantSession,
} from '@/services/tenant-api';

const BRAND = '#0F4C81';
const ROLES: UserRole[] = ['ADMIN', 'LOAN_OFFICER', 'COLLECTOR', 'VIEWER'];

const ROLE_BADGE: Record<UserRole, string> = {
  OWNER:        'bg-yellow-100 text-yellow-700',
  MANAGER:      'bg-indigo-100 text-indigo-700',
  ADMIN:        'bg-purple-100 text-purple-700',
  LOAN_OFFICER: 'bg-blue-100 text-blue-700',
  COLLECTOR:    'bg-orange-100 text-orange-700',
  VIEWER:       'bg-gray-100 text-gray-600',
};

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function roleBadge(role: UserRole) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${ROLE_BADGE[role] ?? 'bg-gray-100 text-gray-600'}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

// ── Add / Edit User Modal ─────────────────────────────────────────────────────
function UserModal({
  user, branches, onClose, onSuccess,
}: { user?: TenantTeamMember; branches: TenantBranch[]; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName:  user?.lastName  ?? '',
    email:     user?.email     ?? '',
    phone:     user?.phone     ?? '',
    role:      (user?.role ?? 'LOAN_OFFICER') as UserRole,
    branchId:  user?.branchId  ?? '',
    password:  '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  function set(k: keyof typeof form, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.firstName.trim()) return setError('First name is required');
    if (!form.lastName.trim())  return setError('Last name is required');
    if (!form.email.trim())     return setError('Email is required');
    if (!form.phone.trim())     return setError('Phone number is required');
    if (!isEdit && !form.password) return setError('Password is required for new users');
    setError(''); setLoading(true);
    try {
      if (isEdit) {
        await updateTenantUser(user!.id, {
          firstName: form.firstName, lastName: form.lastName,
          phone: form.phone, role: form.role,
          branchId: form.branchId || null,
        });
      } else {
        await createTenantUser({
          email: form.email, password: form.password,
          firstName: form.firstName, lastName: form.lastName,
          phone: form.phone, role: form.role,
          branchId: form.branchId || undefined,
        });
      }
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save user');
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-900 text-lg">{isEdit ? 'Edit User' : 'Add User'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">First Name *</label>
              <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Last Name *</label>
              <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Email *</label>
            <input
              type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
              disabled={isEdit}
              className={`${inputCls} ${isEdit ? 'bg-gray-50 text-gray-400' : ''}`}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Phone *</label>
            <div className="flex gap-2">
              <span className="flex items-center px-3 border border-gray-200 rounded-xl text-sm text-gray-500 bg-gray-50">+91</span>
              <input
                type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile number" className={`${inputCls} flex-1`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Role *</label>
              <select value={form.role} onChange={(e) => set('role', e.target.value)} className={`${inputCls} bg-white`}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Branch</label>
              <select value={form.branchId} onChange={(e) => set('branchId', e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">No branch</option>
                {branches.filter((b) => b.isActive).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>

          {!isEdit && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Password *</label>
              <input
                type="password" value={form.password} onChange={(e) => set('password', e.target.value)}
                placeholder="Min 6 characters" className={inputCls}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600 font-medium">{error}</p>}

          <button
            onClick={submit} disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white text-sm"
            style={{ backgroundColor: BRAND, opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reset Password Modal ──────────────────────────────────────────────────────
function ResetPasswordModal({ user, onClose, onSuccess }: { user: TenantTeamMember; onClose: () => void; onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function submit() {
    if (password.length < 6) return setError('Password must be at least 6 characters');
    setError(''); setLoading(true);
    try { await resetTenantUserPassword(user.id, password); onSuccess(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to reset password'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">Reset Password</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
        </div>
        <p className="text-sm text-gray-500 mb-4">{user.firstName} {user.lastName} · {user.email}</p>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="New password (min 6 chars)"
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <button
          onClick={submit} disabled={loading}
          className="w-full py-3 rounded-xl font-bold text-white text-sm"
          style={{ backgroundColor: BRAND, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Resetting...' : 'Reset Password'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { subdomain } = useParams<{ subdomain: string }>();
  const session = getTenantSession();
  const myRole = session?.user.role as UserRole | undefined;
  const canManage = myRole && USER_ADMIN_ROLES.includes(myRole);

  const [users, setUsers]       = useState<TenantTeamMember[]>([]);
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [search, setSearch]     = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [editUser, setEditUser] = useState<TenantTeamMember | null>(null);
  const [resetUser, setResetUser] = useState<TenantTeamMember | null>(null);

  const LIMIT = 20;

  const load = useCallback(async (p: number, s: string) => {
    setLoading(true);
    try {
      const res = await getTenantUsers(p, LIMIT, s || undefined);
      setUsers(res.data);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(page, search);
    getBranches().then(setBranches).catch(() => {});
  }, [page, search, load]);

  async function toggleActive(user: TenantTeamMember) {
    try {
      if (user.isActive) await deactivateTenantUser(user.id);
      else await activateTenantUser(user.id);
      load(page, search);
    } catch {}
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Team Members</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} users in your organisation</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm px-4 py-2 rounded-xl font-semibold text-white"
            style={{ backgroundColor: BRAND }}
          >
            + Add User
          </button>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput); }}
        className="flex gap-2"
      >
        <input
          type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name, email or phone…"
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" className="px-4 py-2.5 bg-gray-800 text-white text-sm font-medium rounded-xl">Search</button>
        {search && (
          <button
            type="button" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
            className="px-3 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50"
          >Clear</button>
        )}
      </form>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-400 mt-3">Loading users…</p>
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm mb-2">No users found</p>
            {canManage && (
              <button onClick={() => setShowAdd(true)} className="text-sm text-blue-600 hover:underline">
                Add your first team member
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Branch</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Loans</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/${subdomain}/users/${u.id}`} className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">
                        {u.firstName} {u.lastName}
                      </Link>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{u.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{u.branchName ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-center">{roleBadge(u.role)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2 text-xs">
                        <span className="text-green-700 font-semibold">{u.activeLoans}A</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-500">{u.closedLoans}C</span>
                        {u.npaLoans > 0 && <>
                          <span className="text-gray-300">·</span>
                          <span className="text-red-600 font-semibold">{u.npaLoans} NPA</span>
                        </>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <Link
                          href={`/${subdomain}/users/${u.id}`}
                          className="text-xs px-2.5 py-1.5 rounded-lg font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          View
                        </Link>
                        {canManage && (
                          <>
                            <button
                              onClick={() => setEditUser(u)}
                              className="text-xs px-2.5 py-1.5 rounded-lg font-semibold text-white"
                              style={{ backgroundColor: BRAND }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setResetUser(u)}
                              className="text-xs px-2.5 py-1.5 rounded-lg font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
                            >
                              Pwd
                            </button>
                            <button
                              onClick={() => toggleActive(u)}
                              className={`text-xs px-2.5 py-1.5 rounded-lg font-semibold ${u.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                            >
                              {u.isActive ? 'Off' : 'On'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 font-medium disabled:opacity-40 hover:bg-gray-50"
            >Previous</button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 font-medium disabled:opacity-40 hover:bg-gray-50"
            >Next</button>
          </div>
        </div>
      )}

      {showAdd && (
        <UserModal branches={branches} onClose={() => setShowAdd(false)} onSuccess={() => { setShowAdd(false); load(page, search); }} />
      )}
      {editUser && (
        <UserModal user={editUser} branches={branches} onClose={() => setEditUser(null)} onSuccess={() => { setEditUser(null); load(page, search); }} />
      )}
      {resetUser && (
        <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} onSuccess={() => setResetUser(null)} />
      )}
    </div>
  );
}
