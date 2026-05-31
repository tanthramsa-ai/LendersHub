'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getNotifications, markNotificationRead, markAllNotificationsRead, TenantNotification,
} from '@/services/tenant-api';
import { useParams, useRouter } from 'next/navigation';

const TYPE_COLORS: Record<string, string> = {
  alert: 'bg-red-100 text-red-700',
  warning: 'bg-yellow-100 text-yellow-700',
  payment: 'bg-green-100 text-green-700',
  loan: 'bg-blue-100 text-blue-700',
  info: 'bg-gray-100 text-gray-600',
};

export default function NotificationsPage() {
  const { subdomain } = useParams<{ subdomain: string }>();
  const router = useRouter();
  const [notifications, setNotifications] = useState<TenantNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const LIMIT = 20;

  const load = useCallback(async (p: number, unread: boolean) => {
    setLoading(true);
    try {
      const res = await getNotifications(p, LIMIT, unread);
      setNotifications(res.data);
      setTotal(res.total);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page, unreadOnly); }, [load, page, unreadOnly]);

  async function handleClick(n: TenantNotification) {
    if (!n.isRead) {
      try { await markNotificationRead(n.id); } catch {}
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, isRead: true } : x));
    }
    if (n.link) router.push(`/${subdomain}${n.link}`);
  }

  async function handleMarkAll() {
    try { await markAllNotificationsRead(); } catch {}
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} total</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }}
              className="rounded"
            />
            Unread only
          </label>
          <button
            onClick={handleMarkAll}
            className="text-sm text-blue-600 hover:underline font-medium"
          >
            Mark all read
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
          <p className="text-4xl mb-3">🔔</p>
          <p className="font-semibold text-gray-700">No notifications</p>
          <p className="text-sm text-gray-400 mt-1">You're all caught up!</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => handleClick(n)}
              className={`w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors flex items-start gap-3 ${!n.isRead ? 'bg-blue-50/50' : ''}`}
            >
              <span className={`mt-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${TYPE_COLORS[n.type] ?? TYPE_COLORS.info}`}>
                {n.type}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-snug ${!n.isRead ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                  {n.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 leading-snug">{n.body}</p>
                <p className="text-[10px] text-gray-400 mt-1">
                  {new Date(n.createdAt).toLocaleDateString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              </div>
              {!n.isRead && (
                <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-2" />
              )}
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
