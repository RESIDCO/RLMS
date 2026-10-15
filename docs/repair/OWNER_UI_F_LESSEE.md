# Owner UI — Sub-section F: Lessee screen

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §F  
**Route:** `/#/repair/lessee/:token` (login-free)  
**Requires tip:** `81034cc` (§E r2 BRC PDF + Lessee email)

## Access

Signed expiring link from Resp 6 email, scoped to **one estimate + one send**.

| Rule | Behavior |
|---|---|
| Scope | Resp 6 lines + granted attachments from that send only |
| Expiry | `response_due_at + 30 days` |
| After respond | Link stays readable (**read-only**); decide → 409 |
| Newer send | Revokes older links (`SUPERSEDED`) |
| Expired / revoked | 401 |

## Page

- **RESIDCO** brand header; car; shop + location  
- Resp 6 lines in BRC columns (same `enrichLineFromRaw` as owner)  
- Total matching email / PDF / data file (integer cents)  
- Granted photos/docs via §E viewer in **lessee mode** (`/#/repair/lessee/:token/documents`)  
- Downloads: `*_Resp6.pdf` + `*_Resp6Byte500.txt`

## Actions (whole estimate only)

Accept, or Reject with **required** comment. Collect name + email; confirm dialog; log IP, timestamp, exact `send_version`.

## Response window

Default **3 business days** (Mon–Fri, skip `ownerHolidays`), floored at **≥72 hours**. Configurable per tenant / entity (`lesseeResponseBusinessDays`, `lesseeResponseMinHours`, `lesseeResponseByEntity`).

Email Description uses **"within 3 business days"** (not "48 hours").

## No response

**Never auto-approve.** When the window passes: flag **Lessee response overdue** on the estimate + approval (`OVERDUE`). Owner may **Resend** or **Record phone/email approval** with a required note.

## Owner side (Estimate Review)

Lessee status: Sent / Viewed / Accepted / Rejected / Overdue; due date/time ET; response history; resend + manual record.

## Smoke / typecheck

```powershell
npm run repair:typecheck-client-lessee
npm run repair:smoke-lessee
```

Covers: accept, reject, overdue flag, expired link, superseded link, scoping (no other lines/docs/DV).
