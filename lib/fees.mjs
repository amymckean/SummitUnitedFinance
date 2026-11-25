// Fee plans. Edit these to match your payment plans; this is settings, not transaction data.
// Each installment is due by the END of its month, starting with the month of first_due (year-month).
// A player is Behind once grace_days have passed after a month ended without its installment.
export const FEES = {
  grace_days: 15, // half a month: Behind only once this many days pass after a month ends unpaid
  season_start: "2026-06-01", // payments from this date on count toward each player's plan
  skip_months: { summit: [], voltage: [] }, // e.g. ["2026-12"] if no installment is due that month
  plans: {
    summit: { total: 2850, downpayment: 500, installment_amounts: [235], installments: 10, first_due: "2026-09" },
    voltage: { total: 1708, downpayment: 250, installment_amounts: [162, 167], installments: 9, first_due: "2026-09" },
  },
  // Per-player exceptions. match = word(s) that must appear in the player or payer name (case-insensitive).
  // Use ONE of: waived (free), factor (share of the whole fee, e.g. 0.5), installment (custom monthly amount,
  // down payment unchanged), paid_in_full (settled outside Stripe, e.g. by check). Add org to limit to one org.
  players: [
    {
      match: "sawyer",
      note: "Free",
      waived: true
    },
    {
      match: "theresa",
      note: "Free",
      waived: true
    },
    {
      match: "jasey leblanc",
      note: "Free",
      waived: true
    },
    {
      match: "paige",
      note: "Reduced: $200/month",
      installment: 200
    },
    {
      match: "marlie",
      note: "Monthly fee is half ($117.50); full down payment",
      installment: 117.5
    },
    {
      match: "shay",
      note: "$120/month, no down payment",
      installment: 120,
      downpayment: 0,
    },
    { match: "leo vargas", note: "7 payments, Nov to May", installments: 7, first_due: "2026-11" },
  ],
  // Players on a team who may have no Stripe activity (fee waived, etc.). They still show in the ledger.
  roster: [
    { org: "summit", team: "12u", player: "Jasey Leblanc", payer: "Emma Leblanc" },
  ],
  // Payments received outside Stripe (checks, cash). They count in income, All transactions and the ledger.
  manual_payments: [
    { date: "2026-07-02", org: "summit", team: "12u", player: "Natalie Thody", payer: "Ryan Thody", amount: 2850, method: "check" },
  ],
};
