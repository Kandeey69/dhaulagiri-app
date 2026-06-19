const SUITE_VAT_RATE_KEY = "suite-agent-service-vat-rate";

export function getSuiteVatRatePercent() {
  const value = Number(localStorage.getItem(SUITE_VAT_RATE_KEY) ?? 13);
  return Number.isFinite(value) && value >= 0 ? value : 13;
}

export function calculateVatAmount(amount: number) {
  return Number((Number(amount || 0) * (getSuiteVatRatePercent() / 100)).toFixed(2));
}
