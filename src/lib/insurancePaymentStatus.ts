export interface InsurancePaymentStatusLike {
  status?: string | null;
}

/** Only settled funds are recognized as collected. Pending cheques are not cash received. */
export function isCollectedInsurancePayment(payment: InsurancePaymentStatusLike): boolean {
  return payment.status === "cleared";
}
