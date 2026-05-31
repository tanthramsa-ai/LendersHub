import * as SQLite from 'expo-sqlite';
import { PaymentRecord, CollectionItem } from '../types';

// Store the promise itself so concurrent callers share one in-flight open
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('lendershub_agent.db').then(async (database) => {
      await initSchema(database);
      return database;
    });
  }
  return dbPromise;
}

async function initSchema(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS offline_payments (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      installment_id TEXT NOT NULL,
      customer_name TEXT,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      reference_number TEXT,
      payment_date TEXT NOT NULL,
      receipt_uri TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_collections (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      loan_number TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_address TEXT,
      installment_id TEXT NOT NULL,
      installment_number INTEGER NOT NULL,
      amount_due REAL NOT NULL,
      paid_amount REAL DEFAULT 0,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL,
      days_overdue INTEGER DEFAULT 0,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_customers (
      id TEXT PRIMARY KEY,
      customer_code TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      credit_score INTEGER,
      is_active INTEGER DEFAULT 1,
      cached_at TEXT NOT NULL
    );
  `);
  // Non-destructive migration: add customer_name if missing (safe to run repeatedly)
  try {
    await database.execAsync('ALTER TABLE offline_payments ADD COLUMN customer_name TEXT');
  } catch { /* column already exists */ }
}

// ── Offline payments ─────────────────────────────────────────────────────────

export async function saveOfflinePayment(payment: PaymentRecord): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO offline_payments
     (id, loan_id, installment_id, customer_name, amount, payment_method, reference_number,
      payment_date, receipt_uri, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payment.id ?? `offline_${Date.now()}`,
      payment.loanId,
      payment.installmentId,
      payment.customerName ?? null,
      payment.amount,
      payment.paymentMethod,
      payment.referenceNumber ?? null,
      payment.paymentDate,
      payment.receiptUri ?? null,
      payment.syncStatus,
      payment.createdAt,
    ],
  );
}

type PaymentRow = {
  id: string; loan_id: string; installment_id: string; customer_name: string | null;
  amount: number; payment_method: string; reference_number: string | null;
  payment_date: string; receipt_uri: string | null; sync_status: string; created_at: string;
};

function rowToPayment(r: PaymentRow): PaymentRecord {
  return {
    id: r.id,
    loanId: r.loan_id,
    installmentId: r.installment_id,
    customerName: r.customer_name ?? undefined,
    amount: r.amount,
    paymentMethod: r.payment_method as PaymentRecord['paymentMethod'],
    referenceNumber: r.reference_number ?? undefined,
    paymentDate: r.payment_date,
    receiptUri: r.receipt_uri ?? undefined,
    syncStatus: r.sync_status as PaymentRecord['syncStatus'],
    createdAt: r.created_at,
  };
}

export async function getPendingPayments(): Promise<PaymentRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PaymentRow>(`SELECT * FROM offline_payments WHERE sync_status = 'pending'`);
  return rows.map(rowToPayment);
}

export async function getAllPayments(): Promise<PaymentRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PaymentRow>(`SELECT * FROM offline_payments ORDER BY created_at DESC`);
  return rows.map(rowToPayment);
}

export async function markPaymentSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE offline_payments SET sync_status = 'synced' WHERE id = ?`, [id]);
}

export async function markPaymentFailed(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE offline_payments SET sync_status = 'failed' WHERE id = ?`, [id]);
}

export async function resetFailedPayments(): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE offline_payments SET sync_status = 'pending' WHERE sync_status = 'failed'`);
}

// ── Collection cache ──────────────────────────────────────────────────────────

export async function cacheCollections(items: CollectionItem[]): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  // Wrap DELETE + INSERT in a transaction — a crash between them would otherwise
  // leave the cache empty or partial, giving agents a missing collection list offline
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM cached_collections');
    for (const item of items) {
      await db.runAsync(
        `INSERT OR REPLACE INTO cached_collections
         (id, loan_id, loan_number, customer_id, customer_name, customer_phone, customer_address,
          installment_id, installment_number, amount_due, paid_amount, due_date, status, days_overdue, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id, item.loanId, item.loanNumber, item.customerId, item.customerName,
          item.customerPhone, item.customerAddress ?? null, item.installmentId,
          item.installmentNumber, item.amountDue, item.paidAmount, item.dueDate,
          item.status, item.daysOverdue ?? 0, now,
        ],
      );
    }
  });
}

export async function getCollectionCache(): Promise<CollectionItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string; loan_id: string; loan_number: string; customer_id: string;
    customer_name: string; customer_phone: string; customer_address: string | null;
    installment_id: string; installment_number: number; amount_due: number;
    paid_amount: number; due_date: string; status: string; days_overdue: number;
  }>('SELECT * FROM cached_collections');

  return rows.map((r) => ({
    id: r.id,
    loanId: r.loan_id,
    loanNumber: r.loan_number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerAddress: r.customer_address ?? undefined,
    installmentId: r.installment_id,
    installmentNumber: r.installment_number,
    amountDue: r.amount_due,
    paidAmount: r.paid_amount,
    dueDate: r.due_date,
    status: r.status as CollectionItem['status'],
    daysOverdue: r.days_overdue || undefined,
  }));
}
