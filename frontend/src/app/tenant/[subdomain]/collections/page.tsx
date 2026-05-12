'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';

const BRAND = '#0F4C81';
const ACCENT = '#FF6B35';

export default function CollectionsPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Collections</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage field agent collections and track dues</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Agent Dashboard Card */}
        <Link
          href={`/tenant/${subdomain}/collections/agent`}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow group"
        >
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `linear-gradient(135deg, ${BRAND}, #1a6fc4)` }}>
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-gray-900 group-hover:text-blue-700 transition-colors">Agent Mobile Dashboard</h2>
              <p className="text-sm text-gray-500 mt-1">Field collection tool with route planning, target tracking, and on-the-go payment recording</p>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs font-semibold px-2.5 py-1 bg-green-100 text-green-700 rounded-full">6 Today</span>
                <span className="text-xs font-semibold px-2.5 py-1 bg-red-100 text-red-700 rounded-full">2 Overdue</span>
                <span className="text-xs font-semibold px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full">North Zone</span>
              </div>
            </div>
            <svg className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>

        {/* Overdue Report Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEF3F2' }}>
              <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-gray-900">Overdue Report</h2>
              <p className="text-sm text-gray-500 mt-1">View all overdue EMIs and prioritize collection efforts across your loan portfolio</p>
              <div className="mt-3">
                <span className="text-xs text-gray-400">Coming soon</span>
              </div>
            </div>
          </div>
        </div>

        {/* Collection Schedule */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${ACCENT}15` }}>
              <svg className="w-7 h-7" style={{ color: ACCENT }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-gray-900">Collection Schedule</h2>
              <p className="text-sm text-gray-500 mt-1">Plan and schedule collection visits for field agents by date and zone</p>
              <div className="mt-3">
                <span className="text-xs text-gray-400">Coming soon</span>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Analytics */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#F0FDF4' }}>
              <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-gray-900">Agent Performance</h2>
              <p className="text-sm text-gray-500 mt-1">Track collection efficiency, success rates, and agent-wise performance metrics</p>
              <div className="mt-3">
                <span className="text-xs text-gray-400">Coming soon</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
