// Run with: node test.mjs   (no network, no credentials)
import assert from "node:assert/strict";
import { buildReport, chargesFromStripe, parseAmount, parseDate, rowsFromSheet, rulesFromSheet, subsFromStripe, statusLabel } from "./lib/logic.mjs";
import { demoData } from "./lib/demo.mjs";

const d = demoData();
const rep = buildReport({
  charges: d.charges, subs: d.subs, start: "2026-10-01", end: "2026-10-31", org: "all",
  bankRows: rowsFromSheet(d.expenses), rules: rulesFromSheet(d.rules),
});
const gross = rep.board.reduce((t, b) => t + b.gross, 0);
// demo (Oct only; Aug down payments are outside the range): 6 x 162 + 3 x 235 + 50 = 1727
assert.equal(Math.round(gross * 100) / 100, 1727);
assert.deepEqual(rep.exp_summary.map((e) => [e.org, e.category, e.total]),
  [["summit", "League fees", 300], ["voltage", "Facilities", 450]]);
assert.equal(rep.untagged.length, 1);
assert.equal(rep.untagged[0].desc, "TARGET #1234");
assert.equal(rep.ignored, 1);
assert.equal(rep.unassigned, 1);
const volt = rep.board.find((b) => b.org === "voltage");
assert.equal(volt.past_due, 1);
assert.equal(Math.round(volt.result * 100) / 100, 492);
assert.equal(rep.transactions.length, 10);
assert.ok(rep.ledger.length === 13); // 11 demo players + Natalie Thody (check) + Jasey Leblanc (roster)

// Tahoma SD payment is split: Voltage share by category, remainder to Summit; built-in rules classify the rest
import { BUILTIN_RULES, SPLITS, BUDGETS } from "./lib/builtin.mjs";
import { classify, budgetVsActual } from "./lib/logic.mjs";
const bank = classify([
  { date: "2026-10-08", desc: "POS Withdrawal TAHOMA SD 25720 MAPLE VALLEY-BLAC", amount: -1159.03 },
  { date: "2026-10-03", desc: "POS Withdrawal HOME BASE * (1 OF 1 PA", amount: -1174.5 },
  { date: "2026-09-12", desc: "POS Withdrawal SQ *SNOCO TEAM SALES", amount: -2074.55 },
  { date: "2026-09-13", desc: "POS Withdrawal SQ *SNOCO TEAM SALES", amount: -49.1 },
  { date: "2026-10-23", desc: "External Deposit STRIPE  - TRANSFER", amount: 226.08 },
  { date: "2026-07-02", desc: "ATM Deposit BECU 26710", amount: 2850 },
], BUILTIN_RULES, "2026-06-01", "2026-11-30", SPLITS);
const tot = (org, cat) => Math.round(bank.expenses.filter((e) => e.org === org && (!cat || e.category === cat)).reduce((t, e) => t + e.amount, 0) * 100) / 100;
assert.equal(tot("voltage", "Turf Practice Facilities"), 116);
assert.equal(tot("voltage", "Dirt Practice Facilities"), 85); // TES Baseball Field Upper slots are dirt
assert.equal(tot("voltage", "Indoor Practice Facilities"), 147.5 + 1174.5);
assert.equal(Math.round(bank.expenses.filter((e) => e.org === "voltage" && (e.use_date || e.date).startsWith("2026-09") && e.category !== "Uniforms").reduce((t, e) => t + e.amount, 0) * 100) / 100, 260.5); // September Tahoma usage
assert.equal(tot("voltage", "Uniforms"), 2074.55);
assert.equal(tot("summit", "TSD Facilities"), Math.round((1159.03 - 348.5 - 11.84) * 100) / 100);
assert.equal(tot("summit", "Uniforms & apparel"), 49.1);
assert.equal(tot("voltage", "Facility convenience fees"), 11.84);
assert.equal(bank.ignored.length, 2);
assert.equal(bank.deposits.length, 0);
assert.ok(budgetVsActual(bank.expenses, BUDGETS).some((b) => b.org === "voltage" && b.category === "Uniforms" && Math.abs(b.left - (4296 - 2074.55)) < 0.001));

// org filter
const only = buildReport({ charges: d.charges, subs: d.subs, start: "2026-10-01", end: "2026-10-31", org: "summit",
  bankRows: rowsFromSheet(d.expenses), rules: rulesFromSheet(d.rules) });
