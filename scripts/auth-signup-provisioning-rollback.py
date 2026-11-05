"""Development-only Auth trigger proof. Never applies a migration or calls Auth.

Use the existing private, hard-Development-asserting connection helper; do not
copy credentials into this file or accept a DSN/environment connection override.
Main can trial --candidate-migration inside ROLLBACK, then verify the installed
candidate with --expected fixed. Neither mode commits DDL or changes Auth users.
"""

import argparse
import importlib.util
import json
from pathlib import Path


DEV_REF = "rrhyglrnlveygyiandhs"
ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "supabase/tests/auth_signup_provisioning_rollback.sql"

# Only authorization/identity fields are hashed. Never select Auth passwords,
# tokens, email addresses, metadata, connection options or other secrets.
SNAPSHOT = """
select jsonb_build_object(
  'trigger_source_md5', md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)),
  'auth_users', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(jsonb_agg(to_jsonb(s) order by id)::text, '[]')))
    from (select id, role, is_anonymous, is_sso_user from auth.users) s),
  'profiles', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(jsonb_agg(to_jsonb(s) order by id)::text, '[]')))
    from (select id, user_id, tenant_id, role, account_status, is_platform_admin from public.profiles) s),
  'user_roles', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(jsonb_agg(to_jsonb(s) order by id)::text, '[]')))
    from (select id, user_id, tenant_id, role from public.user_roles) s),
  'tenants', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(jsonb_agg(to_jsonb(s) order by id)::text, '[]')))
    from (select id, is_active, subscription_plan, subscription_status from public.tenants) s),
  'public_sequences', (select jsonb_build_object('count', count(*), 'hash', md5(coalesce(jsonb_agg(to_jsonb(s) order by sequencename)::text, '[]')))
    from (select sequencename, last_value from pg_sequences where schemaname = 'public') s)
) as snapshot
"""


def run(helper_path: Path, expected: str, candidate: Path | None = None) -> dict:
    spec = importlib.util.spec_from_file_location("private_dev_connection", helper_path.resolve(strict=True))
    if spec is None or spec.loader is None:
        raise RuntimeError("PRIVATE_DEVELOPMENT_HELPER_REQUIRED")
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    if getattr(helper, "REF", None) != DEV_REF or not callable(getattr(helper, "admin_connection", None)):
        raise RuntimeError("DEVELOPMENT_HELPER_SCOPE_MISMATCH")

    sql = PROOF.read_text(encoding="utf-8")
    if not sql.rstrip().endswith("rollback;"):
        raise RuntimeError("ROLLBACK_PROOF_REQUIRED")
    if candidate is not None:
        if expected != 'fixed' or not candidate.resolve().is_relative_to(ROOT / 'supabase/migrations'):
            raise RuntimeError('LOCAL_FIXED_CANDIDATE_REQUIRED')
        # Coordinator-only DDL trial INSIDE the same rolled-back transaction.
        sql = sql.replace('begin;', 'begin;\n' + candidate.read_text(encoding='utf-8') + '\n', 1)

    # admin_connection itself asserts the Development ref and scoped DB actor.
    # Even though this helper returns an autocommit connection, explicit BEGIN
    # in the proof is rolled back in a finally block, also on assertion failure.
    with helper.admin_connection() as connection:
        if not connection.autocommit:
            raise RuntimeError("EXPECTED_PRIVATE_HELPER_AUTOCOMMIT")
        before = connection.execute(SNAPSHOT).fetchone()[0]
        connection.execute("select set_config('security_audit.signup_expected', %s, false)", (expected,))
        proof_passed = False
        try:
            cursor = connection.execute(sql, prepare=False)
            while cursor.nextset():
                pass
            proof_passed = True
        finally:
            connection.rollback()
            connection.execute("reset security_audit.signup_expected")
            after = connection.execute(SNAPSHOT).fetchone()[0]
            if before != after:
                raise RuntimeError("SIGNUP_PROOF_STATE_CHANGED")
        return {
            "status": "passed" if proof_passed else "failed",
            "expected": expected,
            "development_ref": DEV_REF,
            "trigger_source_md5": after["trigger_source_md5"],
            "auth_users_unchanged": before["auth_users"] == after["auth_users"],
            "profiles_unchanged": before["profiles"] == after["profiles"],
            "user_roles_unchanged": before["user_roles"] == after["user_roles"],
            "tenants_unchanged": before["tenants"] == after["tenants"],
            "all_public_sequences_unchanged": before["public_sequences"] == after["public_sequences"],
            "auth_api_calls": 0,
            "migration_applied": False,
            "candidate_trial_only": candidate is not None,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--helper", type=Path, required=True, help="Existing private Development-asserting probe_connection.py")
    parser.add_argument("--expected", choices=("vulnerable", "fixed"), required=True)
    parser.add_argument("--candidate-migration", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.helper, args.expected, args.candidate_migration), sort_keys=True))
        return 0
    except Exception as error:
        # No raw exception/traceback/DSN: database errors can contain private data.
        print(json.dumps({"status": "failed", "error_type": type(error).__name__, "sqlstate": getattr(error, "sqlstate", None)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
