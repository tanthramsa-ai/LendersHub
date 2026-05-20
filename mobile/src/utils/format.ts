export function fmtCurrency(n: number): string {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

export function fmtCurrencyFull(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function fmtDate(d: string | Date | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function fmtTime(d: string | Date): string {
  return new Date(d).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function statusColor(status: string): { bg: string; text: string } {
  switch (status) {
    case 'PAID':         return { bg: '#D1FAE5', text: '#065F46' };
    case 'OVERDUE':      return { bg: '#FEE2E2', text: '#991B1B' };
    case 'PARTIALLY_PAID': return { bg: '#FEF9C3', text: '#92400E' };
    case 'PENDING':      return { bg: '#DBEAFE', text: '#1E40AF' };
    default:             return { bg: '#F3F4F6', text: '#374151' };
  }
}
