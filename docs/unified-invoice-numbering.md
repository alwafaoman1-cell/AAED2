# Unified Invoice Numbering

Official customer invoices issued after the per-tenant cutover use one shared,
atomic sequence for cash and insurance sources:

`INV-YYYY-NNNNNN`

- Cash source: `public.sales_documents`
- Insurance source: `public.insurance_invoices`
- Central registry: `public.invoice_number_registry`
- Draft invoices do not receive an official number.
- Cancellation, voiding and reversal never release or reuse a number.
- Records created before `invoice_numbering_settings.activated_at` that already
  have a number are historical and their number remains unchanged, including
  sales records whose `invoice_status` has drifted to `draft`.
- Historical duplicate numbers are not repaired or backfilled. Search returns
  every tenant-authorized match and requires the user to select the correct
  source/date.

## Dormant legacy source

`public.invoices` is a legacy/dormant customer-invoice source. It currently is
not used to create new invoices and must not be deleted because accounting can
still resolve its technical source IDs. If it is reactivated in the future,
official issuance must first be integrated with the unified allocator.

`public.purchase_invoices` is intentionally excluded. Supplier invoices do not
participate in the customer invoice sequence.

The official invoice number is a display reference. Accounting, payments and
other relations continue to use source UUIDs as technical keys.
