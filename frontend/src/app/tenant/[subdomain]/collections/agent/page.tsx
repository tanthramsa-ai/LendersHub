'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

const BRAND = '#0F4C81';
const ACCENT = '#FF6B35';

interface Collection {
  id: string;
  customerName: string;
  loanNumber: string;
  amount: number;
  dueDate: string;
  phone: string;
  address: string;
  status: 'pending' | 'overdue' | 'collected';
  daysOverdue?: number;
}

const MOCK_COLLECTIONS: Collection[] = [
  { id: '1', customerName: 'Ravi Shankar', loanNumber: 'LN2024000012', amount: 4500, dueDate: 'Today', phone: '+91 98765 43210', address: '14/2 Gandhi Nagar, Chennai', status: 'pending' },
  { id: '2', customerName: 'Meena Devi', loanNumber: 'LN2024000034', amount: 6200, dueDate: 'Today', phone: '+91 87654 32109', address: '7 Patel Street, Chennai', status: 'overdue', daysOverdue: 3 },
  { id: '3', customerName: 'Suresh Kumar', loanNumber: 'LN2024000019', amount: 3800, dueDate: 'Today', phone: '+91 76543 21098', address: '22 Nehru Colony, Chennai', status: 'pending' },
  { id: '4', customerName: 'Lakshmi Bai', loanNumber: 'LN2024000028', amount: 5100, dueDate: 'Yesterday', phone: '+91 65432 10987', address: '9 Indira Nagar, Chennai', status: 'overdue', daysOverdue: 1 },
  { id: '5', customerName: 'Arjun Reddy', loanNumber: 'LN2024000041', amount: 7300, dueDate: 'Today', phone: '+91 54321 09876', address: '3 Rajaji Road, Chennai', status: 'collected' },
  { id: '6', customerName: 'Sita Patel', loanNumber: 'LN2024000055', amount: 2900, dueDate: 'Today', phone: '+91 43210 98765', address: '18 MG Road, Chennai', status: 'collected' },
];

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export default function AgentMobileDashboard() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;
  const [activeTab, setActiveTab] = useState<'today' | 'overdue' | 'collected'>('today');
  const [checkedIn, setCheckedIn] = useState(false);

  const todayList = MOCK_COLLECTIONS.filter((c) => c.status === 'pending' && c.dueDate === 'Today');
  const overdueList = MOCK_COLLECTIONS.filter((c) => c.status === 'overdue');
  const collectedList = MOCK_COLLECTIONS.filter((c) => c.status === 'collected');

  const totalTarget = MOCK_COLLECTIONS.filter((c) => c.status !== 'collected').reduce((s, c) => s + c.amount, 0);
  const totalCollected = collectedList.reduce((s, c) => s + c.amount, 0);
  const progressPct = Math.round((totalCollected / (totalTarget + totalCollected)) * 100);

  const currentList = activeTab === 'today' ? todayList : activeTab === 'overdue' ? overdueList : collectedList;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto lg:max-w-full">
      {/* Gradient Header */}
      <div className="text-white px-5 pt-6 pb-16 relative" style={{ background: `linear-gradient(135deg, ${BRAND} 0%, #1a6fc4 100%)` }}>
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href={`/tenant/${subdomain}/collections`}>
              <svg className="w-5 h-5 text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <p className="text-xs text-blue-200">Field Agent Dashboard</p>
              <p className="font-bold text-lg leading-none mt-0.5">Good morning, Ravi!</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative p-2 bg-white/10 rounded-xl">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ backgroundColor: ACCENT }} />
            </button>
            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center font-bold text-sm">RK</div>
          </div>
        </div>

        {/* Date + check-in */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <p className="text-sm font-medium mt-0.5">{MOCK_COLLECTIONS.length} assignments · North Zone</p>
          </div>
          <button
            onClick={() => setCheckedIn((c) => !c)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              checkedIn
                ? 'bg-green-400 text-green-900'
                : 'bg-white/20 text-white border border-white/30'
            }`}
          >
            {checkedIn ? '✓ Checked In' : 'Check In'}
          </button>
        </div>
      </div>

      {/* Target Card (overlapping) */}
      <div className="px-4 -mt-10 mb-4">
        <div className="bg-white rounded-2xl shadow-lg p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs text-gray-500 font-medium">Today&apos;s Target</p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">{fmtCurrency(totalTarget + totalCollected)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 font-medium">Collected</p>
              <p className="text-2xl font-bold mt-0.5" style={{ color: '#10B981' }}>{fmtCurrency(totalCollected)}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, background: `linear-gradient(90deg, ${BRAND}, #10B981)` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">{progressPct}% completed</span>
            <span className="font-semibold" style={{ color: ACCENT }}>{collectedList.length}/{MOCK_COLLECTIONS.length} visits done</span>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="px-4 mb-4 grid grid-cols-3 gap-3">
        {[
          { label: 'Pending', value: todayList.length, color: BRAND },
          { label: 'Overdue', value: overdueList.length, color: '#EF4444' },
          { label: 'Collected', value: collectedList.length, color: '#10B981' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-3 text-center shadow-sm border border-gray-100">
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="px-4 mb-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</p>
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Collect', icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
            ), color: BRAND },
            { label: 'Call', icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
            ), color: '#10B981' },
            { label: 'Navigate', icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            ), color: ACCENT },
            { label: 'History', icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            ), color: '#8B5CF6' },
          ].map((a) => (
            <button
              key={a.label}
              className="flex flex-col items-center gap-2 p-3 bg-white rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${a.color}15` }}>
                <span style={{ color: a.color }}>{a.icon}</span>
              </div>
              <span className="text-xs font-medium text-gray-700">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Collections List */}
      <div className="px-4 flex-1 pb-24">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Collections</p>
          <span className="text-xs text-gray-400">{currentList.length} items</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-xl">
          {([
            { key: 'today', label: 'Today', count: todayList.length },
            { key: 'overdue', label: 'Overdue', count: overdueList.length },
            { key: 'collected', label: 'Collected', count: collectedList.length },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                activeTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              {tab.label}
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  activeTab === tab.key ? 'text-white' : 'text-gray-400 bg-gray-200'
                }`}
                style={activeTab === tab.key ? { backgroundColor: tab.key === 'overdue' ? '#EF4444' : tab.key === 'collected' ? '#10B981' : BRAND } : {}}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* List items */}
        <div className="space-y-3">
          {currentList.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-sm text-gray-400">No items in this category</p>
            </div>
          ) : (
            currentList.map((item) => (
              <div
                key={item.id}
                className={`bg-white rounded-2xl p-4 shadow-sm border transition-all ${
                  item.status === 'overdue' ? 'border-red-100' : item.status === 'collected' ? 'border-green-100' : 'border-gray-100'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                    style={{
                      backgroundColor: item.status === 'collected' ? '#10B981' : item.status === 'overdue' ? '#EF4444' : BRAND,
                    }}
                  >
                    {item.customerName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-gray-900 truncate">{item.customerName}</p>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
                          item.status === 'collected'
                            ? 'bg-green-100 text-green-700'
                            : item.status === 'overdue'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {item.status === 'collected' ? '✓ Collected' : item.status === 'overdue' ? `${item.daysOverdue}d Overdue` : 'Pending'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{item.loanNumber}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <svg className="w-3 h-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      </svg>
                      <p className="text-xs text-gray-400 truncate">{item.address}</p>
                    </div>
                  </div>
                </div>

                {/* Amount + Actions */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                  <div>
                    <p className="text-xs text-gray-400">Amount Due</p>
                    <p className="text-base font-bold" style={{ color: item.status === 'collected' ? '#10B981' : item.status === 'overdue' ? '#EF4444' : BRAND }}>
                      {fmtCurrency(item.amount)}
                    </p>
                  </div>
                  {item.status !== 'collected' ? (
                    <div className="flex items-center gap-2">
                      <a
                        href={`tel:${item.phone}`}
                        className="w-9 h-9 rounded-xl flex items-center justify-center bg-gray-100 hover:bg-gray-200 transition-colors"
                      >
                        <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                      </a>
                      <button
                        className="px-4 py-2 text-xs font-semibold text-white rounded-xl transition-colors"
                        style={{ backgroundColor: ACCENT }}
                      >
                        Collect
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 font-semibold">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Done
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md lg:max-w-full mx-auto bg-white border-t border-gray-200 px-4 py-2 grid grid-cols-4 gap-1 z-10">
        {[
          { label: 'Home', href: `/tenant/${subdomain}/dashboard`, icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          )},
          { label: 'Collect', href: '#', active: true, icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
          )},
          { label: 'Loans', href: `/tenant/${subdomain}/loans`, icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
          )},
          { label: 'Profile', href: `/tenant/${subdomain}/settings`, icon: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          )},
        ].map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="flex flex-col items-center gap-1 py-1.5 rounded-xl transition-colors"
            style={item.active ? { color: BRAND } : { color: '#9CA3AF' }}
          >
            {item.icon}
            <span className="text-xs font-medium">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