assert.ok(only.players.every((p) => p.org === "summit"));

// parsing edge cases
assert.equal(parseAmount("(12.50)"), -12.5);
assert.equal(parseAmount('$1,000.00'), 1000);
assert.equal(parseAmount("-5"), -5);
assert.equal(parseDate("10/3/2026"), "2026-10-03");
assert.equal(parseDate("2026-10-03"), "2026-10-03");
assert.equal(parseDate("garbage"), "");
const rows = rowsFromSheet([["Preamble"], ["Date", "Description", "Amount"], ["10/01/2026", "A", "(12.50)"], ["10/02/2026", "B", "100"]]);
assert.deepEqual(rows.map((r) => r.amount), [-12.5, 100]);
assert.throws(() => rowsFromSheet([["foo", "bar"], ["1", "2"]]), /Headers seen/);
assert.throws(() => rulesFromSheet([["x"], ["y"]]), /match/);

// Stripe normalization: metadata from subscription snapshot on invoice (new API) and customer (fallback)
const ch = chargesFromStripe([
  { id: "ch_1", created: 1790000000, amount: 16200, paid: true, status: "succeeded", amount_refunded: 0,
    balance_transaction: { fee: 500 }, customer: { name: "Lori Darrin", metadata: { org: "summit" } },
    payment_intent: { metadata: { org: "voltage", team: "10U Black", player: "Liam S", payer_name: "Lori Darrin" } } },
  { id: "ch_2", created: 1790000000, amount: 5000, paid: false, status: "failed" },
]);
assert.equal(ch.length, 1);
assert.deepEqual([ch[0].org, ch[0].team, ch[0].player, ch[0].gross, ch[0].fee], ["voltage", "10U Black", "Liam S", 162, 5]);
const sb = subsFromStripe([{ id: "sub_1", status: "past_due", metadata: { org: "Voltage", team: "T", player: "P" },
  items: { data: [{ price: { unit_amount: 16200 }, quantity: 1 }] }, customer: { name: "X", metadata: {} },
  latest_invoice: { status: "open", status_transitions: {} } }]);
assert.deepEqual([sb[0].org, sb[0].status, sb[0].amount], ["voltage", "Past due", 162]);
assert.equal(statusLabel("active", "open"), "Invoice open");

