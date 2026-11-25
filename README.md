# Org finances on Netlify

A static page plus one Netlify Function. On each "Run reports" the function pulls Stripe live and reads two tabs
of a Google Sheet. The function stores nothing; the only saved data is the sheet you maintain.

## 1. Google Sheet (the one stored piece)
Create a sheet with two tabs named exactly `Expenses` and `Rules`.

**Expenses**: paste your bECU export (header row included). Needs a date column, a description column, and either
one Amount column or Debit/Credit columns. Add new months below the old ones.

**Rules** (first row is the header):

    match | org | team | category | ignore
    STRIPE |  |  |  | TRUE
    FIELD RENTAL | voltage |  | Facilities |
    SPORTS ENGINE | summit |  | League fees |

First matching keyword wins (case-insensitive, matches anywhere in the description). `ignore` marks transfers such as
Stripe payouts so they aren't counted as expenses. Expenses with no matching rule show up in "needing a rule".

## 2. Read-only Google access
1. Google Cloud Console: create a project, enable the **Google Sheets API**.
2. IAM > Service accounts > create one, then Keys > Add key > JSON. Download it.
3. Share the sheet with the service account's `client_email` as **Viewer** only.

## 3. Stripe key
Developers > API keys > create a **restricted key** with read access to Charges, Customers, PaymentIntents, Invoices,
Subscriptions, and Balance transactions. Nothing else.

## 4. Netlify environment variables (Site settings > Environment variables; mark as secret)
| Variable | Value |
|---|---|
| `STRIPE_API_KEY` | the restricted key |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the whole downloaded JSON file contents |
| `SHEET_ID` | the long id in the sheet's URL |
| `APP_PASSPHRASE` | optional second lock for the API (see below) |

## 5. Lock it down (this is real financial data and families' names)
- Turn on Netlify's site-wide **password protection** (Pro).
- After deploying, open `https://YOUR-SITE/api/report?start=2026-10-01&end=2026-10-31` in a private window.
  You should get the password prompt, not JSON. If you get JSON, password protection is not covering the function:
  set `APP_PASSPHRASE` so the function itself rejects requests without the passphrase.
- Keep the Stripe key read-only, never put keys in the page code or repo, and don't commit the service account JSON.

## 6. Deploy
    npm i -g netlify-cli
    netlify login && netlify init          # create a site from this folder
    netlify deploy --prod

Try it first with fake data and no credentials:  `DEMO=1 netlify dev`
Tests (no network): `node test.mjs`

## Stripe metadata the reports rely on (set on each subscription)
`org` (summit | voltage), `team`, `player`, `payer_name`. Missing values show as UNASSIGNED.

## Branding
Colors, names, fonts and logos live in `public/brand.js`. The org dropdown switches the whole page theme, and
you can share direct links: `https://YOUR-SITE/?org=voltage` and `https://YOUR-SITE/?org=summit`.

- **Voltage** uses the VBC brand system (black #0A0A0A, yellow #F3E108, teal #24B0B7, diagonal stripes,
  Bangers / Barlow Condensed). The lightning bolt in the header is a simple stand-in; drop your real logo at
  `public/brand/voltage-logo.svg` and it replaces the bolt automatically.
- **Summit** uses the palette, fonts and logo from the Summit Fastpitch website (navy #1b2a41, teal #3eb4aa, Poppins/Inter, `public/brand/summit-logo.png`).
- "all" shows a neutral header naming both organizations.
- Printing (or Save as PDF) switches to a plain white layout so board packets don't use dark ink.
- Fonts load from Google Fonts; if blocked, the page falls back to system fonts.

## Player ledger and fee plans
The page opens with a **Player ledger** (status, paid, remaining, down payment, installments paid vs due, owed now; click a
name for payment history). Plans are in `lib/fees.mjs`: amounts, number of installments, first month and
`skip_months`. Payments are counted by amount (down payment, then installments), so edit the amounts there if a fee changes.
The ledger always uses everything since `season_start`, regardless of the report dates.

## Stripe key permissions
Restricted key, all read-only: Charges, Customers, **PaymentIntents**, Subscriptions, Invoices, Balance transactions.
Tags are read from each payment (its PaymentIntent and charge), so tag the payments themselves.

### Per-player exceptions
`lib/fees.mjs` > `players` lists special cases: `waived` (free), `factor` (e.g. 0.5 = half the whole fee), `installment`
(custom monthly amount), `paid_in_full` (paid outside Stripe, e.g. by check). `match` is a word or full name that must
appear in the player or payer name (whole words only). Add `org: "summit"` to limit a rule to one org.

### Payments received outside Stripe (checks, cash)
Add them to `lib/fees.mjs` > `manual_payments` (date, org, team, player, payer, amount, method). They count in income,
All transactions and the player ledger like any other payment.

## Expense rules, shared payments and budgets (from your workbooks)

**Shared costs:** put `shared` in the `org` column of an Expenses row (or as the org of a rule) and the cost is split 66% Summit / 34% Voltage, as two lines in the reports. The share is `SHARED_SUMMIT_SHARE` in `lib/logic.mjs`.

`lib/builtin.mjs` holds built-in expense rules, the Voltage share of Tahoma School District field payments (`SPLITS`) and
season budgets (`BUDGETS`). Rules on the Google Sheet "Rules" tab are checked first and these are the fallback. A rule can
also have an `amount` to match one exact payment. Add a split when a new TSD payment posts.

## Tahoma Split tab (optional)
A fourth sheet tab named `Tahoma Split` says which Tahoma facility rentals belong to Summit and which to Voltage. Columns:
`Payment date | Invoice | Use date | Event | Amount | Org | Category`. Rows that share a Payment date are one bank payment (their
amounts must add up to the bank withdrawal). Voltage rows are dated by Use date; Summit rows are dated on the payment date.
Payments not listed on the tab use the built-in split in lib/builtin.mjs. Override the range with `TAHOMA_RANGE` if needed.

## Budgets tab (optional)
A tab named `Budgets` with the header `org | category | budget` is the only source of season budgets once it has rows; the built-in budgets (lib/builtin.mjs) are used only if the tab is missing or empty. Categories
not listed keep their built-in amount; a new category is added. A category matches ignoring upper/lower case. Override the range
with `BUDGETS_RANGE`. The forecast treats any category with "contingency" in its name as padding, not planned spending.

## Revenue projection
The Forecast tab starts with a date picker: collected so far plus the installments on the player schedules that fall due by that date, split into players on a subscription, players not on one, and past-due balances. Everything is net of Stripe fees at each org's rate so far.
