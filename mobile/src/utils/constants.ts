export const BRAND = '#0F4C81';
export const BRAND_DARK = '#0a3660';
export const BRAND_LIGHT = '#E8F0F9';
export const ACCENT = '#FF6B35';
export const SUCCESS = '#10B981';
export const DANGER = '#EF4444';
export const WARNING = '#F59E0B';
export const GRAY = '#6B7280';
export const GRAY_LIGHT = '#F3F4F6';
export const GRAY_BORDER = '#E5E7EB';

export const PAYMENT_METHODS = [
  { value: 'CASH',          label: 'Cash' },
  { value: 'UPI',           label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHEQUE',        label: 'Cheque' },
  { value: 'NEFT',          label: 'NEFT' },
  { value: 'RTGS',          label: 'RTGS' },
] as const;