// ledger
import { buildLedger } from "./lib/ledger.mjs";
import { FEES } from "./lib/fees.mjs";
const mk = (date, gross, org, player) => ({ date, id: date + gross + player, gross, fee: 0, refunded: 0, org, team: "T", player, payer: "" });
const L = buildLedger([
  mk("2026-08-20", 500, "summit", "Melana K"), mk("2026-09-29", 235, "summit", "Melana K"), mk("2026-10-29", 235, "summit", "Melana K"),
  mk("2026-08-20", 250, "voltage", "Mason"), mk("2026-09-20", 167, "voltage", "Mason"),
], [], FEES, "2026-11-01").rows;
const mel = L.find((r) => r.player === "Melana K"), mas = L.find((r) => r.player === "Mason");
assert.deepEqual([mel.status, mel.inst, mel.due_now, mel.owed_now], ["Up to date", 2, 1, 0]);
assert.equal(mel.this_month, "Due by 2026-11-30");
assert.deepEqual([mas.status, mas.inst, mas.owed_now], ["Up to date", 1, 0]);
assert.equal(mas.this_month, "Grace until 2026-11-15");
// lump sum: one $2936 payment (2850 + card fee) on a Summit plan => paid in full, nothing owed
const lump = buildLedger([mk("2026-06-18", 2936, "summit", "Isabelle")], [], FEES, "2026-11-01").rows.find((r) => r.player === "Isabelle");
assert.deepEqual([lump.status, lump.inst, lump.down_ok, lump.owed_now], ["Paid in full", 10, true, 0]);
// partial lump: 500 + 470 covers down + 2 installments
const part = buildLedger([mk("2026-06-18", 970, "summit", "Part")], [], FEES, "2026-11-01").rows.find((r) => r.player === "Part");
assert.deepEqual([part.status, part.inst, part.down_ok], ["Up to date", 2, true]);
const vlump = buildLedger([mk("2026-06-18", 1708, "voltage", "V")], [], FEES, "2026-11-01").rows.find((r) => r.player === "V");
assert.deepEqual([vlump.status, vlump.inst], ["Paid in full", 9]);
// Ethan: 250 + 9 x 167 = 1753 => paid in full. Soren: several odd payments summing to 1100 => 250 + 5 installments
const eth = buildLedger([mk("2026-08-20",250,"voltage","E"), ...[...Array(9)].map((_, i) => mk(`2026-0${(i%9)+1}-15`.replace("-00","-01"),167,"voltage","E"))], [], FEES, "2026-11-01").rows.find((r) => r.player === "E");
assert.equal(eth.status, "Paid in full");
const sor = buildLedger([mk("2026-08-01",400,"voltage","S"), mk("2026-08-15",350,"voltage","S"), mk("2026-08-31",350,"voltage","S")], [], FEES, "2026-11-01").rows.find((r) => r.player === "S");
assert.deepEqual([sor.down_ok, sor.inst, sor.status], [true, 5, "Up to date"]);
// exceptions
const ex = (rows, pl) => buildLedger(rows, [], FEES, "2026-11-01").rows.find((r) => r.player === pl);
assert.equal(ex([mk("2026-08-01", 10, "summit", "Sawyer Smith")], "Sawyer Smith").status, "Free");
const pg = ex([mk("2026-08-01", 500, "summit", "Paige Q"), mk("2026-09-10", 200, "summit", "Paige Q"), mk("2026-10-10", 200, "summit", "Paige Q")], "Paige Q");
assert.deepEqual([pg.status, pg.inst, pg.plan_total], ["Up to date", 2, 2500]);
assert.equal(ex([mk("2026-08-01", 500, "summit", "Shayla Other")], "Shayla Other").note, "");
// grace: Oct installment unpaid on Nov 1 is inside the half-month grace; on Nov 20 it is overdue
const g1 = buildLedger([mk("2026-08-01", 500, "summit", "G"), mk("2026-09-10", 235, "summit", "G")], [], FEES, "2026-11-01").rows.find((r) => r.player === "G");
assert.deepEqual([g1.status, g1.owed_now, g1.this_month], ["Up to date", 0, "Grace until 2026-11-15"]);
const g2 = buildLedger([mk("2026-08-01", 500, "summit", "G"), mk("2026-09-10", 235, "summit", "G")], [], FEES, "2026-11-20").rows.find((r) => r.player === "G");
assert.deepEqual([g2.status, g2.owed_now], ["Behind", 235]);
// lump sums that don't match an installment: the leftover dollars reduce what is still owed (paid + left = season total)
{
  const l = buildLedger([[250, "2026-06-20"], [515, "2026-08-04"], [100, "2026-08-31"], [235, "2026-08-31"], [200, "2026-11-02"]].map(([a, d]) => mk(d, a, "voltage", "Test Kid")), [], FEES, "2026-11-25").rows.find((r) => r.player === "Test Kid");
  assert.deepEqual([l.paid, l.remaining, l.status], [1300, 408, "Up to date"]);
}
// three $235 monthly payments are installments, not a down payment: the $500 is still owed
{
  const l = buildLedger([mk("2026-09-05", 235, "summit", "Leah Anderson"), mk("2026-10-05", 235, "summit", "Leah Anderson"), mk("2026-11-06", 235, "summit", "Leah Anderson")], [], FEES, "2026-11-18").rows.find((r) => r.player === "Leah Anderson");
  assert.deepEqual([l.down_ok, l.inst, l.owed_now, l.status], [false, 3, 500, "Behind"]);
  const m = buildLedger([mk("2026-09-05", 500, "summit", "Pat Roe"), mk("2026-09-05", 235, "summit", "Pat Roe")], [], FEES, "2026-11-18").rows.find((r) => r.player === "Pat Roe");
  assert.deepEqual([m.down_ok, m.inst], [true, 1]);
}
const leo = buildLedger([mk("2026-10-22", 250, "voltage", "Leo Vargas")], [], FEES, "2026-11-01").rows.find((r) => r.player === "Leo Vargas");
assert.deepEqual([leo.status, leo.inst_total, leo.owed_now, leo.this_month], ["Up to date", 7, 0, "Due by 2026-11-30"]);
// Natalie Thody: $2850 check recorded in fees.mjs => Summit, 12u, paid in full
import { manualCharges } from "./lib/ledger.mjs";
const nat = buildLedger(manualCharges(FEES), [], FEES, "2026-11-01").rows.find((r) => r.player === "Natalie Thody");
assert.deepEqual([nat.org, nat.team, nat.status, nat.paid, nat.inst, nat.owed_now], ["summit", "12u", "Paid in full", 2850, 10, 0]);
{
  const base = { id: "sub_x", status: "active", customer: { metadata: {} }, metadata: { org: "summit", team: "14u", player: "Shay Leblanc" }, items: { data: [{ price: { unit_amount: 23500 }, quantity: 1 }] } };
  assert.equal(subsFromStripe([base])[0].amount, 235);                                                       // no discount: list price
  assert.equal(subsFromStripe([{ ...base, discount: { coupon: { percent_off: 50 } } }])[0].amount, 117.5);   // percent coupon
  assert.equal(subsFromStripe([{ ...base, discount: { coupon: { amount_off: 11500 } } }])[0].amount, 120);   // fixed coupon
  assert.equal(subsFromStripe([{ ...base, latest_invoice: { status: "paid", subtotal: 23500, total: 12000, lines: { data: [{}] } } }])[0].amount, 120); // invoice shows the discount
  assert.equal(subsFromStripe([{ ...base, latest_invoice: { status: "paid", subtotal: 73500, total: 60000, lines: { data: [{}, {}] } } }])[0].amount, 235); // multi-line invoice: ignore
}
{
  const f = { ...FEES, roster: [{ org: "summit", team: "12u", player: "Roster Girl", payer: "Mom" }] };
  const mk = (org) => buildReport({ charges: [], subs: [], start: "2026-06-01", end: "2027-07-31", org, fees: f, today: "2026-11-02" }).ledger.map((r) => r.player).filter((p) => p !== "Natalie Thody");
  assert.deepEqual(mk("voltage"), []);              // a Summit roster player never appears in the Voltage view
  assert.deepEqual(mk("summit"), ["Roster Girl"]);
  assert.deepEqual(mk("all"), ["Roster Girl"]);
}
{
  const raw = (id, status, paid) => ({ id, status, paid, amount: 23500, created: 1793000000, metadata: { org: "summit", team: "T", player: "P" }, amount_refunded: 0 });
  const out = chargesFromStripe([raw("a", "succeeded", true), raw("b", "pending", false), raw("c", "failed", false)]);
  assert.deepEqual(out.map((c) => [c.id, c.pending]), [["a", false], ["b", true]]); // pending ACH counts; failed does not
  const b = buildReport({ charges: out, subs: [], start: "2026-06-01", end: "2027-07-31", org: "all", fees: { ...FEES, manual_payments: [] }, today: "2026-11-03" }).board.find((x) => x.org === "summit");
  assert.deepEqual([b.gross, b.pending], [470, 235]);
}
{
  const rows = [{ date: "2026-10-05", desc: "POS Withdrawal SHARED THING", amount: -100.01, org: "shared", team: "" }, { date: "2026-10-06", desc: "RULE SHARED", amount: -50, org: "" }];
  const { expenses } = classify(rows, [{ match: "RULE SHARED", org: "Shared", category: "Gear" }], "2026-10-01", "2026-10-31", []);
  assert.deepEqual(expenses.map((e) => [e.org, e.amount]), [["summit", 66.01], ["voltage", 34], ["summit", 33], ["voltage", 17]]);
  assert.equal(expenses.filter((e) => e.org === "summit")[0].amount + expenses.filter((e) => e.org === "voltage")[0].amount, 100.01);
}
{
  const vals = [["Posted date","Original bank description","Debit","Credit","Status","org","Running balance"],
    ["10/25/2026","POS Withdrawal A","111.77","","Posted","","3347.14"],["10/24/2026","POS Withdrawal B","15.28","","Posted","","3458.91"],["07/02/2026","ATM Deposit","","2850","Posted","","2850"]];
  const rows = rowsFromSheet(vals);
  const { bankBalance } = await import("./lib/logic.mjs");
  assert.deepEqual(bankBalance(rows), { amount: 3347.14, date: "2026-10-25" });
  assert.equal(bankBalance(rowsFromSheet([vals[0], vals[3], vals[2], vals[1]])).amount, 3347.14); // oldest-first sheets work too
  assert.equal(bankBalance([{ date: "2026-01-01", desc: "x", amount: 1 }]), null);
  const rep2 = buildReport({ charges: [], subs: [], bankRows: rows, rules: [], start: "2026-08-01", end: "2026-08-31", org: "all", today: "2026-11-04" });
  assert.equal(rep2.bank_balance.amount, 3347.14); // not limited to the report dates
}
{
  const { bankByOrg } = await import("./lib/logic.mjs");
  const rows = [
    { date: "2026-10-02", desc: "External Deposit STRIPE - TRANSFER", amount: 1000, balance: 1100 },
    { date: "2026-10-01", desc: "ATM Deposit", amount: 500, balance: 700, org: "summit" },
    { date: "2026-09-30", desc: "POS Withdrawal SHOP", amount: -300, balance: 200, org: "voltage" },
    { date: "2026-09-29", desc: "POS Withdrawal BOTH", amount: -100, balance: 500, org: "shared" },
  ];
  const ch = [{ org: "summit", gross: 600, fee: 0, refunded: 0, id: "a" }, { org: "voltage", gross: 400, fee: 0, refunded: 0, id: "b" }];
  const r = bankByOrg(ch, rows, [{ match: "STRIPE", ignore: true }], [], { amount: 1100, date: "2026-10-02" });
  const by = Object.fromEntries(r.map((x) => [x.org, Math.round(x.balance * 100) / 100]));
  assert.deepEqual(by, { summit: 600 + 500 - 66, voltage: 400 - 300 - 34 }); // 66/34 split of the shared cost
  assert.equal(Math.round(r.reduce((t, x) => t + x.balance, 0)), 1100); // always adds up to the bank balance
}
{
  const raw = (id, md) => ({ id, status: "succeeded", paid: true, amount: 10000, created: 1793000000, metadata: md, amount_refunded: 0 });
  const out = chargesFromStripe([raw("d1", { org: "voltage", type: "donation", payer_name: "Pat Lee" }), raw("s1", { org: "voltage", type: "sponsorship", business: "Acme Co", payer_name: "Pat Lee" })]);
  assert.deepEqual(out.map((c) => [c.org, c.team, c.player, c.kind]), [["voltage", "Donations", "Pat Lee", "donation"], ["voltage", "Sponsorships", "Acme Co", "sponsorship"]]);
  const r = buildReport({ charges: out, subs: [], start: "2026-06-01", end: "2027-07-31", org: "voltage", fees: { ...FEES, manual_payments: [] }, today: "2026-11-04" });
  assert.equal(r.unassigned, 0); assert.equal(r.ledger.length, 0); // not flagged as missing tags, and not a player in the ledger
  assert.equal(r.board.find((x) => x.org === "voltage").gross, 200); // but counted as the org's income
}
{
  const out = chargesFromStripe([{ id: "d2", status: "succeeded", paid: true, amount: 2500, created: 1793000000, amount_refunded: 0, metadata: { org: "voltage", type: "donation", payer_name: "Pat Lee", honoree: "Jasey L." } }]);
  assert.equal(out[0].payer, "Pat Lee (in honor of Jasey L.)");
}
{
  const raw = (id, md) => ({ id, status: "succeeded", paid: true, amount: 1000, created: 1793000000, balance_transaction: { fee: 59 }, metadata: md, amount_refunded: 0 });
  const ch = chargesFromStripe([raw("g1", { org: "voltage", type: "donation", payer_name: "Pat" }), raw("p1", { org: "voltage", team: "10u", player: "Mason", payer_name: "Mom" })]);
  const r = buildReport({ charges: ch, subs: [], start: "2026-06-01", end: "2027-07-31", org: "all", fees: { ...FEES, manual_payments: [] }, today: "2026-11-04" });
  assert.deepEqual(r.teams.map((t) => t.team), ["10u"]); // donations are not a team
  assert.deepEqual(r.giving.map((c) => c.id), ["g1"]);
  assert.equal(r.board.find((x) => x.org === "voltage").gross, 20); // still counted as income
}
{
  const { payeeOf } = await import("./lib/logic.mjs");
  assert.equal(payeeOf("POS Withdrawal SQ *SNOCO TEAM SALES 5210 136th St SW   Edmonds  WAU"), "SQ *SNOCO TEAM SALES");
  assert.equal(payeeOf("POS Withdrawal 011890194 FRED MEYER #0682       MAPLE VALLEY WAUS"), "FRED MEYER");
  assert.equal(payeeOf("External Withdrawal VENMO  - PAYMENT"), "VENMO - PAYMENT");
  const vals = [["Posted date","Original bank description","Debit","Credit","org","Paid by"], ["10/25/2026","POS Withdrawal SQUADUP*AUPROSPORTSTIX 500 7TH AVE","111.77","","","Amy"]];
  const rep = buildReport({ charges: [], subs: [], bankRows: rowsFromSheet(vals), rules: [], start: "2026-10-01", end: "2026-10-31", org: "all", today: "2026-11-05" });
  assert.deepEqual([rep.expenses[0].payee, rep.expenses[0].by, rep.expenses[0].amount], ["SQUADUP*AUPROSPORTSTIX", "Amy", 111.77]);
}
{
  const sub = { id: "sub_x", status: "active", created: 1790000000, start_date: 1790000000, current_period_end: Date.parse("2026-12-01T12:00:00Z") / 1000, cancel_at: Date.parse("2027-04-16T12:00:00Z") / 1000, metadata: { org: "summit", team: "14u", player: "Zoe", payer_name: "Mom" }, items: { data: [{ price: { unit_amount: 23500 }, quantity: 1 }] } };
  const [x] = subsFromStripe([sub]);
  assert.deepEqual([x.next_charge, x.ends, x.charges_left], ["2026-12-01", "2027-04-16", 5]); // Dec, Jan, Feb, Mar, Apr 1
  const [tr] = subsFromStripe([{ ...sub, status: "trialing", trial_end: Date.parse("2027-01-01T12:00:00Z") / 1000, cancel_at: null }]);
  assert.deepEqual([tr.next_charge, tr.charges_left], ["2027-01-01", null]);
}
console.log("all tests passed");

