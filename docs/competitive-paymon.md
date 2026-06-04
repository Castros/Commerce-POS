# Competitive Intelligence — Paymon

**Research date:** June 2026
**Source:** paymon.io public website, app stores, press coverage, $600K pre-seed announcement (Magma Partners / LatamList / Contxto), and a real sales proposal sent to Oxfordian School (March 2026).

---

## Who They Are

Paymon (legal entity: **PM SOLTECH SA DE CV**, Mexico City) is a Latin American school cafeteria POS and student wallet platform. Founded out of the Columbia Alumni Virtual Accelerator (CAVA 2023). Backed by $600K pre-seed from Magma Partners (lead), Alexa Clark (partner), and others.

**Scale (as of mid-2026):** 110+ schools, 30,000+ active users, 25,000+ families. Target: $1M ARR by end of 2025, $4–5M in monthly payments processed.

**Markets:** Mexico (primary) and Ecuador only. Spanish-first. No US presence.

**Target customer:** Private and international schools (K-12). NOT public schools. Named clients include Anáhuac México, Irish School, Oxford School, Humboldt (German school), Innova School, Peterson School, Westhill Institute.

---

## Confirmed Pricing (Oxfordian School Proposal, March 10 2026)

Signed by Jose Javier Cordero, Director General PayMon.

| Item | Price | Notes |
|---|---|---|
| Software license — unlimited students + staff | **$6,700/month** + IVA | Per operational school month (≈10 months/school year) |
| POS terminal (optional) | **$2,800 one-time** + IVA | Android tablet + card reader + receipt printer + SIM card, pre-integrated |
| Transaction fee | **2.9%** on card / debit / bank transfer payments | Can be passed to end consumer (parents) |

**Contract terms:**
- Full school year commitment ("contrato por ciclo escolar completo") — not monthly, not cancellable mid-year.
- Transaction fee is explicitly transferable to parents.

**Revenue math at current scale:**
- 110 schools × $6,700 × 10 months = ~$7.37M MXN/year in software ≈ $410K USD
- Their $600K seed is subsidizing operations; they are likely pre-breakeven.
- Real profitability requires: (a) reaching ~250–300 schools, or (b) expanding to all school payments (tuition, transport, events) to multiply transaction volume 5–10x without new school acquisition.

**The 2.9% fee mechanics:**
- Applies only when money enters the system via card or bank transfer (wallet top-ups and direct card sales at POS).
- Does NOT fire on every cafeteria purchase — a student's $50 lunch from a pre-loaded wallet incurs no additional fee.
- Paymon's processor (likely Conekta or Stripe Mexico) charges them ≈2.4–2.6%, so net margin on transaction fees is thin (~0.3–0.5%).
- Schools often pass the fee to parents, creating invisible per-top-up charges parents don't see clearly.

---

## Product Features

### Operator / school side
- Android POS app per consumption point (each cafeteria station gets its own app)
- Admin web + iOS/Android app for managing in-person and digital sales
- Menu and product management (prices, availability, categories)
- Real-time sales reports by product, user, location, period
- Inventory tracking
- Multi-register and multi-location user management
- Daily cash drawer close with per-user/device reports
- Cash, card, bank transfer, and **credit sales** (ventas a crédito — run a tab)
- Onboarding materials + training
- Dedicated account executive per school
- Support Mon–Fri 7am–5pm only

### Parent / student side (mobile app)
- Wallet top-up via credit/debit card, Banco Pichincha instant transfer (Ecuador), manual bank transfer, or cash deposit at school
- Real-time purchase notifications and spending alerts
- Daily and historical consumption view
- **Allergy registration** — products flagged as containing the allergen will be blocked from sale to that child
- **Product blocking** — parents can individually block specific menu items
- **Day-of-week spending limits** — e.g. max $100 MXN on Tuesdays
- **Pre-ordering** — parents purchase a meal in advance for a specific day/time; student picks it up
- Monthly meal subscription plans

### Hardware supported
QR codes · NFC/contactless wristbands ("manillas") · NFC prepaid cards · Fingerprint readers · Username/ID · Mobile app QR (no hardware)

### Adjacent modules (beyond cafeteria)
Extracurricular activities · Transportation fees · School events / ticketing · Marketplace (supplies, uniforms) · Academy class management · Enrollment and recurring tuition billing

---

## Go-to-Market

- Fully sales-led — no self-serve, no public pricing, no free tier. Every CTA is "Request a demo."
- Sales via HubSpot scheduling, WhatsApp, and sales@paymon.io.
- Content marketing / SEO targeting school admin queries and Mexico's 2025 SEP junk food regulation.
- School-by-school direct sales; no district contracts or reseller channel visible.
- No US-market GTM, no English-language content.

---

## Positioning and Messaging

**Tagline:** "La plataforma de pagos para colegios y cafeterías"

**Three quantified claims used on every page:**
- Increase sales by up to 25%
- Save 2–4 hours daily on admin
- Reduce payment complaints by up to 70%

**Core pain points they market against:**
- Cash is slow, error-prone, and theft-prone
- Parents have no visibility into what kids are buying
- Long cafeteria lines during short breaks
- Inability to enforce dietary restrictions (SEP regulatory angle in Mexico)

**Regulatory play:** They turned Mexico's March 2025 SEP ban on junk food in schools into a compliance feature and lead-gen event. Smart timing.

---

## Their Weaknesses / Gaps

| Gap | Opportunity |
|---|---|
| No US market presence | USDA/NSLP compliance, SIS integrations, English-first UI — completely open |
| No public pricing | Self-serve or transparent pricing page is a differentiator |
| Fully cashless-first | Mixed cash + card + wallet environments are common in transitioning schools |
| No SIS integrations | PowerSchool, Infinite Campus, Skyward — table stakes in US |
| No partial refunds / voids | Commerce POS now has this; Paymon doesn't mention it |
| No multi-school group dashboard | School chains and operators need consolidated views |
| No offline mode | Critical for schools with unreliable WiFi |
| Annual-only contracts | Month-to-month or semester pilots are more accessible for small schools |
| 2.9% fee passed to parents | "No hidden fees" / school absorbs processing = strong counter-positioning |
| Support hours Mon–Fri 7am–5pm only | 24/7 or weekend support for cafeteria operations is differentiating |
| App store traction is thin | Only 3 ratings for claimed 30K users |
| No loyalty or gamification | No student engagement mechanics |
| No nutrition compliance | No USDA meal patterns, calorie tracking, allergen disclosure for operators |

---

## What to Build Based on This Research

See CLAUDE.md and AGENTS.md for the prioritized feature list derived from these findings.

The highest-leverage items are:

1. **Parental platform** (spending limits, product blocking, allergen flags, top-up history) — Paymon's deepest moat; match or exceed it.
2. **Pre-ordering** — reduces line time and food waste; real operational value for cafeteria operators.
3. **Transparent fee model** — school absorbs processing or explicit fee disclosure to parents; position against Paymon's passthrough model.
4. **No annual lock-in** — offer monthly or semester commitments for pilots.
5. **Hardware agnosticism** — document NFC, QR, fingerprint support without requiring proprietary terminals.
6. **Full school payments** — tuition, transport, events. Same playbook Paymon is running; the cafeteria is the wedge.
