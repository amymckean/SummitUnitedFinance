// Per-player ledger: what each player has paid vs. what their fee plan says is due by today. Pure functions.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = m - 1 + n;
  const yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(yy, mm, Math.min(d, last))).toISOString().slice(0, 10);
}
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// Each installment is due by the END of its month, starting with the month of first_due.
export function dueDates(plan, skip = []) {
  const out = [];
  for (let k = 0; out.length < plan.installments && k < 100; k++) {
    const d = addMonths(plan.first_due.slice(0, 7) + "-01", k);
    if (skip.includes(d.slice(0, 7))) continue;
    out.push(addDays(addMonths(d, 1), -1));
  }
  return out;
}

export function classifyPayment(amount, plan) {
  if (plan.downpayment > 0 && Math.abs(amount - plan.downpayment) <= 1) return ["down", 1];
  for (const a of plan.installment_amounts) {
    for (const k of [1, 2, 3, 4]) if (Math.abs(amount - a * k) <= k) return ["inst", k];
  }
  return ["other", 0];
}

// Payments received outside Stripe (lib/fees.mjs > manual_payments), shaped like Stripe charges.
export function manualCharges(fees) {
  return (fees.manual_payments || []).map((m, i) => ({
    date: m.date, id: `manual-${m.method || "other"}-${i + 1}`, gross: Number(m.amount), fee: 0, refunded: 0,
    org: String(m.org).toLowerCase(), team: m.team || "UNASSIGNED", player: m.player, payer: m.payer || "",
  }));
}