// org column on the sheet row wins over rules
{
  const rows = rowsFromSheet([["Posted date","Original bank description","Debit","Credit","Status","org","Running balance"],
    ["10/21/2026","POS Withdrawal SQ *SNOCO TEAM SALES","4307.27","","Posted","voltage","1"],
    ["10/09/2026","POS Withdrawal SQUADUP","10","","Posted","","1"]]);
  const c = classify(rows, [{ match: "SNOCO", org: "summit", category: "Uniforms & apparel" }, { match: "SQUADUP", org: "summit", category: "Event fees" }], "2026-06-01", "2027-07-31");
  assert.equal(c.expenses[0].org, "voltage"); assert.equal(c.expenses[0].category, "Uniforms");
  assert.equal(c.expenses[1].org, "summit");
}

// Tahoma Split tab drives the Summit/Voltage split
{
  const { splitsFromSheet } = await import("./lib/logic.mjs");
  const sp = splitsFromSheet([
    ["Payment date","Invoice","Use date","Event","Amount","Org","Category"],
    ["2026-10-08","3327","2026-07-01","TES Upper","11","Voltage","Dirt Practice Facilities"],
    ["2026-10-08","3327","2026-07-02","THS Field","50","Summit","TSD Facilities"],
    ["2026-10-08","3327","2026-10-08","Convenience fee","1.5","Summit","TSD Facilities"]]);
  assert.equal(sp.length, 1); assert.equal(sp[0].amount, 62.5);
  const e = classify([{ date: "2026-10-08", desc: "POS Withdrawal TAHOMA SD 25720", amount: -62.5 }], BUILTIN_RULES, "2026-06-01", "2027-07-31", sp).expenses;
  assert.deepEqual(e.map((x) => [x.org, x.category, x.amount, x.date]), [["voltage","Dirt Practice Facilities",11,"2026-10-08"],["summit","TSD Facilities",50,"2026-10-08"],["summit","TSD Facilities",1.5,"2026-10-08"]]);
  assert.deepEqual(e.map((x) => x.use_date), ["2026-07-01","2026-07-02",""]);
}

