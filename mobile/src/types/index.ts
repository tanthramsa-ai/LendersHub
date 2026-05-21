// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AgentUser {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: string;
}

export interface TenantInfo {
  id: string;
  companyName: string;
  subdomain: string;
}

export interface AgentSession {
  token: string;
  expiresAt: number; // Unix ms
  user: AgentUser;
  tenant: TenantInfo;
}

export type LoginMethod = 'email' | 'phone';

export interface StoredCredentials {
  subdomain: string;
  identifier: string;   // email or phone
  loginMethod: LoginMethod;
}

export interface BiometricCapability {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: number[];  // LocalAuthentication.AuthenticationType values
  isPrimaryFace: boolean;
  isPrimaryFingerprint: boolean;
}

export type BiometricAuthResult =
  | { success: true }
  | { success: false; error: 'cancelled' | 'lockout' | 'lockout_permanent' | 'not_enrolled' | 'unavailable' | 'unknown'; message: string };

// ─── App state ────────────────────────────────────────────────────────────────

export type AppInitState = 'initializing' | 'ready';

// ─── Field validation ─────────────────────────────────────────────────────────

export interface FieldErrors {
  subdomain?: string;
  identifier?: string;
  password?: string;
}

// ─── Collections ─────────────────────────────────────────────────────────────

export interface CollectionItem {
  id: string;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  installmentId: string;
  installmentNumber: number;
  amountDue: number;
  paidAmount: number;
  dueDate: string;
  status: 'PENDING' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PAID';
  daysOverdue?: number;
  lat?: number;
  lng?: number;
}

export interface PaymentRecord {
  id?: string;
  loanId: string;
  installmentId: string;
  customerName?: string;
  amount: number;
  paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS';
  referenceNumber?: string;
  paymentDate: string;
  receiptUri?: string;
  syncStatus: 'pending' | 'synced' | 'failed';
  createdAt: string;
}

// ─── Customers ────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  customerCode: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  creditScore?: number;
  panNumber?: string;
  createdAt?: string;
  isActive: boolean;
  totalLoans?: number;
  activeLoans?: number;
}

export interface Loan {
  id: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  principal: number;
  interestRate: number;
  termMonths: number;
  status: string;
  outstanding: number;
  firstDueDate?: string;
  disbursedAt?: string;
}

export interface Installment {
  id: string;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
  paid: number;
  status: string;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Splash: undefined;
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: { expiredSession?: boolean } | undefined;
  Biometric: undefined;
  BiometricSetup: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Collections: undefined;
  Customers: undefined;
  Profile: undefined;
};

export type CollectionsStackParamList = {
  CollectionsList: undefined;
  CollectionDetail: { itemId: string };
  PaymentCapture: { item: CollectionItem };
  ReceiptCamera: { loanId: string; installmentId: string };
  PaymentHistory: undefined;
  RouteMap: undefined;
};

export type CustomersStackParamList = {
  CustomersList: undefined;
  CustomerDetail: { customerId: string };
};
