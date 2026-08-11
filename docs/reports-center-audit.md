# Reports & Exports Center audit

Date: 2026-07-29

Scope: local code review only. No production migration, commit, push, or deployment was performed.

## Findings

| Existing report | Route | Current source | Calculation / data problem | UI / performance problem | Decision | New destination |
|---|---|---|---|---|---|---|
| Legacy reports hub | `/reports` | Local stores through `reportsEngine.ts` | Several reports aggregate cached work orders, expenses and sales in the browser; historical implementations can treat work-order values as financial facts | Filter state uses persisted browser state; back/share URLs are not the source of truth | Keep for compatibility, replace progressively | `/reports-center` |
| Old exports catalog | `/reports/center` | Static links | No verified totals or source notes | Arabic-only cards; no business-type/date URL state | Redirect | `/reports-center` |
| Executive dashboard | `/dashboard/executive` | Dashboard/accounting queries | Must not be used as the report accounting source until every metric is invoice/payment/actual-expense based | Separate filters and cache | Keep | Overview catalog |
| Completed / pending collection | `/reports/completed-without-invoice` | `useInsuranceClaims`, `useInsuranceInvoices`, `useClaimPayments` | Loads three complete collections and aggregates in the browser; report title and implemented condition are not the same concept | No server pagination; totals depend on loaded arrays | Replace data layer | Invoices & Collections |
| Overdue invoices | `/reports/overdue-invoices` | Existing invoice hooks | Requires server-side outstanding and due-date calculation | No unified business-type URL filter | Keep then replace data layer | Invoices & Collections |
| Cloud advanced reports | `/reports/cloud-advanced` | Five direct Supabase table queries | Loads complete period rows and aggregates client-side; estimates input VAT from expenses when purchase VAT is absent; this is not an official accounting source | Large period requests and duplicate transformations for screen/export | Keep only as legacy | Combined / Profitability |
| Work-order statement | `/reports/work-orders-statement` | Work orders and linked stores | Must not recognize work-order subtotal or estimated costs as actual revenue/cost | Large client-side report/PDF | Keep then replace data layer | Operations |
| Parts profit | `/reports/parts-profit` | Expense/store item metadata | Depends on expense categorization and cached rows | Client aggregation | Keep then replace data layer | Expenses & Costs |
| Monthly report | `/reports/monthly` | Multiple local/cloud sources | “Net profit” cannot be asserted unless indirect expenses are complete | PDF-specific data flow differs from screen | Keep, relabel after accounting verification | Profitability |
| Vehicles over 30 days | `/reports/vehicles-over-30-days` | Claims/work orders and stay settings | Operational only; should use actual arrival/delivery dates | Needs server pagination for large history | Keep | Performance & Duration |
| Insurance claims list | `/insurance/list` | `insurance_claims` and related entities | Estimate/approved values must remain informational | Existing CSV and table may load broad collections | Keep | Insurance |
| Insurance accounting | `/insurance/accounting` | `insurance_invoices` | Correct insurance source, provided drafts/cancelled invoices are excluded and payments are not double-counted | Separate page state | Keep | Insurance / Invoices |
| Insurance company statement | `/insurance/companies/:id` | Claims, invoices, payments | Joins can multiply invoice/payment rows unless each source is aggregated before joining | Export path separate from report catalog | Keep then use server read model | Insurance |
| Cash invoices | `/sales/invoices` | `sales_documents` | Correct cash source when `doc_type=invoice` and cancelled/draft rows are excluded | Separate filters | Keep | Cash |
| Receipts | `/accounting/receipts` | `claim_payments` plus receipt sources | Only successful statuses may count; insurance and cash need separate sources | Realtime can refetch full lists | Keep then paginate | Invoices & Collections |
| Expenses | `/accounting/expenses` | `expenses` plus synchronous cache | Actual expense source, but report grouping must not include estimates or duplicate linked rows | Client filtering/export of full cache | Keep then paginate | Expenses & Costs |
| VAT exports | `vatOfficialExport.ts` | Sales, insurance invoices, purchases, expenses | Fetches complete period rows and can infer VAT from expense amount; accountant verification required | Screen/PDF/XLSX are built through separate transformations | Keep but do not label official | Combined |
| Report exporters | `reportExporters.ts`, page-specific XLSX/PDF helpers | Client payloads | Multiple number-format rules, including two-decimal legacy output | Screen and exported rows can diverge | Consolidate progressively | `reportExportService.ts` |

