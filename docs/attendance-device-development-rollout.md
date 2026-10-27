# Attendance device integration — rollout record

## Confirmed rules

- Saturday–Thursday: 08:00–13:00 and 16:00–21:00, Muscat local time. Friday is a rest day.
- If a scheduled day ends with no reliable checkout, the report shows **21:00 estimated** and **requires review**. No new device punch is fabricated.
- Late minutes, missing punches, and shortfall are review indicators. No automatic absence or payroll deduction is created.
- A monetary deduction is a manager-approved proposal. Pending/rejected proposals are excluded from salary calculations.
- Rejected proposals remain in the monthly review history; a revised proposal gets a new record rather than overwriting the manager's decision.
- A paid monthly payslip blocks retroactive approval of a new attendance deduction; it requires separate accountant review.
- Manual attendance corrections remain visible alongside device punches for the same date and cannot erase or hide the raw evidence.
- Legacy payslips with `paidAt` but no `paidAmount` show an unverified paid amount and unknown balance. New payslips are not marked paid by default.
- Device person `1` must be excluded from the workshop import. User-confirmed mappings include `4 → EMP-0009`, `6 → EMP-0012`, `7 → EMP-0014` (Aqeel). Verify all remaining device IDs before importing; do not hardcode mappings in the SaaS UI.

## Development database

The following migrations were applied to `rrhyglrnlveygyiandhs` only, in order:

1. `20261027070128_hr_attendance_device_events.sql`
2. `20261027070738_hr_attendance_mapping_integrity.sql`
3. `20261027071145_hr_attendance_immutable_privileges.sql`
4. `20261027071532_hr_attendance_mapping_fk_index.sql`

Raw punches are stored separately from the legacy HR JSON setting. Only tenant admins/managers can read or insert. Anonymous access and raw update/delete privileges are blocked. The device's image/biometric column is ignored. Mappings with existing punches cannot be silently reassigned.

## Production database

The same four migrations were applied selectively to `ifnfwssdtjuzdtshnrht` on 27 October 2026 after confirming the scheduled physical backup of 26 October 2026 21:57 UTC. Production migration records are:

| Source file | Production version |
| --- | --- |
| `20261027070128_hr_attendance_device_events.sql` | `20261027080034` |
| `20261027070738_hr_attendance_mapping_integrity.sql` | `20261027080054` |
| `20261027071145_hr_attendance_immutable_privileges.sql` | `20261027080059` |
| `20261027071532_hr_attendance_mapping_fk_index.sql` | `20261027080105` |

The management API assigned Production versions different from the Development source-file versions. This is recorded here; do not run broad `db push` or blindly repair historical migration records. Post-migration checks confirmed two indexed tables, enabled RLS, no anonymous table read, no raw-punch update/delete grant, no new Security Advisor finding for these tables, and zero mappings/punches. No employee or payroll data was migrated.

## Operational flow

1. Export the attendance log from SmartPSS Lite as XLSX.
2. In Staff, open **Import attendance**, review every device person, select the corresponding employee or **Exclude**, then save mappings.
3. Import the file. Re-importing the same file is idempotent; the unique punch key prevents duplicates.
4. Open an employee's Attendance tab and refresh punches. Review estimated checkouts and no-punch dates; print the monthly report if needed.
5. Enter a deduction amount and reason only after human review. The manager must approve it before regenerating an unpaid payslip. Record an actual paid amount/date separately to obtain a verified remaining balance.

## Real-time gate

The device is on private LAN `192.168.100.50`. SmartPSS being online does not connect the device to the cloud ERP. The workshop has no always-on local host, and a vendor-supported direct outbound event/webhook protocol for this exact device has not been verified. Therefore **live device-to-cloud synchronization is not active**. Do not claim real-time attendance or auto-payroll until an always-on gateway or verified secure vendor push solution is installed and tested end to end. Never expose the device or its admin password directly to the public internet.

## Operational verification remaining

The UI release must be checked on the live `/staff` and `/staff/:id` routes under an admin/manager session. Then import a small reviewed period first and reconcile raw rows, employee mapping, proposed deductions, payslip balances, and the printed report. The user must confirm the remaining device-person identities before any historical file import. There is no live device-to-cloud bridge; do not describe manual XLSX import as real-time sync.
