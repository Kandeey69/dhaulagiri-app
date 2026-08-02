export type Party = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  panNo?: string;
  openingBalance: number;
  isActive: boolean;
  createdAt: string;
};

export type Sale = {
  id: string;
  fiscalYearId?: string;
  lifecycleStatus?: import("../../domain/lifecycle").TransactionLifecycleStatus;
  billNo: string;
  dateBs: string;
  dateAd?: string;
  partyId: string;
  salesAmount: number;
  vatAmount: number;
  totalAmount: number;
  remarks?: string;
  postedAt?: string;
  postedBy?: string;
  voidedAt?: string;
  reversedAt?: string;
  reversalReason?: string;
  replacementTransactionId?: string;
  createdAt: string;
};

export type Collection = {
  id: string;
  fiscalYearId?: string;
  lifecycleStatus?: import("../../domain/lifecycle").TransactionLifecycleStatus;
  dateBs: string;
  dateAd?: string;
  partyId: string;
  bankName?: string;
  amount: number;
  receiptNo?: string;
  remarks?: string;
  postedAt?: string;
  postedBy?: string;
  voidedAt?: string;
  reversedAt?: string;
  reversalReason?: string;
  replacementTransactionId?: string;
  createdAt: string;
};

export type CreditNote = {
  id: string;
  fiscalYearId?: string;
  lifecycleStatus?: import("../../domain/lifecycle").TransactionLifecycleStatus;
  creditNoteNo: string;
  dateBs: string;
  dateAd?: string;
  partyId: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  remarks?: string;
  postedAt?: string;
  postedBy?: string;
  voidedAt?: string;
  reversedAt?: string;
  reversalReason?: string;
  replacementTransactionId?: string;
  createdAt: string;
};

export type OutstandingRow = {
  partyId: string;
  partyName: string;
  openingBalance: number;
  totalSales: number;
  totalCollections: number;
  totalAdjustments: number;
  outstanding: number;
};

export type LedgerRow = {
  dateBs: string;
  type: "Opening" | "Sale" | "Collection" | "Adjustment";
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  remarks?: string;
};

export type ActivityLog = {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
};

export type ReceiptAllocation = {
  id: string;
  receiptId: string;
  saleId: string;
  amountNPR: number;
  createdAt: string;
  updatedAt: string;
};
