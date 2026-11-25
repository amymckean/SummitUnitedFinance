// Network sources: Stripe REST API and Google Sheets (service account). Nothing is stored.
import { createSign } from "node:crypto";

// ------------------------------------------------------------------ Stripe
async function stripeList(path, params, expands) {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error("STRIPE_API_KEY is not set in Netlify environment variables.");
  const all = [];
  let after = null;
  for (let page = 0; page < 200; page++) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) qs.append(k, v);
    for (const e of expands) qs.append("expand[]", e);
    qs.append("limit", "100");
    if (after) qs.append("starting_after", after);
    const res = await fetch(`https://api.stripe.com/v1/${path}?${qs}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json();
    if (!res.ok) {
      const err = new Error(body?.error?.message || `Stripe error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    all.push(...body.data);
    if (!body.has_more || !body.data.length) break;
    after = body.data[body.data.length - 1].id;
  }
  return all;
}

export function getCharges(startTs, endTs) {
  const params = { "created[gte]": startTs, "created[lte]": endTs };
  // payment_intent holds the metadata you set with "edit metadata" on a payment (needs PaymentIntents: read).
  return stripeList("charges", params, ["data.balance_transaction", "data.customer", "data.payment_intent"]);
}

/** Invoices (with their payments, where the API allows it) so a payment can be traced back to its subscription. */
export async function getInvoices(startTs, endTs) {
  const params = { "created[gte]": startTs, "created[lte]": endTs };
  try {
    return await stripeList("invoices", params, ["data.payments"]); // newer API versions
  } catch (e) {
    return stripeList("invoices", params, []); // older versions: the invoice itself names its payment_intent
  }
}

/** What Stripe is holding right now: available to pay out, and still on its way (needs Balance: read; null if the key can't). */
export async function getBalance() {
  const key = process.env.STRIPE_API_KEY;
  const res = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  const b = await res.json();
  const sum = (l) => (l || []).filter((x) => x.currency === "usd").reduce((t, x) => t + x.amount, 0) / 100;
  return { available: sum(b.available), pending: sum(b.pending) };
}

export function getSubscriptions() {
  return stripeList("subscriptions", { status: "all" }, ["data.customer", "data.latest_invoice"]);
}

// ------------------------------------------------------------ Google Sheets
const b64url = (x) => Buffer.from(x).toString("base64url");

async function googleToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
    "." +
    b64url(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }));
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error("Google auth failed: " + (body.error_description || body.error));
  return body.access_token;
}

/** Returns {expenses, rules} as arrays of rows, or null if no sheet is configured. */
export async function getSheetTabs() {
  const id = process.env.SHEET_ID;
  if (!id) return null;
  const token = await googleToken();
  const ranges = [process.env.EXPENSES_RANGE || "Expenses!A:Z", process.env.RULES_RANGE || "Rules!A:F"];
  const qs = ranges.map((r) => "ranges=" + encodeURIComponent(r)).join("&");
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      "Google Sheets error: " + (body?.error?.message || res.status) +
        " (is the sheet shared with the service account email, and are the tabs named Expenses and Rules?)",
    );
  }
  // Optional tab that says which Tahoma facility rentals are Summit's and which are Voltage's.
  let tahoma = null;
  try {
    const tr = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(process.env.TAHOMA_RANGE || "'Tahoma Split'!A:G")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (tr.ok) tahoma = (await tr.json()).values || [];
  } catch (e) { /* tab missing or unreachable: the built-in split is used */ }
  // Optional tab with season budgets (org, category, budget); built-in budgets cover anything not listed.
  let budgets = null;
  try {
    const br = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(process.env.BUDGETS_RANGE || "Budgets!A:C")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (br.ok) budgets = (await br.json()).values || [];
  } catch (e) { /* tab missing: built-in budgets are used */ }
  return { expenses: body.valueRanges[0].values || [], rules: body.valueRanges[1].values || [], tahoma, budgets };
}
