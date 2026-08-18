export type StockSource = "Local Purchase" | "Importation";
export type StockDocumentType = "Sale" | "Import Purchase" | "Local Purchase";

export type StockItem = {
  id: string;
  code: string;
  name: string;
  unit: string;
  openingQty: number;
  openingRate: number;
  reorderLevel: number;
  isActive: boolean;
  createdAt: string;
};

export type StockPurchaseLine = {
  id: string;
  billId: string;
  itemId: string;
  quantity: number;
  rate: number;
  amount: number;
  entryRate?: number;
  entryAmount?: number;
};

export type StockSourceSnapshot = {
  sourceAmount?: number;
  sourceAmountNpr?: number;
  sourceCurrency?: string;
  sourceExchangeRate?: number;
  sourceFiscalYearId?: string;
  sourceGrandTotal?: number;
  sourceLandedCostNpr?: number;
  sourceLifecycleStatus?: import("../domain/lifecycle").TransactionLifecycleStatus;
};

export type StockPurchaseBill = {
  id: string;
  billNo: string;
  dateBs: string;
  supplierName: string;
  source: StockSource;
  sourceType?: Extract<StockDocumentType, "Import Purchase" | "Local Purchase">;
  sourceSnapshot?: StockSourceSnapshot;
  referenceNo: string;
  remarks: string;
  items: StockPurchaseLine[];
  createdAt: string;
};

export type StockSalesLine = {
  id: string;
  billId: string;
  itemId: string;
  quantity: number;
  rate: number;
  amount: number;
};

export type StockSalesBill = {
  id: string;
  billNo: string;
  dateBs: string;
  customerName: string;
  sourceSnapshot?: StockSourceSnapshot;
  remarks: string;
  items: StockSalesLine[];
  createdAt: string;
};

export type StockRow = {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  openingQty: number;
  openingValue: number;
  localPurchaseQty: number;
  localPurchaseValue: number;
  importationQty: number;
  importationValue: number;
  salesQty: number;
  salesValue: number;
  closingQty: number;
  averageRate: number;
  closingValue: number;
  reorderLevel: number;
};

export type StockRegisterRow = {
  id: string;
  date: string;
  itemId: string;
  code: string;
  itemName: string;
  particulars: string;
  unit: string;
  receivedQty: number;
  receivedRate: number;
  receivedAmount: number;
  issuedQty: number;
  issuedRate: number;
  issuedSalesRate: number;
  issuedAmount: number;
  balanceQty: number;
  balanceRate: number;
  balanceAmount: number;
};

export type StockCompanyInfo = {
  companyName: string;
  fiscalYear: string;
  companyId?: string;
  fiscalYearId?: string;
};

export type StockDashboardTotals = {
  closingValue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  openingValue: number;
  purchaseValue: number;
  salesValue: number;
};

export type StockLineInput = {
  itemId: string;
  quantity: number;
  rate: number;
  amount?: number;
  entryRate?: number;
  entryAmount?: number;
};

export type StockDocumentReference = {
  documentId: string;
  type: StockDocumentType;
  billNo: string;
  date: string;
  partyName: string;
  amount: number;
  amountCurrency?: "NPR" | "INR" | "USD";
  amountNpr?: number;
  exchangeRate?: number;
  grandTotal?: number;
  landedCostNpr?: number;
  source?: StockSource;
  referenceNo?: string;
  remarks?: string;
  vatAmount?: number;
  calculationVersion?: string;
  calculatedAt?: string;
  lifecycleStatus?: import("../domain/lifecycle").TransactionLifecycleStatus;
  companyId?: string;
  fiscalYearId?: string;
};

export type StockDocumentStatus = StockDocumentReference & {
  isFinal: boolean;
  lineCount: number;
  lineValue: number;
  status: "Entered" | "Pending" | "Mismatch";
  statusReason?: string;
  valuationValue?: number;
};

export type StockEntryTarget = {
  amount?: number;
  amountCurrency?: "NPR" | "INR" | "USD";
  amountNpr?: number;
  billNo?: string;
  calculatedAt?: string;
  calculationVersion?: string;
  companyId?: string;
  date?: string;
  documentId: string;
  exchangeRate?: number;
  fiscalYear?: string;
  fiscalYearId?: string;
  grandTotal?: number;
  landedCostNpr?: number;
  lifecycleStatus?: import("../domain/lifecycle").TransactionLifecycleStatus;
  partyName?: string;
  readOnly?: boolean;
  referenceNo?: string;
  remarks?: string;
  source?: StockSource;
  type: StockDocumentType;
  vatAmount?: number;
};

export type StockUserRole = "Account" | "Master";

export type StockView =
  | "Dashboard"
  | "Line Item Entry (For Sales)"
  | "Line Item Entry (For Purchase)"
  | "Stock Register"
  | "Item Master"
  | "Data Importation";

export type PurchaseEntryType = "Import Purchase" | "Local Purchase";

export type EntryCurrency = "NPR" | "INR" | "USD";

export type StockItemForm = Omit<StockItem, "createdAt">;

export type StockAppProps = {
  activeCompanyId?: string;
  activeFiscalYearId?: string;
  companyInfo?: StockCompanyInfo;
  initialUserRole?: StockUserRole;
  initialTarget?: StockEntryTarget | null;
  isReadOnly?: boolean;
  onBackToModules?: () => void;
  onLogout?: () => void;
  onTargetHandled?: () => void;
};
