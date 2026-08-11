import {
  normalizeFreightIndiaStatus,
  type AppData,
} from "../purchase/domain";

export function purchaseClosingParties(data: AppData) {
  const balances = new Map(data.parties.map((party) => [party.id, Number(party.openingPayable || 0)]));
  const add = (partyId: string, amount: number) => {
    if (!partyId || !Number.isFinite(amount)) {
      return;
    }
    balances.set(partyId, (balances.get(partyId) ?? 0) + amount);
  };

  data.purchases.forEach((purchase) => {
    add(purchase.vendorPartyId, purchase.supplierAmountNPR);
    add(purchase.customAgentPartyId, purchase.totalAgentPayableNPR);
    if (normalizeFreightIndiaStatus(purchase.freightIndiaStatus) === "To be paid by us") {
      add(purchase.freightIndiaPartyId, purchase.freightIndiaAmountNPR);
    }
  });

  data.localExpenses.forEach((expense) => {
    add(expense.partyId, expense.totalAmountNPR);
  });

  data.payments.forEach((payment) => {
    add(payment.partyId, -payment.amountNPR);
  });

  return data.parties.map((party) => ({
    ...party,
    openingPayable: balances.get(party.id) ?? 0,
    updatedAt: new Date().toISOString(),
  }));
}