const words = (x) => (String(x).toLowerCase().match(/[a-z0-9']+/g) || []).join(" ");
export function findOverride(fees, org, player, payer) {
  const text = " " + words(`${player} ${payer}`) + " ";
  return (fees.players || []).find((o) => (!o.org || o.org === org) && words(o.match) && text.includes(" " + words(o.match) + " ")) || null;
}
export function adjustPlan(plan, o) {
  const p = { ...plan };
  if (o && o.installments) { // fewer payments (e.g. joined late): fee share per payment stays the same
    const base = (plan.total - plan.downpayment) / plan.installments;
    p.installments = o.installments; p.total = plan.downpayment + base * o.installments;
    if (o.first_due) p.first_due = o.first_due;
  }
  if (o && o.factor) {
    p.total = plan.total * o.factor; p.downpayment = plan.downpayment * o.factor;
    p.installment_amounts = plan.installment_amounts.map((a) => a * o.factor);
  } else if (o && o.installment) {
    p.installment_amounts = [o.installment]; p.total = plan.downpayment + o.installment * plan.installments;
  }
  if (o && o.downpayment != null) { p.total += o.downpayment - p.downpayment; p.downpayment = o.downpayment; } // 0 = no down payment
  return p;
}

function buildSchedule(plan, dues, inst, downOk, ref, today, grace, ov) {
  if (ov && ov.waived) return [];
  const settled = !!(ov && ov.paid_in_full);
  const mon = (d) => new Date(d + "T00:00:00Z").toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const rows = plan.downpayment > 0 ? [{ item: "Down payment", due: "", amount: plan.downpayment, status: downOk || settled ? "Paid" : "MISSING" }] : [];
  dues.forEach((d, k) => {
    const st = k < inst || settled ? "Paid" : addDays(d, grace) < today ? "Overdue"
      : d < today ? "In grace until " + addDays(d, grace)
      : d.slice(0, 7) === today.slice(0, 7) ? "Due this month" : "Upcoming";
    rows.push({ item: `Installment ${k + 1} of ${dues.length} (${mon(d)})`, due: d, amount: ref, status: st });
  });
  return rows;
}

export function buildLedger(charges, subs, fees, today) {
  const groups = new Map(), names = new Map();
  const keyOf = (org, player) => org + "\u0000" + String(player).trim().toLowerCase();
  for (const c of charges) {
    const k = keyOf(c.org, c.player);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
    if (!names.has(k)) names.set(k, { org: c.org, team: c.team, player: c.player, payer: c.payer || "" });
  }
  for (const s of subs) { // enrolled players who haven't paid anything yet
    if (s.status === "Canceled") continue;
    const k = keyOf(s.org, s.player);
    if (!groups.has(k)) groups.set(k, []);
    if (!names.has(k)) names.set(k, { org: s.org, team: s.team, player: s.player, payer: s.payer || "" });
  }
  for (const m of fees.roster || []) { // players on the team who may have no Stripe activity (e.g. fee waived)
    const k = keyOf(String(m.org).toLowerCase(), m.player);
    if (!groups.has(k)) groups.set(k, []);
    if (!names.has(k)) names.set(k, { org: String(m.org).toLowerCase(), team: m.team || "", player: m.player, payer: m.payer || "" });
  }
  const rows = [], skipped = [];
  for (const [k, pays] of groups) {
    const { org, team, player, payer } = names.get(k);
    const basePlan = fees.plans[org];
    const plan = basePlan && adjustPlan(basePlan, findOverride(fees, org, player, payer));
    const ov = basePlan ? findOverride(fees, org, player, payer) : null;
    if (!plan || player === "UNASSIGNED") {
      skipped.push({ org, player, count: pays.length, gross: pays.reduce((t, p) => t + p.gross, 0) });
      continue;
    }
    const dues = dueDates(plan, (fees.skip_months || {})[org] || []);
    const grace = fees.grace_days || 0;
    const dueNow = dues.filter((d) => addDays(d, grace) < today).length; // months over AND past the grace period
    const nPast = dues.filter((d) => d < today).length;
    let down = 0, inst = 0, other = 0, paid = 0, refunded = 0, last = "", ref = plan.installment_amounts[0];
    let instKnown = 0, restNet = 0; // payments that are exactly whole installments go to installments; the rest is pooled by dollars
    const history = [];
    for (const p of [...pays].sort((a, b) => cmp(a.date, b.date))) {
      let [kind, n] = classifyPayment(p.gross, plan);
      paid += p.gross - p.refunded; refunded += p.refunded;
      if (!p.refunded && kind === "inst") instKnown += n; else restNet += p.gross - p.refunded;
      if (!p.refunded) {
        if (kind === "down") down++;
        else if (kind === "inst") { inst += n; ref = p.gross / n; }
        else other += p.gross;
      } else kind += " (refunded)";
      last = p.date;
      history.push({ ...p, kind });
    }
    // Credit is by DOLLARS, whatever the payment sizes: net paid goes to the down payment first, then to
    // whole installments. 4% slack covers card processing surcharges (162 vs 167).
    // A payment that is exactly one or more installments (for example a subscription's $235) never counts toward the
    // down payment, even when several of them add up to more than it.
    let downOk = false, avail = restNet;
    inst = Math.min(instKnown, plan.installments);
    if (!downOk && avail >= plan.downpayment * 0.96) { downOk = true; avail -= plan.downpayment; }
    const base = (plan.total - plan.downpayment) / plan.installments; // fee share per installment
    while (inst < plan.installments && avail >= base * 0.96) { inst++; avail -= base; }
    // Dollars left over after whole installments (for example $78 of a lump sum) count toward the next installment.
    const partial = downOk && inst < plan.installments ? Math.max(0, avail) : 0;
    const owedNow = Math.max(0, Math.max(0, dueNow - inst) * ref - partial) + (downOk ? 0 : plan.downpayment);
    let status = downOk && inst >= plan.installments ? "Paid in full" : owedNow <= 0.5 ? "Up to date" : "Behind";
    let owed = owedNow;
    if (ov && ov.waived) { status = "Free"; owed = 0; }
    else if (ov && ov.paid_in_full) { status = "Paid in full"; owed = 0; }
    rows.push({
      org, team, player, plan_total: ov && ov.waived ? 0 : plan.total, paid, refunded, free: !!(ov && ov.waived), no_down: plan.downpayment === 0,
      pay_info: { // what a family would owe by card / bank (used by the family portal)
        downpayment: plan.downpayment, amounts: plan.installment_amounts, installments: plan.installments, n_past: nPast, dues,
        has_skips: ((fees.skip_months || {})[org] || []).length > 0,
      }, down_ok: ov && ov.waived ? true : downOk, inst, inst_total: ov && ov.waived ? 0 : plan.installments,
      payer, schedule: buildSchedule(plan, dues, inst, downOk, ref, today, grace, ov),
      due_now: ov && ov.waived ? 0 : dueNow, owed_now: owed, note: ov ? ov.note || "" : "", other, credit_left: Math.max(0, avail), last, status,
      remaining: ov && (ov.waived || ov.paid_in_full) ? 0 : Math.max(0, (downOk ? 0 : plan.downpayment) + Math.max(0, plan.installments - inst) * ref - partial),
      this_month: ov && ov.waived ? "" : (() => {
        if (inst < nPast && dueNow <= inst) return "Grace until " + addDays(dues[inst], grace);
        const c = dues.find((d) => d.slice(0, 7) === today.slice(0, 7));
        return !c ? "" : inst >= nPast + 1 ? "Paid" : "Due by " + c;
      })(),
      history: history.reverse(),
    });
  }
  const order = { "Behind": 0, "Up to date": 1, "Paid in full": 2, "Free": 3 };
  rows.sort((a, b) => cmp(a.org, b.org) || cmp(a.team, b.team) || cmp(a.player, b.player)); // org, then team, then player
  return { rows, skipped };
}
