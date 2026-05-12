import { redirect } from 'next/navigation';

export default function TenantRootPage({ params }: { params: { subdomain: string } }) {
  redirect(`/tenant/${params.subdomain}/dashboard`);
}
