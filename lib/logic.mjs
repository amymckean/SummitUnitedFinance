import { FEES } from "./fees.mjs";
import { BUDGETS, SPLITS } from "./builtin.mjs";
import { buildLedger, manualCharges } from "./ledger.mjs";
// Pure logic: normalize Stripe data, parse bank rows, apply rules, build reports. No I/O.
export const UNASSIGNED = "UNASSIGNED";

const get = (obj, path, dflt) => {
  let cur = obj;
  for (const k of path) {
    if (cur === null || cur === undefined) return dflt;
    cur = cur[k];
  }
  return cur === null || cur === undefined ? dflt : cur;
};

function mergeMeta(...sources) {
  const m = {};
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    for (const [k, v] of Object.entries(s)) if (v !== null && v !== undefined && v !== "") m[k] = v;
  }
  return m;
}

function norm(meta) {
  return {
    org: String(meta.org || UNASSIGNED).trim().toLowerCase(),
    team: String(meta.team || UNASSIGNED).trim(),
    player: String(meta.player || UNASSIGNED).trim(),
    payer: String(meta.payer_name || "").trim(),
  };
}

const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

const idOf = (x) => (x && typeof x === "object" ? x.id : x) || "";

/** Builds a lookup: charge -> metadata of the subscription that produced it (charge > invoice > subscription).
 *  Works with older API versions (invoice.subscription / invoice.payment_intent) and newer ones
 *  (invoice.parent.subscription_details, invoice.payments). Returns null when nothing can be linked. */
export function subscriptionTagLookup(subs, invoices) {
  const subMeta = new Map(subs.map((s) => [s.id, s.metadata || {}]));
  const invSub = new Map(), piInv = new Map();
  for (const inv of invoices || []) {
    const sid = idOf(inv.subscription) || idOf(get(inv, ["parent", "subscription_details", "subscription"])) || idOf(get(inv, ["subscription_details", "subscription"]));
    if (sid) invSub.set(inv.id, sid);
    const pi = idOf(inv.payment_intent);
    if (pi) piInv.set(pi, inv.id);
    for (const ip of get(inv, ["payments", "data"], []) || []) {
      const p2 = idOf(get(ip, ["payment", "payment_intent"]));
      if (p2) piInv.set(p2, inv.id);
    }
  }
  return (ch) => {
    const pi = idOf(ch.payment_intent);
    const invId = idOf(ch.invoice) || idOf(get(ch, ["payment_intent", "invoice"])) || piInv.get(pi);
    const sid = invId && invSub.get(invId);
    return sid ? subMeta.get(sid) || null : null;
  };
}

// ------------------------------------------------------------------ Stripe
export function chargesFromStripe(list, subTags) {
  const out = [];
  for (const ch of list) {
    // Bank (ACH) payments still clearing count as income right away and are flagged "pending"; their fee is unknown until they settle.
    const pending = ch.status === "pending";
    if (!pending && (!ch.paid || ch.status !== "succeeded")) continue;
    const fromSub = subTags ? subTags(ch) : null;
    const meta = mergeMeta(
      // Tags on the payment itself win (the Dashboard's "edit metadata" writes to its PaymentIntent). Below that comes the
      // metadata of the subscription that produced the payment, then the customer's tags as a last fallback.
      get(ch, ["customer", "metadata"]),
      fromSub,
      get(ch, ["payment_intent", "metadata"]),
      ch.metadata,
    );
    const n = norm(meta);
    // Donations and sponsorships from the website carry type=donation|sponsorship (and no team or player). They are income
    // for their org, filed under a "Donations"/"Sponsorships" team and the business or giver's name, and are not player fees.
    const kind = ["donation", "sponsorship"].includes(String(meta.type)) ? String(meta.type) : "";
    if (kind) {
      n.team = kind === "donation" ? "Donations" : "Sponsorships";
      n.player = String(meta.business || meta.payer_name || get(ch, ["billing_details", "name"], "") || "Anonymous").trim();
    }
    out.push({
      kind,
      via_sub: !!(fromSub && !(ch.metadata && ch.metadata.org) && !get(ch, ["payment_intent", "metadata", "org"]) && fromSub.org),
      date: day(ch.created),
      id: ch.id,
      pending,
      gross: ch.amount / 100,
      fee: (get(ch, ["balance_transaction", "fee"], 0) || 0) / 100,
      refunded: (ch.amount_refunded || 0) / 100,
      org: n.org,
      team: n.team,
      player: n.player,
      payer: (n.payer || get(ch, ["billing_details", "name"], "") || get(ch, ["customer", "name"], "") || "") + (meta.honoree ? ` (in honor of ${meta.honoree})` : ""),
    });
  }
  return out;
}

