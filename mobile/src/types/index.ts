// Auth
export interface AgentSession {
  token: string;
  user: AgentUser;
  tenant: TenantInfo;
}

export interface AgentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  phone?: string;
}

export interface TenantInfo {
  id: string;
  companyName: string;
  subdomain: string;
}

// Collections
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
  amount: number;
  paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS';
  referenceNumber?: string;
  paymentDate: string;
  receiptUri?: string;
  syncStatus: 'pending' | 'synced' | 'failed';
  createdAt: string;
}

// Customers
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
  isActive: boolean;
  totalLoans?: number;
  activeLoans?: number;
}

// Loans
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

// Dashboard
export interface AgentStats {
  todayTarget: number;
  todayCollected: number;
  pendingCount: number;
  overdueCount: number;
  collectedCount: number;
  successRate: number;
}

// Navigation
export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Biometric: undefined;
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
};

export type CustomersStackParamList = {
  CustomersList: undefined;
  CustomerDetail: { customerId: string };
};
