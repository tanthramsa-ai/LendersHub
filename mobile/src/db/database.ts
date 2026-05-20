import * as SQLite from 'expo-sqlite';
import { PaymentRecord } from '../types';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('lendershub_agent.db');
    await initSchema(db);
  }
  return db;
}

async function initSchema(database: SQLite.SQLiteDatabase) {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS offline_payments (
      id TEXT PRIMARY KEY,
      loan_id TEXT NOT NULL,
      installment_id TEXT NOT NULL,
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
}

// Offline payments
export async function saveOfflinePayment(payment: PaymentRecord): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO offline_payments
     (id, loan_id, installment_id, amount, payment_method, reference_number, payment_date, receipt_uri, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payment.id ?? `offline_${Date.now()}`,
      payment.loanId,
      payment.installmentId,
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

export async function getPendingPayments(): Promise<PaymentRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string; loan_id: string; installment_id: string; amount: number;
    payment_method: string; reference_number: string | null; payment_date: string;
    receipt_uri: string | null; sync_status: string; created_at: string;
  }>(`SELECT * FROM offline_payments WHERE sync_status = 'pending'`);

  return rows.map((r) => ({
    id: r.id,
    loanId: r.loan_id,
    installmentId: r.installment_id,
    amount: r.amount,
    paymentMethod: r.payment_method as PaymentRecord['paymentMethod'],
    referenceNumber: r.reference_number ?? undefined,
    paymentDate: r.payment_date,
    receiptUri: r.receipt_uri ?? undefined,
    syncStatus: r.sync_status as PaymentRecord['syncStatus'],
    createdAt: r.created_at,
  }));
}

export async function markPaymentSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE offline_payments SET sync_status = 'synced' WHERE id = ?`, [id]);
}

export async function markPaymentFailed(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE offline_payments SET sync_status = 'failed' WHERE id = ?`, [id]);
}