## Root causes

1. Reports were added page-by-page, so catalog, filters, calculations and exports do not share one definition.
2. `reportsEngine.ts` is store-backed and performs browser-side aggregation. It is unsuitable for authoritative large financial reports.
3. Several cloud reports fetch all matching records and reduce them in React. Pagination totals therefore cannot be independently verified.
4. Filter state is split between component state and persisted browser state instead of URL parameters.
5. Screen, PDF and Excel often transform data independently.
6. Some old accounting read models fall back to work-order subtotal or estimated costs. The new center deliberately does not consume those models.

## New source rules

| Metric | Authoritative source |
|---|---|
| Estimate | `estimates.subtotal` (informational only) |
| Insurance approval | `insurance_claims.approved_amount` (informational only) |
| Cash invoice revenue | Issued, non-cancelled `sales_documents.subtotal` where `doc_type = invoice` |
| Insurance invoice revenue | Issued, non-cancelled `insurance_invoices.subtotal` |
| VAT | Stored invoice VAT fields only |
| Cash paid | Recorded `sales_payments` |
| Insurance paid | Successful `claim_payments` |
| Actual costs | `expenses` / purchases actually recorded; VAT excluded from profit |
| Gross profit | Issued invoice subtotal minus actual direct costs |

## Implemented local foundation

- Canonical route: `/reports-center`.
- Legacy `/reports/center` redirects without 404.
- Central report catalog and calculation notes.
- URL parameters are the filter source of truth.
- Tenant-aware React Query key includes the complete normalized filter object.
- Query cancellation, placeholder data, stale time, manual refresh, and `refetchOnWindowFocus: false`.
- Business type separation: `all`, `insurance`, `cash`.
- Central XLSX exporter with OMR three-decimal cells.
- Read-only local migration for server-side summary and cloud saved views. It has **not** been applied to Production.
- No fallback to local/store totals when the server summary RPC is unavailable; the UI displays an activation notice instead of an incorrect amount.

## Remaining controlled migration work

The dedicated detail RPCs/read models are now implemented locally. They still
require SQL review against the target schema, controlled database activation,
and data/export parity checks before any legacy report route can be retired.
Existing routes remain available throughout that process.

## Phase 2 implementation matrix

The detailed layer below is implemented locally in
`20260729120000_reports_center_detail_read_models.sql`. It has not been applied
to Production, so manual data parity remains pending until the migration is
reviewed and activated in a later, explicitly approved stage.

| Report key | UI | Server query | Aggregates independent of page | Pagination | Excel | PDF / Print | Manual test |
|---|---|---|---|---|---|---|---|
| `claims-register` | Internal center table | `reports_claims_register_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `insurance-company-statement` | Internal center table | `reports_insurance_company_statement_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `cash-invoices` | Internal center table | `reports_invoices_rpc` forced to cash | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `all-company-invoices` | Internal center table | `reports_invoices_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `work-orders` | Internal center table | `reports_work_orders_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `vehicles-in-workshop` | Internal center table | `reports_vehicles_in_workshop_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `completed-without-invoice` | Internal center table | `reports_completed_without_invoice_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `delivered-awaiting-collection` | Internal center table | `reports_delivered_awaiting_collection_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `payments` | Internal center table | `reports_payments_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `expenses` | Internal center table | `reports_expenses_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `aging` | Internal center table | `reports_aging_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `gross-profitability` | Internal center table | `reports_profitability_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |
| `workshop-duration` | Internal center table | `reports_work_orders_rpc` | Yes | Server | All matching rows | Shared report PDF | Pending DB activation |

### Phase 2 classification

- Insurance: a real `claim_id`, an insurance claim, or an insurance invoice.
- Cash: a customer invoice without a linked claim, or an unlinked work order.
- Unknown: expenses or other records without a structural claim, customer
  invoice, or work-order relationship.
- Unknown records are counted in the data-quality response and are not silently
  treated as cash.

### Legacy status after Phase 2

- The center no longer needs to navigate to a legacy route to display a report.
- Legacy routes remain available for compatibility and are not deleted.
- When the detailed RPC is missing, the UI shows an activation notice and does
  not calculate page-only totals in the browser.
- Screen, XLSX, PDF and print use the same server row result and the same report
  column definition.
