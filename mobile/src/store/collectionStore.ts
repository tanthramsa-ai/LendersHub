import { create } from 'zustand';
import { CollectionItem, PaymentRecord } from '../types';

interface CollectionState {
  todayItems: CollectionItem[];
  overdueItems: CollectionItem[];
  pendingPayments: PaymentRecord[];   // offline queue
  activeTab: 'today' | 'overdue' | 'completed';
  setTodayItems: (items: CollectionItem[]) => void;
  setOverdueItems: (items: CollectionItem[]) => void;
  setActiveTab: (tab: 'today' | 'overdue' | 'completed') => void;
  addPendingPayment: (payment: PaymentRecord) => void;
  removePendingPayment: (id: string) => void;
  markItemCollected: (itemId: string, amount: number) => void;
}

export const useCollectionStore = create<CollectionState>((set) => ({
  todayItems: [],
  overdueItems: [],
  pendingPayments: [],
  activeTab: 'today',

  setTodayItems: (items) => set({ todayItems: items }),
  setOverdueItems: (items) => set({ overdueItems: items }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  addPendingPayment: (payment) =>
    set((s) => ({ pendingPayments: [...s.pendingPayments, payment] })),

  removePendingPayment: (id) =>
    set((s) => ({ pendingPayments: s.pendingPayments.filter((p) => p.id !== id) })),

  markItemCollected: (itemId, amount) =>
    set((s) => ({
      todayItems: s.todayItems.map((item) =>
        item.id === itemId
          ? { ...item, status: 'PAID' as const, paidAmount: item.paidAmount + amount }
          : item,
      ),
      overdueItems: s.overdueItems.map((item) =>
        item.id === itemId
          ? { ...item, status: 'PAID' as const, paidAmount: item.paidAmount + amount }
          : item,
      ),
    })),
}));
