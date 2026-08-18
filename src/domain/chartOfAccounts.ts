export type AccountCode =
  | '1000'
  | '1100'
  | '1200'
  | '1300'
  | '1400'
  | '2000'
  | '2100'
  | '2200'
  | '2300'
  | '2400'
  | '2600'
  | '3000'
  | '4000'
  | '4100'
  | '5000'
  | '5100'

export type AccountDefinition = {
  code: AccountCode
  name: string
  normalBalance: 'DEBIT' | 'CREDIT'
}

export const chartOfAccounts: Record<AccountCode, AccountDefinition> = {
  '1000': { code: '1000', name: 'Cash / Bank', normalBalance: 'DEBIT' },
  '1100': { code: '1100', name: 'Accounts Receivable', normalBalance: 'DEBIT' },
  '1200': { code: '1200', name: 'Inventory / Landed Cost', normalBalance: 'DEBIT' },
  '1300': { code: '1300', name: 'Input VAT Receivable', normalBalance: 'DEBIT' },
  '1400': { code: '1400', name: 'Fixed Assets', normalBalance: 'DEBIT' },
  '2000': { code: '2000', name: 'Indian Supplier Payable', normalBalance: 'CREDIT' },
  '2100': { code: '2100', name: 'Customs Agent Payable', normalBalance: 'CREDIT' },
  '2200': { code: '2200', name: 'Indian Transport Payable', normalBalance: 'CREDIT' },
  '2300': { code: '2300', name: 'Local Supplier Payable', normalBalance: 'CREDIT' },
  '2400': { code: '2400', name: 'Output VAT Payable', normalBalance: 'CREDIT' },
  '2600': { code: '2600', name: 'Landed Cost Clearing', normalBalance: 'CREDIT' },
  '3000': { code: '3000', name: 'Equity / Opening Balance', normalBalance: 'CREDIT' },
  '4000': { code: '4000', name: 'Sales Revenue', normalBalance: 'CREDIT' },
  '4100': { code: '4100', name: 'Sales Return / Credit Note', normalBalance: 'DEBIT' },
  '5000': { code: '5000', name: 'Local Expense', normalBalance: 'DEBIT' },
  '5100': { code: '5100', name: 'Bank Charges / Commission', normalBalance: 'DEBIT' },
}
