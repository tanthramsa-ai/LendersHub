'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function PaymentsPage() {
  const params = useParams<{ subdomain: string }>();
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-2">Payments</h1>
      <p className="text-gray-500 text-sm mb-4">Payment recording is available on individual loan pages.</p>
      <Link href={`/tenant/${params.subdomain}/loans`} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
        Go to Loans
      </Link>
    </div>
  );
}