export function statusLabel(sub, inv) {
  if (sub === "past_due" || sub === "unpaid") return "Past due";
  if (sub === "canceled" || sub === "incomplete_expired") return "Canceled";
  if (sub === "paused") return "Paused";
  if (sub === "trialing") return "Trialing";
  if (sub === "active") return inv === "open" || inv === "draft" ? "Invoice open" : "Current";
  return String(sub).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** When a subscription started, when it charges next, when it ends and how many charges are left (null = no end date). */
function subSchedule(s) {
  const item = get(s, ["items", "data", 0], {}) || {};
  const nextTs = s.status === "trialing" && s.trial_end ? s.trial_end : (s.current_period_end || item.current_period_end);
  const next = ["active", "trialing", "past_due"].includes(s.status) && nextTs ? day(nextTs) : "";
  const ends = s.cancel_at ? day(s.cancel_at) : "";
  let left = null;
  if (ends && next) {
    left = 0;
    for (let k = 0; k < 60; k++) {
      const d = new Date(next + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + k);
      if (d.toISOString().slice(0, 10) <= ends) left++; else break;
    }
  }
  return { started: s.start_date || s.created ? day(s.start_date || s.created) : "", next_charge: next, ends, charges_left: left, ends_at_period_end: !!s.cancel_at_period_end };
}

export function subsFromStripe(list) {
  return list.map((s) => {
    const n = norm(mergeMeta(get(s, ["customer", "metadata"]), s.metadata));
    let amount = 0;
    for (const item of get(s, ["items", "data"], [])) {
      amount += ((get(item, ["price", "unit_amount"], 0) || 0) * (item.quantity || 1)) / 100;
    }
    // Show what the family is actually billed, not the list price: apply the subscription's coupon, or (when the
    // last invoice was just this one recurring line) the discount that invoice shows.
    const coupon = get(s, ["discount", "coupon"]);
    const inv = s.latest_invoice && typeof s.latest_invoice === "object" ? s.latest_invoice : null;
    if (coupon && coupon.percent_off) amount = amount * (1 - coupon.percent_off / 100);
    else if (coupon && coupon.amount_off) amount = Math.max(0, amount - coupon.amount_off / 100);
    else if (inv && get(inv, ["lines", "data"], []).length === 1 && inv.subtotal > 0 && inv.total > 0 && inv.total < inv.subtotal) amount = (amount * inv.total) / inv.subtotal;
    amount = Math.round(amount * 100) / 100;
    const paidAt = get(s, ["latest_invoice", "status_transitions", "paid_at"]);
    return {
      id: s.id,
      customer_id: idOf(s.customer),
      org: n.org,
      team: n.team,
      player: n.player,
      payer: n.payer || get(s, ["customer", "name"], "") || "",
      status: statusLabel(s.status, get(s, ["latest_invoice", "status"])),
      amount,
      last_amount: paidAt && inv && inv.amount_paid ? inv.amount_paid / 100 : 0, // what the last payment actually was
      last_paid: paidAt ? day(paidAt) : "",
      ...subSchedule(s),
    };
  });
}

// -------------------------------------------------------------------- bank
export function parseAmount(s) {
  s = String(s ?? "").trim();
  if (!s) return 0;
  const neg = s.startsWith("-") || (s.startsWith("(") && s.endsWith(")"));
  const digits = s.replace(/[^\d.]/g, "");
  if (!digits) return 0;
  const v = parseFloat(digits);
  return neg ? -v : v;
}

export function parseDate(s) {
  s = String(s ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const yr = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${yr}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return "";
}

const findCol = (headers, ...names) => {
  for (const name of names) {
    const i = headers.findIndex((h) => String(h).toLowerCase().includes(name));
    if (i >= 0) return i;
  }
  return -1;
};

/** values: array of row arrays (as returned by Google Sheets). Returns {date, desc, amount} rows. */
export function rowsFromSheet(values) {
  if (!values || !values.length) return [];
  let start = values.findIndex((r) => {
    const low = r.join(",").toLowerCase();
    return low.includes("date") && ["descr", "memo", "payee", "amount"].some((k) => low.includes(k));
  });
  if (start < 0) start = 0;
  const headers = values[start];
  const cDate = findCol(headers, "date");
  const cDesc = findCol(headers, "description", "memo", "payee", "details");
  const cAmt = findCol(headers, "amount");
  const cDebit = findCol(headers, "debit", "withdrawal");
  const cCredit = findCol(headers, "credit", "deposit");
  const cBal = findCol(headers, "running balance", "balance");
  const exact = (n) => headers.findIndex((h) => String(h).toLowerCase().trim() === n); // optional manual columns
  const cOrg = exact("org"), cTeam = exact("team"), cCat = exact("category");
  const cBy = ["paid by", "spent by", "who", "purchaser", "cardholder"].map(exact).find((i) => i >= 0) ?? -1; // optional: who made the purchase
  if (cDate < 0 || cDesc < 0 || (cAmt < 0 && cDebit < 0 && cCredit < 0)) {
    throw new Error(
      "Expenses tab: could not find date, description and amount columns. Headers seen: " + headers.join(", "),
    );
  }
  const rows = [];
  for (const r of values.slice(start + 1)) {
    const date = parseDate(r[cDate]);
    if (!date) continue;
    let amount;
    if (cAmt >= 0 && String(r[cAmt] ?? "").trim() !== "") amount = parseAmount(r[cAmt]);
    else amount = Math.abs(parseAmount(r[cCredit])) - Math.abs(parseAmount(r[cDebit]));
    const row = { date, desc: String(r[cDesc] ?? "").trim(), amount };
    if (cBal >= 0 && String(r[cBal] ?? "").trim() !== "") row.balance = parseAmount(r[cBal]); // BECU's running balance after this row
    const o = cOrg >= 0 ? String(r[cOrg] ?? "").trim().toLowerCase() : "";
    if (o) row.org = o; // an org typed on the sheet row wins over the rules
    if (cTeam >= 0 && String(r[cTeam] ?? "").trim()) row.team = String(r[cTeam]).trim();
    if (cCat >= 0 && String(r[cCat] ?? "").trim()) row.category = String(r[cCat]).trim();
    if (cBy >= 0 && String(r[cBy] ?? "").trim()) row.by = String(r[cBy]).trim();
    rows.push(row);
  }
  return rows;
}

export function rulesFromSheet(values) {
  if (!values || values.length < 2) return [];
  const h = values[0].map((x) => String(x).toLowerCase().trim());
  const idx = (n) => h.indexOf(n);
  const [iM, iO, iT, iC, iI] = ["match", "org", "team", "category", "ignore"].map(idx);
  if (iM < 0) throw new Error("Rules tab needs a header row with a 'match' column.");
  return values
    .slice(1)
    .filter((r) => String(r[iM] ?? "").trim())
    .map((r) => ({
      match: String(r[iM]).trim(),
      org: iO >= 0 ? String(r[iO] ?? "").trim().toLowerCase() : "",
      team: iT >= 0 ? String(r[iT] ?? "").trim() : "",
      category: iC >= 0 ? String(r[iC] ?? "").trim() : "",
      ignore: iI >= 0 && /^(true|yes|y|1|x)$/i.test(String(r[iI] ?? "").trim()),
    }));
}

// When you type an org on a sheet row, the rule's Summit category is renamed to that org's budget line.
const CAT_BY_ORG = { voltage: { "uniforms & apparel": "Uniforms", "tournament entry fees": "Tournament Entry Fees", "equipment & supplies": "Equipment - Misc" } };
const catFor = (r, rule) => {
  const c = r.category || (rule && rule.category) || "Uncategorized";
  return r.category ? c : (r.org && CAT_BY_ORG[r.org] && CAT_BY_ORG[r.org][c.toLowerCase()]) || c;
};

/** Reads the "Tahoma Split" tab: one row per rental line (Payment date, Invoice, Use date, Event, Amount, Org, Category).
 *  Rows with the same payment date make up one bank payment. */
export function splitsFromSheet(values) {
  if (!values || values.length < 2) return [];
  const h = values[0].map((x) => String(x).toLowerCase().trim());
  const ix = (n) => h.indexOf(n);
  const iP = ix("payment date"), iU = ix("use date"), iE = ix("event"), iA = ix("amount"), iO = ix("org"), iC = ix("category"), iI = ix("invoice");
  if (iP < 0 || iA < 0 || iO < 0) return [];
  const by = new Map();
  for (const r of values.slice(1)) {
    const pd = parseDate(r[iP]);
    const cents = Math.round(Math.abs(parseAmount(r[iA])) * 100);
    const org = String(r[iO] ?? "").trim().toLowerCase();
    if (!pd || !cents || !org) continue;
    if (!by.has(pd)) by.set(pd, { date: pd, match: "TAHOMA SD", cents: 0, voltage: [], summit_parts: [] });
    const g = by.get(pd);
    g.cents += cents;
    const category = String(r[iC] ?? "").trim() || (org === "voltage" ? "Uncategorized" : "TSD Facilities");
    const inv = iI >= 0 && String(r[iI] ?? "").trim() ? ` (inv ${String(r[iI]).trim()})` : "";
    const desc = (String(r[iE] ?? "").trim() || "Tahoma School District") + inv;
    if (org === "voltage") g.voltage.push({ date: (iU >= 0 && parseDate(r[iU])) || pd, category, amount: cents / 100, desc });
    else g.summit_parts.push({ date: (iU >= 0 && parseDate(r[iU])) || pd, category, amount: cents / 100, desc });
  }
  return [...by.values()].map((g) => ({ date: g.date, match: g.match, amount: g.cents / 100, voltage: g.voltage, summit_parts: g.summit_parts, sheet: true,
    remainder_org: "summit", remainder_category: "TSD Facilities" }));
}

/** Expenses whose org is "shared" (sheet column or rule) are split between the orgs. */
export const SHARED_ORGS = new Set(["shared", "both", "split"]);
export const SHARED_SUMMIT_SHARE = 0.66;

/** "POS Withdrawal SQ *SNOCO TEAM SALES 5210 136th St SW Edmonds WAUS" -> "SQ *SNOCO TEAM SALES": who was paid, in short. */
export function payeeOf(desc) {
  let t = String(desc || "").replace(/\s+/g, " ").trim()
    .replace(/^(POS|External|ACH|Online|Recurring|Check Card|Debit Card|ATM)?\s*(Withdrawal|Purchase|Payment|Debit)\s*(Transfer to)?\s*/i, (m) => (/transfer to/i.test(m) ? "Transfer to " : ""));
  t = t.replace(/^\d{6,}\s+/, ""); // a leading terminal or phone number
  const cut = t.search(/\s#?\d{2,}\b/); // street numbers, store numbers and phone numbers start the location part
  if (cut > 3) t = t.slice(0, cut);
  return t.replace(/\s+(WA|WAUS|US|USA)$/i, "").trim() || String(desc || "").trim();
}

export function classify(rows, rules, start, end, splits = SPLITS) {
  const expenses = [], ignored = [], deposits = [];
  for (const r of rows) {
    if (r.date < start || r.date > end) continue;
    const rule = rules.find((x) => x.match && r.desc.toUpperCase().includes(x.match.toUpperCase())
      && (x.amount === undefined || Math.abs(Math.abs(r.amount) - Number(x.amount)) < 0.005));
    if (rule && rule.ignore) { ignored.push(r); continue; }
    if (r.amount >= 0) { deposits.push(r); continue; }
    const split = r.org ? null : splits.find((x) => x.date === r.date && r.desc.toUpperCase().includes(x.match.toUpperCase())
      && Math.abs(x.amount + r.amount) < 0.005);
    if (split) { // one shared payment becomes a Voltage part (by category) plus the remainder
      let left = Math.round(-r.amount * 100);
      for (const p of split.voltage) {
        expenses.push({ date: r.date, use_date: p.date && p.date !== r.date ? p.date : "", desc: p.desc || r.desc + " (Voltage share)", amount: p.amount, org: "voltage", team: "", category: p.category, tagged: true });
        left -= Math.round(p.amount * 100);
      }
      for (const p of split.summit_parts || []) { // Summit's own lines when the Tahoma Split tab lists them
        expenses.push({ date: r.date, use_date: p.date && p.date !== r.date ? p.date : "", desc: p.desc || r.desc + " (Summit share)", amount: p.amount, org: "summit", team: "", category: p.category, tagged: true });
        left -= Math.round(p.amount * 100);
      }
      if (!(split.summit_parts && split.summit_parts.length) || Math.abs(left) >= 1) { // whatever is not itemised stays with Summit
        expenses.push({ date: r.date, desc: r.desc + " (Summit share)", amount: left / 100, org: split.remainder_org || "summit", team: "",
          category: split.remainder_category || (rule && rule.category) || "Uncategorized", tagged: true });
      }
      continue;
    }
    const orgTag = r.org || (rule && rule.org) || "";
    if (SHARED_ORGS.has(String(orgTag).toLowerCase())) { // a cost both orgs share: 66% Summit, 34% Voltage (whole cents, so the parts always add up)
      const total = Math.round(-r.amount * 100), sum66 = Math.round(total * SHARED_SUMMIT_SHARE);
      for (const [o, cents, pct] of [["summit", sum66, Math.round(SHARED_SUMMIT_SHARE * 100)], ["voltage", total - sum66, 100 - Math.round(SHARED_SUMMIT_SHARE * 100)]]) {
        expenses.push({ date: r.date, desc: `${r.desc} (${o === "summit" ? "Summit" : "Voltage"} ${pct}%)`, amount: cents / 100, org: o, team: r.team || (rule && rule.team) || "", category: catFor(r, rule), tagged: true, by: r.by || "" });
      }
      continue;
    }
    expenses.push({
      date: r.date,
      desc: r.desc,
      amount: -r.amount,
      org: r.org || (rule && rule.org) || UNASSIGNED,
      team: r.team || (rule && rule.team) || "",
      category: catFor(r, rule),
      tagged: !!(rule || r.org),
      by: r.by || "",
    });
  }
  // A Tahoma Split payment with no matching bank withdrawal yet (an invoice entered before it is paid) still counts as spent,
  // dated on its payment date and marked accrued. Once the bank row appears the normal split above takes over.
  for (const sp of splits) {
    if (sp.date < start || sp.date > end) continue;
    if (rows.some((r) => r.amount < 0 && !r.org && r.date === sp.date && r.desc.toUpperCase().includes(sp.match.toUpperCase()) && Math.abs(sp.amount + r.amount) < 0.005)) continue;
    if (!sp.sheet) continue; // only entries typed on the Tahoma Split tab; the built-in ones always have their bank row
    for (const p of sp.voltage) expenses.push({ date: sp.date, use_date: p.date && p.date !== sp.date ? p.date : "", desc: p.desc, amount: p.amount, org: "voltage", team: "", category: p.category, tagged: true, accrued: true });
    for (const p of sp.summit_parts || []) expenses.push({ date: sp.date, use_date: p.date && p.date !== sp.date ? p.date : "", desc: p.desc, amount: p.amount, org: "summit", team: "", category: p.category, tagged: true, accrued: true });
  }
  return { expenses, ignored, deposits };
}

/** Season budgets come from the "Budgets" tab (org, category, budget). The built-in budgets are only a fallback for when
 *  the tab is missing or empty, so renaming or deleting a category in the sheet is all it takes. */
export function mergeBudgets(base, values) {
  const fallback = () => { const o = {}; for (const [k, cats] of Object.entries(base)) o[k] = { ...cats }; return o; };
  if (!values || values.length < 2) return fallback();
  const h = values[0].map((x) => String(x).toLowerCase().trim());
  const iO = h.indexOf("org"), iC = h.indexOf("category"), iB = h.findIndex((x) => x.startsWith("budget"));
  if (iO < 0 || iC < 0 || iB < 0) return fallback();
  const out = {};
  for (const r of values.slice(1)) {
    const o = String(r[iO] ?? "").trim().toLowerCase(), c = String(r[iC] ?? "").trim();
    if (!o || !c || String(r[iB] ?? "").trim() === "") continue;
    const amt = Math.abs(parseAmount(r[iB]));
    if (Number.isNaN(amt)) continue;
    out[o] = out[o] || {};
    out[o][c] = amt;
  }
  return Object.keys(out).length ? out : fallback();
}

export function budgetVsActual(expenses, budgets, org = "all") {
  const actual = new Map();
  for (const e of expenses) actual.set(e.org + "\u0000" + e.category, (actual.get(e.org + "\u0000" + e.category) || 0) + e.amount);
  const rows = [];
  for (const o of ["summit", "voltage"]) {
    if (org !== "all" && org !== o) continue;
    const b = budgets[o] || {};
    const extra = [...actual.keys()].filter((k) => k.startsWith(o + "\u0000")).map((k) => k.split("\u0000")[1]).filter((c) => !(c in b)).sort();
    for (const c of [...Object.keys(b), ...extra]) {
      const bud = b[c], act = actual.get(o + "\u0000" + c) || 0;
      rows.push({ org: o, category: c, budget: bud ?? null, actual: act, left: bud === undefined ? null : bud - act, pct: bud ? (act / bud) * 100 : null });
    }
  }
  return rows;
}

// ----------------------------------------------------------------- reports
const STATUS_ORDER = { "Past due": 0, "Invoice open": 1, Paused: 2, Trialing: 3, Current: 4, Canceled: 5 };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);

export function incomeByPlayer(charges) {
  const agg = new Map();
  for (const c of charges) {
    const k = [c.org, c.team, c.player].join("\u0000");
    const a = agg.get(k) || { org: c.org, team: c.team, player: c.player, payments: 0, gross: 0, fees: 0, refunds: 0 };
    a.payments += 1; a.gross += c.gross; a.fees += c.fee; a.refunds += c.refunded;
    agg.set(k, a);
  }
  return [...agg.values()]
    .map((a) => ({ ...a, net: a.gross - a.fees - a.refunds }))
    .sort((a, b) => cmp(a.org, b.org) || cmp(a.team, b.team) || cmp(a.player, b.player));
}

export function incomeByTeam(players) {
  const agg = new Map();
  for (const p of players) {
    const k = p.org + "\u0000" + p.team;
    const a = agg.get(k) || { org: p.org, team: p.team, payments: 0, gross: 0, fees: 0, refunds: 0, net: 0 };
    a.payments += p.payments; a.gross += p.gross; a.fees += p.fees; a.refunds += p.refunds; a.net += p.net;
    agg.set(k, a);
  }
  return [...agg.values()].sort((a, b) => cmp(a.org, b.org) || cmp(a.team, b.team));
}

export function expenseSummary(expenses) {
  const agg = new Map();
  for (const e of expenses) {
    const k = e.org + "\u0000" + e.category;
    const a = agg.get(k) || { org: e.org, category: e.category, total: 0 };
    a.total += e.amount;
    agg.set(k, a);
  }
  return [...agg.values()].sort((a, b) => cmp(a.org, b.org) || cmp(a.category, b.category));
}

export function boardSummary(charges, subs, expenses) {
  const orgs = [...new Set([...charges.map((c) => c.org), ...subs.map((s) => s.org), ...expenses.map((e) => e.org)])].sort();
  return orgs.map((org) => {
    const cs = charges.filter((c) => c.org === org);
    const ss = subs.filter((s) => s.org === org);
    const es = expenses.filter((e) => e.org === org);
    const pendingAmt = sum(cs.filter((c) => c.pending), (c) => c.gross);
    const gross = sum(cs, (c) => c.gross), fees = sum(cs, (c) => c.fee), refunds = sum(cs, (c) => c.refunded);
    const spend = sum(es, (e) => e.amount);
    const pastDue = ss.filter((s) => s.status === "Past due");
    return {
      org, gross, fees, refunds, pending: pendingAmt,
      net_income: gross - fees - refunds,
      expenses: spend,
      result: gross - fees - refunds - spend,
      active: ss.filter((s) => s.status !== "Canceled").length,
      past_due: pastDue.length,
      past_due_amount: sum(pastDue, (s) => s.amount),
    };
  });
}

/** Where the bank account stands: the running balance on the latest row of the Expenses tab (whatever the report dates). */
export function bankBalance(rows) {
  const withBal = (rows || []).filter((r) => r.balance !== undefined);
  if (!withBal.length) return null;
  const newestFirst = withBal[0].date >= withBal[withBal.length - 1].date; // BECU exports list the newest row first
  const latest = withBal.reduce((a, r) => (r.date > a ? r.date : a), "");
  const same = withBal.filter((r) => r.date === latest);
  const row = newestFirst ? same[0] : same[same.length - 1];
  return { amount: row.balance, date: row.date };
}

/** Which org the cash in the bank belongs to. Stripe payouts arrive as lump sums, so they are shared out by each org's net
 *  Stripe income (an estimate); other deposits, recorded checks and every expense go to the org they are tagged with (shared costs 66/34).
 *  Whatever can't be assigned is reported as "unassigned" so the rows always add up to the bank balance. */
export function bankByOrg(stripeCharges, bankRows, rules, splits, balance, manual = []) {
  if (!bankRows || !balance) return null;
  const { expenses, deposits } = classify(bankRows, rules || [], "0000-01-01", "9999-12-31", splits || SPLITS);
  const net = new Map();
  for (const c of stripeCharges) if (!c.pending && !String(c.id).startsWith("manual-")) net.set(c.org, (net.get(c.org) || 0) + c.gross - c.fee - c.refunded);
  const netTotal = [...net.values()].reduce((t, x) => t + Math.max(0, x), 0);
  const stripeIn = bankRows.filter((r) => r.amount > 0 && /STRIPE/i.test(r.desc)).reduce((t, r) => t + r.amount, 0);
  const acc = new Map();
  const row = (o) => { if (!acc.has(o)) acc.set(o, { org: o, stripe_in: 0, other_in: 0, spent: 0 }); return acc.get(o); };
  for (const [o, x] of net) if (netTotal > 0 && x > 0) row(o).stripe_in += stripeIn * (x / netTotal);
  for (const d of deposits) row(d.org || "unassigned").other_in += d.amount;
  for (const c of manual) row(c.org || "unassigned").other_in += c.gross; // checks and cash recorded in fees.mjs (their bank deposit rows are ignored by the rules)
  for (const e of expenses) if (!e.accrued) row(e.org || "unassigned").spent += e.amount; // unpaid invoices have not left the bank yet
  const rows = [...acc.values()].map((r) => ({ ...r, balance: r.stripe_in + r.other_in - r.spent }));
  const assigned = rows.reduce((t, r) => t + r.balance, 0);
  const gap = Math.round((balance.amount - assigned) * 100) / 100;
  if (Math.abs(gap) >= 0.01) { const u = rows.find((r) => r.org === "unassigned") || (rows.push({ org: "unassigned", stripe_in: 0, other_in: 0, spent: 0, balance: 0 }), rows[rows.length - 1]); u.balance += gap; u.gap = gap; }
  return rows.sort((a, b) => cmp(a.org, b.org));
}

export function buildReport({ charges, subs, bankRows, rules, start, end, org, fees = FEES, today, splits, budgets }) {
  subs = subs.filter((s) => s.status !== "Canceled"); // hide canceled subscriptions everywhere
  const stripeCharges = charges;
  charges = [...charges, ...manualCharges(fees)]; // checks and cash recorded in lib/fees.mjs
  today = today || new Date().toISOString().slice(0, 10);
  if (org && org !== "all") {
    charges = charges.filter((c) => c.org === org);
    subs = subs.filter((s) => s.org === org);
  }
  // The roster (players with no Stripe activity) must follow the org filter too, or e.g. a Summit player shows up under Voltage.
  const roster = (fees.roster || []).filter((m) => !org || org === "all" || String(m.org).toLowerCase() === org);
  const ledger = buildLedger(charges.filter((c) => !c.kind && c.date >= fees.season_start && c.date <= today), subs, { ...fees, roster }, today);
  charges = charges.filter((c) => c.date >= start && c.date <= end);
  let expenses = [], ignored = [], deposits = [];
  if (bankRows) {
    ({ expenses, ignored, deposits } = classify(bankRows, rules || [], start, end, splits || SPLITS));
    if (org && org !== "all") expenses = expenses.filter((e) => e.org === org || e.org === UNASSIGNED);
  }
  const tagged = expenses.filter((e) => e.tagged);
  const giving = charges.filter((c) => c.kind).sort((a, b) => cmp(b.date, a.date) || cmp(b.id, a.id)); // donations and sponsorships
  const players = incomeByPlayer(charges.filter((c) => !c.kind)); // player fees only
  const flag = (x) => x.org === "unassigned" || x.team === UNASSIGNED || x.player === UNASSIGNED;
  return {
    unassigned: charges.filter(flag).length + subs.filter(flag).length,
    board: boardSummary(charges, subs, tagged),
    status: [...subs].sort(
      (a, b) => cmp(a.org, b.org) || cmp(a.team, b.team) ||
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || cmp(a.player, b.player),
    ),
    players,
    giving,
    teams: incomeByTeam(players),
    transactions: [...charges].sort((a, b) => cmp(b.date, a.date) || cmp(b.id, a.id)),
    ledger: ledger.rows,
    ledger_skipped: ledger.skipped,
    as_of: today,
    bank_loaded: !!bankRows,
    bank_balance: bankBalance(bankRows),
    bank_by_org: bankByOrg(stripeCharges, bankRows, rules, splits, bankBalance(bankRows), manualCharges(fees)),
    exp_summary: expenseSummary(tagged),
    budget: bankRows ? budgetVsActual(tagged, budgets || BUDGETS, org) : [],
    expenses: expenses.map((e) => ({ ...e, payee: payeeOf(e.desc) })),
    untagged: expenses.filter((e) => !e.tagged),
    ignored: ignored.length,
    deposits: deposits.length,
    deposit_total: sum(deposits, (d) => d.amount),
  };
}
