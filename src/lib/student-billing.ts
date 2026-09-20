export function money(value: number): number {
  return Math.round(Number(value) * 100) / 100;
}

export function settleFromPaid(paymentAmount: number, paidAmount: number): {
  paymentStatus: "PAID" | "UNPAID";
  dueAmount: number;
  paid: number;
} {
  const total = money(paymentAmount);
  const paid = money(paidAmount);
  if (paid < 0) {
    throw new Error("Paid amount cannot be negative");
  }
  if (paid > total) {
    throw new Error("Paid amount cannot be greater than the payment amount");
  }
  const dueAmount = money(Math.max(0, total - paid));
  return { paymentStatus: dueAmount <= 0 ? "PAID" : "UNPAID", dueAmount, paid };
}

export function settleFromLedger(paymentAmount: number, ledgerPaid: number): {
  paymentStatus: "PAID" | "UNPAID";
  dueAmount: number;
} {
  const total = money(paymentAmount);
  const applied = money(Math.min(total, Math.max(0, ledgerPaid)));
  const dueAmount = money(Math.max(0, total - applied));
  return { paymentStatus: dueAmount <= 0 ? "PAID" : "UNPAID", dueAmount };
}

export function derivedPaidAmount(paymentAmount: number, dueAmount: number, paymentStatus: string): number {
  if (paymentStatus === "PAID") return money(paymentAmount);
  return money(Math.max(0, Math.min(paymentAmount, money(paymentAmount) - money(dueAmount))));
}

export function subscriptionDue(input: {
  paymentAmount: number;
  storedDue: number;
  paymentStatus: string;
  ledgerPaid?: number;
}): number {
  if (input.paymentStatus === "PAID") return 0;
  if (input.ledgerPaid != null && !Number.isNaN(Number(input.ledgerPaid))) {
    return settleFromLedger(input.paymentAmount, Number(input.ledgerPaid)).dueAmount;
  }
  return money(Math.max(0, Math.min(input.paymentAmount, input.storedDue)));
}
