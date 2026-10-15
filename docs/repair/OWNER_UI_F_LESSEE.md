# Owner UI — Sub-section F: Lessee screen

**Parent map:** [OWNER_UI_SPEC.md](./OWNER_UI_SPEC.md) §F  
**Route:** `/#/repair/lessee/:token` (login-free)  
**Requires tip:** `d172911` (§F r2) for **r3**; earlier: `fda2956` (§F), `81034cc` (§E r2)

## Access

Signed expiring link from Resp 6 email, scoped to **one estimate + one send**.

| Rule | Behavior |
|---|---|
| Scope | Resp 6 lines + granted attachments from that send only |
| Expiry | `response_due_at + 30 days` |
| After respond | Link stays readable (**read-only**); decide → 409 |
| Manual record | Link closed: **"A response was already recorded"** |
| Newer send | Revokes older links (`SUPERSEDED`) |
| Expired / revoked | 401 |

## Page (r2 readability)

- **RESIDCO** brand header; car; shop + location  
- **BRC header block** (4 cols) — not the 500-byte Data File header; blanks → "—"  
- Resp 6 line grid: white + subtle zebra, dark header; no cents sub-line; job codes not struck; money `$` commas right-aligned  
- Columns: Line, Loc, Qty, C, AJOB, QA, Description, WM, RJOB, QR, Resp, Labor, Material, Amount (+ CID if present). Drop 500/PM  
- Description wraps; hover shows full text  
- **Sticky footer:** Resp 6 total + Accept / Reject  
- Loc / WM / C / Resp code hovers (`<code> – <description>`; missing → `<code> – not in reference table`)  
- Granted photos/docs via §E viewer in **lessee mode**  
- Downloads: `*_Resp6.pdf` + `*_Resp6Byte500.txt`

## Actions (whole estimate only) — never silent

Accept, or Reject with **required** comment. Confirm asks name + email (Reject comment). Loading lock on Confirm (AlertDialog must not auto-dismiss mid-POST).

Success banner: **`Accepted on <date time ET> by <name>. Thank you.`** Page becomes read-only with decision at top. Errors **400 / 401 / 409 / network** shown in red — never silent.

## Response window

Default **3 business days** (Mon–Fri, skip `ownerHolidays`), floored at **≥72 hours**. Configurable per tenant / entity.

Email Description uses **"within 3 business days"** (not "48 hours").

## No response

**Never auto-approve.** When the window passes: flag **Lessee response overdue**. Owner may **Resend** or **Record lessee response** (manual).

## Owner side (Estimate Review) — r2 + r3

Badge: Sent / Viewed / Accepted / Rejected / Overdue. Manual: **`Accepted (manual) – <name>, <time>`** (or Rejected). Show decider **name, email, ET time, comment**. History updates on refresh and **30s polling**. `GET …/lessee-status` is `Cache-Control: no-store` and prefers the latest non-SUPERSEDED send/revision.

### Record lessee response (r3)

**Owner** and **managing partner** only; only while current send is **Sent / Viewed / Overdue**. Shop / lessee → **403**.

Dialog fields:

| Field | Rule |
|---|---|
| Decision | Accept / Reject |
| Lessee contact | Name + email required |
| Date/time received | Default now (ET) |
| Method | Email / Phone / Other |
| Note | Required |
| Proof | Optional `.msg` / `.eml` / PDF → Document Viewer category **Lessee Approval**, `owner_only`, tied to send |

On save:

- Status **`APPROVED_MANUAL`** or **`REJECTED_MANUAL`** against the current send’s exact revision lines + total (integer cents)
- Audit: recorded by `<user>`
- Close lessee link (`A response was already recorded`)
- Clear Overdue flag
- History shows who recorded + opens attached proof

### Undo (r3)

**Owner only** (managing partner → 403). Required reason. Reopens send to **Sent**. **Never deletes history** — appends `UNDO` decision row.

## Smoke / typecheck

```powershell
npm run repair:typecheck-client-lessee
npm run repair:smoke-lessee
npm run repair:smoke-brc-email
```

Covers: accept, reject, overdue flag, expired link, superseded link, scoping, **E2E HTTP Accept/Reject → owner Accepted/Rejected**, public ref lookup hovers, **manual accept + .msg closes link**, owner manual badge, **shop/lessee 403**, **undo → Sent**.
