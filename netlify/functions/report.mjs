import { timingSafeEqual } from "node:crypto";
import { buildReport, chargesFromStripe, subscriptionTagLookup, mergeBudgets, rowsFromSheet, rulesFromSheet, splitsFromSheet, subsFromStripe } from "../../lib/logic.mjs";
import { getBalance, getCharges, getInvoices, getSheetTabs, getSubscriptions } from "../../lib/sources.mjs";
import { demoData } from "../../lib/demo.mjs";
import { FEES } from "../../lib/fees.mjs";
import { BUDGETS, BUILTIN_RULES, SPLITS } from "../../lib/builtin.mjs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function passphraseOk(req) {
  const expected = process.env.APP_PASSPHRASE;
  if (!expected) return true; // not configured: rely on Netlify's site password
  const given = Buffer.from(req.headers.get("x-passphrase") || "");
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export default async (req) => {
  const headers = { "cache-control": "no-store" };
  if (!passphraseOk(req)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });

  const url = new URL(req.url);
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";
  const org = (url.searchParams.get("org") || "all").toLowerCase();
  if (!DATE.test(start) || !DATE.test(end)) {
    return Response.json({ error: "start and end must be YYYY-MM-DD" }, { status: 400, headers });
  }
  // Also pull back to the season start so the player ledger sees every payment, not just the selected dates.
  const pullFrom = start < FEES.season_start ? start : FEES.season_start;
  const startTs = Math.floor(Date.parse(pullFrom + "T00:00:00Z") / 1000);
  const endTs = Math.floor(Date.parse(end + "T23:59:59Z") / 1000);

  try {
    let charges, subs, tabs, subLookup = "n/a", stripeBalance = null;
    if (process.env.DEMO === "1") {
      const d = demoData();
      charges = d.charges; subs = d.subs; tabs = { expenses: d.expenses, rules: d.rules };
    } else {
      const [rawCharges, rawSubs, sheet, rawInvoices, bal] = await Promise.all([
        getCharges(startTs, endTs), getSubscriptions(), getSheetTabs(),
        getInvoices(startTs, endTs).catch(() => null), // no Invoices access: payments just keep their own tags
        getBalance().catch(() => null), // no Balance access: the card just leaves it out
      ]);
      stripeBalance = bal;
      subLookup = rawInvoices ? "ok" : "unavailable";
      charges = chargesFromStripe(rawCharges, rawInvoices ? subscriptionTagLookup(rawSubs, rawInvoices) : null);
      subs = subsFromStripe(rawSubs);
      tabs = sheet;
    }
    // The Tahoma Split tab (if present) decides each Tahoma payment's Summit/Voltage split; the built-in split covers the rest.
    const sheetSplits = tabs && tabs.tahoma ? splitsFromSheet(tabs.tahoma) : [];
    const splits = [...sheetSplits, ...SPLITS.filter((b) => !sheetSplits.some((x) => x.date === b.date))];
    const report = buildReport({
      charges, subs, start, end, org, splits,
      budgets: mergeBudgets(BUDGETS, tabs && tabs.budgets), // the Budgets tab is the source; built-ins are only used if the tab is missing or empty
      bankRows: tabs ? rowsFromSheet(tabs.expenses) : null,
      rules: [...(tabs ? rulesFromSheet(tabs.rules) : []), ...BUILTIN_RULES], // sheet rules win; built-ins are the fallback
    });
    report.range = { start, end, org };
    report.generated = new Date().toISOString();
    report.expense_count = report.expenses ? report.expenses.length : 0;
    report.stripe_balance = stripeBalance;
    report.demo = process.env.DEMO === "1";
    report.sheet_configured = !!tabs;
    report.sub_lookup = subLookup;
    report.tagged_via_subscription = charges.filter((c) => c.via_sub).length;
    report.sheet_url = process.env.SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID}/edit` : "";
    return Response.json(report, { headers });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500, headers });
  }
};

export const config = { path: "/api/report" };
