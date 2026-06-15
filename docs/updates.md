Good — that's the right call, and it's worth being precise about what "I won't hold money" has to mean architecturally, because there's a version of "some kind of connection" that quietly makes you a custodian anyway. Let me also dig into the CFDI piece properly since you flagged it.Right, and "I won't hold money" is the correct spine for this — you just have to make sure the *connection* you build actually honors it, because there's a version that violates it by accident.

## What "not holding money" has to mean architecturally

The rule that keeps you a SaaS vendor and not an accidental IFPE is: **the school (or the processor) is always the merchant of record and the settlement recipient.** Funds can pass *through* a processor in transit, but they must never land in a Commerce-POS-controlled account that you then pay out to schools. The moment you're the one receiving and disbursing, you're custodying — that's the line.

Within that rule you have three flavors of "connection," and they trade cleanliness against revenue:

1. **Record-only (cleanest, $0 payment revenue).** School runs their own Clip/Mercado Pago terminal or takes cash; your POS just records the method. You already have this (`card recorded as payment method only`). Zero processor exposure. Top-ups happen at the front desk and staff records them. Revenue = subscription only.

2. **Connected accounts (clean *and* monetizable).** Parent pays online → funds settle to the **school's** connected account → you skim a platform fee. With Stripe Connect this is `application_fee` on **direct charges** (charge created on the school's connected account, so the *school* is merchant of record — stay away from destination charges, where you're closer to the middle). This is still "not holding money," and it's the exact mechanism that answers your "income from every use" question from earlier — a software/platform fee, not financial intermediation. Stripe MX covers MXN/OXXO/SPEI, which your own deployment notes already flag.

3. **The trap to never build:** funds hit *your* account, you disburse to schools. That's custody → IFPE. Don't.

For the wallet specifically — the one place money enters — flavor 2 means the top-up settles to the school's connected account and your wallet stays a **closed-loop ledger** of what that school owes the student. Keep it closed-loop: spendable only at that school's own stores. The second a balance becomes spendable across vendors (your future marketplace module), you've gone open-loop and the regulatory read changes.

## CFDI — and a correction to what I said two turns ago

I lumped "fees/tuition" and the IEDU complemento together earlier. For a *cafeteria*, that's the wrong scope, and the difference is in your favor:

**Cafeteria food sales are plain CFDI 4.0 de Ingreso. The *complemento IEDU* does not apply** — IEDU is the *instituciones educativas privadas* complemento that lets parents deduct **colegiaturas**, and it's only for tuition. Food isn't deductible for individuals, so it never carries IEDU. You only inherit IEDU the day you expand into tuition billing. So cafeteria CFDI is meaningfully lighter than the school-admin incumbents make it look.

Three things that follow:

**You are never the emisor.** The school (or whoever holds the cafeteria concession and books the income) issues the CFDI under *their* RFC. You're not the emisor any more than you're the fund custodian — same philosophy. That means per-org SAT config, not one global Fransolution RFC.

**Most sales are *público en general*.** The vast majority of $45-torta transactions go to the generic RFC (`XAXX010101000`) and get rolled into a **factura global** emitted at period close (daily/weekly/monthly — your choice). You only stamp an **individual** CFDI when a parent actually asks, and only then do you need their full fiscal data: RFC, name/razón social exactly as SAT has it, código postal, régimen fiscal, and uso CFDI. For a cafeteria, individual requests will be low-volume. So you're mostly building one periodic factura-global job, not a per-sale invoicing engine.

**Use a PAC, don't build timbrado.** Integrate a Proveedor Autorizado de Certificación via REST rather than hand-rolling XML/sellado. Facturama's "Multiemisor" API mode lets you stamp CFDIs for several emisor RFCs from one account, as long as each one's sello digital (CSD) is loaded — that's exactly your multi-tenant shape (one PAC account, one CSD per school). Fiscalapi is a similar multi-RFC option with SDKs in JS, Python, Go, etc.; Finkok and Enlace Fiscal are other PACs. And mirror your money instinct here: let the **PAC custody each school's CSD**, store only references — don't sit on schools' digital seals yourself if you can avoid it.

## What to do now vs. defer

You can launch the two pilots **without** full individual CFDI — even let each school's contador handle facturación manually at first while you wire the PAC. It's needed, but for cafeteria-only it's not a day-one blocker the way it would be for tuition.

What you *should* do now, before data exists (same logic as the MXN-vs-USD fix): add the schema hooks so you're not backfilling later. Concretely —

- `clave_prod_serv` and `clave_unidad` (SAT catalog codes) on products
- fiscal fields on customers/guardians (RFC, razón social, CP, régimen fiscal, uso CFDI default), nullable
- an **immutable** `commerce_cfdi_records` table linked per order — store the UUID/folio fiscal, the stamped XML, and the PDF; never mutate it; cancellations go through the SAT 4.0 cancellation flow with a *motivo*. This fits your existing immutable-ledger discipline cleanly.

That's a small migration now versus a painful one once two schools have a year of orders.

I'm not your contador — the emisor structure, factura-global periodicity, and which régimen each school files under are things to confirm with a Mexican fiscal advisor per school. But the architecture above is the standard SaaS-POS shape that keeps both the money *and* the SAT credentials out of your hands.

Want me to draft those CFDI schema additions (products + customers + the immutable `cfdi_records` table + a factura-global job) as a numbered migration against your existing structure, or spec the Stripe Connect direct-charge top-up flow first?