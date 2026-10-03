import { apiRequest } from './client';
import { buildQuery, LedgerPeriod, QuickEntryBody, StatementKind } from '../utils/ledger';

// Shapes returned by GET /api/v1/tenant/financial-ledger/* (see backend/src/tenant/ledger).

export interface LedgerCards {
  financialYear: string;
  totalCapital: number | null;
  fundAvailable: number | null;
  totalLent: number | null;
  lentInPeriod: number | null;
  outstandingPrincipal: number | null;
  outstandingInterest: number | null;
  interestCollected: number;
  principalRecovered: number;
  otherCollected: number;
  collectionsCount: number;
  cashInHand: number | null;
  bankBalance: number | null;
}

export interface LedgerBucket {
  key: string; label: string; from: string; to: string;
  disbursed: number; principal: number; interest: number; other: number;
  moneyIn: number; moneyOut: number; net: number; collections: number;
}

export interface LedgerSummary {
  fy: number;
  fyLabel: string;
  period: 'monthly' | 'quarterly' | 'custom';
  range: { from: string; to: string };
  availableFys: number[];
  scope: 'full' | 'manager' | 'agent';
  cards: LedgerCards;
  buckets: LedgerBucket[];
}

export interface LedgerRow {
  id: string;
  date: string;
  kind: StatementKind;
  kindLabel: string;
  loanId: string | null;
  loanNumber: string | null;
  customerName: string | null;
  agentName: string | null;
  debit: number | null;
  credit: number | null;
  runningBalance: number | null;
  mode: string;
  accountName: string | null;
  remarks: string | null;
  createdByName: string | null;
  source: 'LEDGER' | 'MANUAL';
}

export interface LedgerPage {
  fy: number;
  range: { from: string; to: string };
  openingBalance: number | null;
  closingBalance: number | null;
  totalCredit: number;
  totalDebit: number;
  rows: LedgerRow[];
  total: number;
  page: number;
  limit: number;
}

export interface LedgerQuery {
  fy?: number;
  period?: LedgerPeriod | 'custom';
  from?: string;
  to?: string;
  group?: 'principal' | 'interest' | 'cashbank';
  q?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

const BASE = '/api/v1/tenant/financial-ledger';

export function fetchLedgerSummary(q: LedgerQuery): Promise<LedgerSummary> {
  return apiRequest<LedgerSummary>(`${BASE}/summary${buildQuery({ fy: q.fy, period: q.period, from: q.from, to: q.to })}`);
}

export function fetchLedgerTransactions(q: LedgerQuery): Promise<LedgerPage> {
  return apiRequest<LedgerPage>(`${BASE}/transactions${buildQuery({ ...q })}`);
}

export function createCashEntry(body: QuickEntryBody): Promise<{ ids: string[] }> {
  return apiRequest<{ ids: string[] }>(`${BASE}/entries`, { method: 'POST', body: JSON.stringify(body) });
}

/** Path of the PDF export for these filters; downloaded with the auth header by ledgerShare.ts. */
export function ledgerPdfPath(q: LedgerQuery): string {
  return `${BASE}/export/pdf${buildQuery({ fy: q.fy, period: q.period, from: q.from, to: q.to, group: q.group, q: q.q, order: 'asc' })}`;
}
