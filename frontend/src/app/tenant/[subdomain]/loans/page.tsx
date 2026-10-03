import { redirect } from 'next/navigation';

// Term loans are no longer offered, so there is no combined "Loans" list any more: each
// remaining loan type has its own list. Old bookmarks and links land on the dashboard.
// Loans that already exist as term loans are still reachable at /loans/[id].
export default async function LoansRedirect({ params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params;
  redirect(`/${subdomain}/dashboard`);
}