// an invoice entered on the Tahoma Split tab before it is paid still counts as spent (accrued), but not as cash out of the bank
{
  const { splitsFromSheet, bankByOrg } = await import("./lib/logic.mjs");
  const sp = splitsFromSheet([["Payment date","Invoice","Use date","Event","Amount","Org","Category"],
    ["2026-11-09","3540","2026-10-02","THS Fastpitch","79.63","Summit","TSD Facilities"],
    ["2026-11-09","3540","2026-10-02","STMS Gym","46.25","Voltage","Indoor Practice Facilities"]]);
  const rows = [{ date: "2026-11-05", desc: "POS Withdrawal AMAZON", amount: -20 }];
  const e = classify(rows, BUILTIN_RULES, "2026-06-01", "2027-07-31", sp).expenses.filter((x) => x.accrued);
  assert.deepEqual(e.map((x) => [x.org, x.amount, x.date, x.use_date]), [["voltage",46.25,"2026-11-09","2026-10-02"],["summit",79.63,"2026-11-09","2026-10-02"]]);
  assert.equal(classify(rows, BUILTIN_RULES, "2026-06-01", "2026-11-01", sp).expenses.filter((x) => x.accrued).length, 0);
  const paid = classify([...rows, { date: "2026-11-09", desc: "POS Withdrawal TAHOMA SD 25720", amount: -125.88 }], BUILTIN_RULES, "2026-06-01", "2027-07-31", sp).expenses;
  assert.equal(paid.filter((x) => x.accrued).length, 0); // once the bank row shows up, the normal split applies
  assert.equal(paid.filter((x) => x.desc.includes("inv") || x.org === "voltage").length >= 1, true);
  const b = bankByOrg([], [{ ...rows[0], amount: 100, desc: "Stripe transfer deposit" }, ...rows], BUILTIN_RULES, sp, { amount: 80 });
  assert.equal(b.reduce((t, x) => t + x.spent, 0), 20); // accrued lines are not cash spent
}

