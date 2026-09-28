/** Public links must leave a tenant's origin in host-based deployments. */
export function platformHref(path: string): string {
  const rootDomain = process.env.NEXT_PUBLIC_TENANT_ROOT_DOMAIN;
  return rootDomain ? `https://app.${rootDomain}${path}` : path;
}
