# Vehicle Profit & Loss — Legacy Calculation

## 1. Purpose

This document records how vehicle/work-order profitability is currently or
historically calculated. It does not implement a new report.

The requested compatibility target is:

> Preserve the useful operation-level behavior of the legacy report, but remove
> deleted/void data and replace estimated values with actual accounting sources.

## 2. Legacy entry points

### Routes

There is no current standalone route named
`/accounting/reports/vehicle-profit-loss`.

Legacy report access was previously under `/reports` and is now redirected to
`/reports-center`. Related routes include:

- `/reports`
- `/reports/parts-profit`
- `/reports/work-orders-statement`
- `/dashboard/executive`

The future route must be standalone:

- `/accounting/reports/vehicle-profit-loss`
- `/accounting/reports/vehicle-profit-loss/:operationId`

### Main implementations

- `src/lib/reportsEngine.ts`
  - `buildPerVehicleProfitReport`
  - `getVehicleProfitDetail`
- `src/pages/Reports.tsx`
  - renders the legacy per-vehicle/work-order report and detail row.
- `src/lib/accounting/core.ts`
  - `buildWorkOrderAccountingRows`
- `src/pages/dashboard/ExecutiveDashboard.tsx`
  - consumes the accounting rows.
- `supabase/migrations/20260626110000_accounting_core_views.sql`
  - `accounting_work_order_profit_view`
  - `accounting_dashboard_summary_rpc`

## 3. Reporting grain

Despite the name “per vehicle,” the primary legacy grain is one row per work
order/operation, not one permanently aggregated row per vehicle.

The row contains:

- work order ID/number;
- work order date;
- plate;
- customer;
- vehicle make/model;
- revenue;
- parts cost;
- labour cost;
- additional expenses;
- external vouchers;
- total cost;
- profit;
- margin;
- status;
- technician.

This grain is useful and should be retained. A vehicle with multiple repair
visits should have multiple operation rows, with an optional grouped vehicle
summary above them.

## 4. Current TypeScript calculation

### Revenue

`reportsEngine.ts` builds a map of revenue by work order from active cash sales
invoices:

1. Select documents of type `invoice`.
2. Exclude `isDeleted` and `status=cancelled`.
3. Link to the work order primarily through `fromDocId`.
4. Use invoice `subtotal` as revenue excluding VAT.
5. Sum invoice subtotals for each work order.

Formula:

```text
Revenue ex VAT = sum(active issued cash invoice subtotal linked to work order)
```

Gaps:

- The linkage parser expects a legacy `WO-` convention and can miss cloud UUID
  or direct `work_order_id` links.
- Insurance invoices are stored separately and are not included in this map.
- Draft is not explicitly excluded by `isActiveInvoice`.
- Parent work-order/claim deletion is not validated.

### Costs

The current patched TypeScript report deliberately sets:

```text
partsCost = 0
laborCost = 0
extraExpenses = 0
externalVouchers = sum(expenses linked to work order)
totalCost = externalVouchers
```

This is safer than treating estimates as actual cost, but incomplete:

- actual purchase/part issue cost is not separately classified;
- actual labour vouchers/time costing are not available;
- `extraExpenses` from the work order detail can still appear in the detail
  section even though the row total sets it to zero;
- expense validity/deletion/parent checks are not centralized;
- matching depends on work-order identifiers stored as text.

### Profit and margin

```text
Profit = Revenue ex VAT - Total actual cost
Margin % = Profit / Revenue ex VAT * 100
```

When revenue is zero, margin is displayed as zero. For accounting reporting,
`null / N/A` is preferable because zero revenue has no meaningful margin.

## 5. Current Accounting Core calculation

`accounting/core.ts` uses:

- non-draft, non-cancelled sales invoices;
- invoice subtotal as revenue;
- invoice VAT separately;
- invoice total and paid amount separately;
- active expense records linked to work order or, as a fallback, vehicle plate;
- keyword classification for spare parts, labour, towing/purchase/other.

It correctly keeps estimated work-order parts/labour outside actual cost:

```text
actual spare parts cost = qualifying active expense vouchers
actual labour cost = qualifying active expense vouchers
other expenses = remaining qualifying active expense vouchers
total cost = actual parts + actual labour + other expenses
net profit = invoice subtotal - total cost
```

Important gaps:

1. Plate-based expense fallback can attach costs to the wrong operation when a
   vehicle has multiple work orders.
2. Keyword classification is not an accounting category master.
3. Insurance invoices are not part of `salesStore` and can be omitted.
4. Store data is client-side, not a server-side report query.
5. Deleted work orders and deleted claims are not rejected centrally.

## 6. Historical SQL view calculation

`accounting_work_order_profit_view` is not compatible with the final accounting
rules.

### Revenue fallback

It uses:

```text
coalesce(issued sales invoice subtotal, job_order.subtotal, 0)
```

Therefore, when no issued cash invoice is linked, an operational work-order
subtotal can become accounting revenue.

### Cost fallback

It uses actual classified expense cost when present; otherwise it falls back to:

```text
job_order.parts_cost
job_order.labor_cost
```

Those are estimated/planning fields in the current business rules and must not
be treated as actual cost.

### Deletion handling

The view does not exclude:

- deleted/archived work orders;
- deleted/archived expenses;
- an operation linked to a cancelled/deleted claim;
- active financial children whose operational parent is deleted.

### Insurance

The revenue CTE reads `sales_documents` only. It does not combine qualified
`insurance_invoices`, so insurance profitability can be understated or replaced
by the invalid work-order subtotal fallback.

## 7. Legacy detail behavior

`getVehicleProfitDetail` returns:

- services;
- parts;
- internal extra expenses;
- external expense vouchers.

Current code intentionally leaves estimated service/labour and parts arrays
empty. It does return work-order `extraExpenses` as internal expenses and cloud/
store expense vouchers as external vouchers.

The row calculation and expanded detail can therefore disagree. Future
implementation must build both from the same server result.

## 8. Deleted-record behavior

The legacy report does not have a complete deletion policy.

### Currently excluded in some paths

- `SalesDoc.isDeleted`
- cash invoice `status=cancelled`
- refunded expenses in `accounting/core.ts`
- expense `deletedAt/archivedAt` in some dashboards

### Not reliably excluded

- deleted/archived work order;
- cancelled/deleted insurance claim;
- cancelled/deleted insurance invoice;
- deleted/void payment;
- deleted/archived expense in every report path;
- financial child linked to deleted parent;
- journal entry removed or invalidated independently of its source.

The future report must use one server-side eligibility rule before aggregation.

## 9. Required authoritative formula

### Eligible operation

An operation is reportable only when:

- tenant matches the authenticated tenant;
- work order is active under the official deletion predicate;
- any insurance claim classification is based on an active linked claim;
- no financial child is included when its required operational parent is
  deleted;
- cancelled/void/deleted financial documents are excluded.

### Revenue

```text
Cash revenue ex VAT
  = sum(eligible issued cash invoice subtotal)

Insurance revenue ex VAT
  = sum(eligible issued insurance invoice subtotal)

Operation revenue ex VAT
  = Cash revenue ex VAT + Insurance revenue ex VAT
```

Never use:

- estimate;
- approved amount;
- LPO;
- claim amount;
- work-order subtotal;
- work-order total cost;
- delivered status by itself.

### Collected amount

```text
Collected = sum(eligible cleared/valid payments linked to eligible invoices)
```

Stored `paid_amount` may be shown as a reconciliation field, but payment rows
must be the auditable source. Differences belong in an exception report.

### Direct actual costs

```text
Actual parts cost
  = eligible purchase/expense/stock issue cost assigned to operation

Actual labour cost
  = eligible labour voucher/time cost assigned to operation

Other direct cost
  = eligible direct expense assigned to operation

Total direct cost
  = parts + labour + other direct cost
```

No estimated work-order or claim field enters actual cost.

### Profit

```text
Gross operation profit = Revenue ex VAT - Total direct actual cost
Gross margin % = Gross operation profit / Revenue ex VAT * 100
```

If revenue is zero, margin is `N/A`.

Do not label the result “Net Profit” until an approved overhead allocation
policy exists. Workshop overhead should be shown separately or as an optional
allocated-cost column with the policy disclosed.

## 10. Operation classification

Classification must be explicit and never inferred only from free text.

Recommended priority:

1. Active `claim_id` + insurance work-order type → Insurance.
2. Explicit general/cash work-order type → Cash.
3. Missing or conflicting links → Unknown/Data Quality.

Unknown must not silently become Cash.

## 11. Required drill-down data

The standalone operation page should show:

- work order and active/deleted eligibility result;
- linked claim status and eligibility;
- vehicle/customer snapshots;
- every qualifying invoice and credit note;
- every qualifying payment;
- every qualifying expense/purchase/labour cost;
- VAT separated from revenue/profit;
- source IDs and human document numbers;
- reconciliation differences;
- calculation explanation;
- data-quality warnings.

Deleted rows themselves should not be shown in ordinary detail. Only an
authorized audit report may show audit-log references to deletion events.

## 12. Parity requirements

Screen, XLSX, PDF, and Print must consume the same server response and therefore
share:

- eligibility predicate;
- filters;
- classification;
- revenue formula;
- cost formula;
- rounding;
- totals;
- data-quality flags.

The current legacy implementation does not meet this requirement because row
and detail calculations use different sources and several reports calculate
independently.

## 13. Recommended validation fixtures

Before replacing the old report, verify at least:

1. Cash operation with one invoice and no expense.
2. Insurance operation with one insurance invoice and no expense.
3. Operation with multiple invoices.
4. Operation with multiple payments.
5. Operation with parts, labour, and other direct expenses.
6. Vehicle with multiple work orders.
7. Work order with estimate but no invoice/expense: all actual financial values
   must be zero.
8. Deleted cash invoice.
9. Cancelled insurance invoice.
10. Deleted expense.
11. Deleted work order with active financial child.
12. Deleted claim with active invoice.
13. Failed/bounced payment.
14. Cross-tenant records.
15. Unknown operation type.

## 14. Phase 0 conclusion

The reusable part of the old report is its operation-level presentation and
drill-down concept. Its data source and eligibility rules are not suitable for
the new accounting report center.

The replacement should be built server-side after the accounting foundation
and central active-record rules are approved. Until then, the existing Vehicle
Profit & Loss result is operational/indicative, not a complete accounting
statement.