// the Budgets tab is the only source once it has rows
{
  const { mergeBudgets } = await import("./lib/logic.mjs");
  const b = mergeBudgets(BUDGETS, [["org","category","budget"],["voltage","dirt practice facilities","$600"],["voltage","Spring clinic","250"],["summit","Event fees",""]]);
  assert.deepEqual(b, { voltage: { "dirt practice facilities": 600, "Spring clinic": 250 } }); // nothing is pulled from the built-ins
  assert.deepEqual(mergeBudgets(BUDGETS, null), BUDGETS); assert.deepEqual(mergeBudgets(BUDGETS, [["org","category","budget"]]), BUDGETS); // no tab / empty tab: fallback
  assert.equal(BUDGETS.voltage["Dirt Practice Facilities"], 420); // built-ins untouched
}

// Payments with no tags borrow their subscription's tags (older and newer Stripe API shapes)
{
  const { subscriptionTagLookup } = await import("./lib/logic.mjs");
  const subs = [{ id: "sub_1", metadata: { org: "summit", team: "14u", player: "Ava M", payer_name: "Mom M" } }];
  const base = { paid: true, status: "succeeded", amount: 23500, amount_refunded: 0, created: 1790000000, balance_transaction: { fee: 100 } };
  const legacy = { id: "ch_old", ...base, invoice: "in_1", payment_intent: "pi_old", metadata: {} };
  const basil = { id: "ch_new", ...base, payment_intent: { id: "pi_new", metadata: {} }, metadata: {} };
  const own = { id: "ch_own", ...base, invoice: "in_1", metadata: { org: "voltage", team: "10u", player: "Own P" } };
  const invoices = [
    { id: "in_1", subscription: "sub_1" },
    { id: "in_2", parent: { subscription_details: { subscription: "sub_1" } }, payments: { data: [{ payment: { payment_intent: "pi_new" } }] } },
  ];
  const out = chargesFromStripe([legacy, basil, own], subscriptionTagLookup(subs, invoices));
  assert.deepEqual(out.map((c) => [c.org, c.player]), [["summit", "Ava M"], ["summit", "Ava M"], ["voltage", "Own P"]]);
  assert.deepEqual(out.map((c) => c.via_sub), [true, true, false]);
  const none = chargesFromStripe([legacy], subscriptionTagLookup(subs, []));
  assert.equal(none[0].org, "unassigned");
}
