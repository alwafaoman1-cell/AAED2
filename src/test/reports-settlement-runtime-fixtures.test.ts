import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql=readFileSync('supabase/tests/reports_settlement_28_case_rollback.sql','utf8');
describe('settlement Development runtime evidence contract',()=>{
  it('exercises 28 independent insurance receipts without changing Production or allocating receipt sequences',()=>{
    expect(sql).toContain('for i in 1..28 loop');
    expect(sql).toContain('DEVELOPMENT_ACK_REQUIRED');
    expect(sql).toContain("'rrhyglrnlveygyiandhs'");
    expect(sql).toContain("'DEV-28-'||i");
    expect(sql).not.toContain('nextval(');
    expect(sql.trim().endsWith('rollback;')).toBe(true);
  });
  it('asserts cash, approved discount and pending cheque independently without null-success',()=>{
    expect(sql).toContain('row.paid is distinct from cash');
    expect(sql).toContain('row.settlement_discount_amount is distinct from discount');
    expect(sql).toContain('row.outstanding is distinct from greatest(amount-cash-discount,0)');
    expect(sql).toContain("'DEV-28-PENDING-'||i");
    expect(sql).toContain('if not found');
  });
  it('verifies actual authenticated report summary, not only administrator table reads',()=>{
    expect(sql).toContain("execute 'set local role authenticated'");
    expect(sql).toContain('public.reports_center_secure_summary_rpc');
    expect(sql).toContain("(summary->>'paid')::numeric is distinct from expected_cash");
    expect(sql).toContain("(summary->>'outstanding')::numeric is distinct from expected_balance");
  });
});

