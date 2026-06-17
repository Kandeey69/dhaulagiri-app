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
  billNo: string;
  dateBs: string;
  dateAd?: string;
  partyId: string;
  salesAmount: number;
  vatAmount: number;
  totalAmount: number;
  remarks?: string;
  createdAt: string;
};

export type Collection = {
  id: string;
  dateBs: string;
  dateAd?: string;
  partyId: string;
  bankName?: string;
  amount: number;
  receiptNo?: string;
  remarks?: string;
  createdAt: string;
};

export type CreditNote = {
  id: string;
  creditNoteNo: string;
  dateBs: string;
  dateAd?: string;
  partyId: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  remarks?: string;
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
