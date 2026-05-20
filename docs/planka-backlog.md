# Commerce POS Planka Backlog

This backlog captures the current POS build state and the next product tasks that should
be mirrored into Planka once board access is available.

## Now

- Staff PIN login and browser sessions
- Real logout and session recovery in the shell
- Demo staff seeding for register sign-in
- Admin settings surface for PIN access and store assignments

## Next

- Parent receipt email flow
- Parent notification email preferences
- Register UI for sending a receipt to a parent email
- Receipt email delivery provider integration
- Location-level staffing and register assignment rules
- Stronger store scoping for cashier and manager accounts
- Receipt formatting for printable and emailed copies

## Soon

- Parent balance alerts for low balance / blocked status
- Parent top-up flow from the student-facing app
- Multi-location inventory visibility for super admins
- Supplier invoice approval workflow hardening
- CSV inventory upload review and apply flow polish

## Later

- Notification templates, delivery status, and audit history for email sends
- NFC card / bracelet issuance flow cleanup
- Reader hardware setup guide for schools
- Production deployment and backup / restore runbook

## Notes

- Commerce POS remains the owner of wallet, sales, refunds, and inventory writes.
- Student identity can link from the educational app or live inside Commerce POS.
- Staff access should stay PIN-based for register use, with admin-only settings in the
  settings and staff modules.
