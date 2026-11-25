// Fake data for trying the site without Stripe or Google credentials (set DEMO=1).
export function demoData() {
  const roster = [
    ["voltage", "10U Gold", ["Mason R", "Eli T", "Noah K", "Owen P"]],
    ["voltage", "10U Black", ["Liam S", "Jack D", "Theo W"]],
    ["summit", "12U Fastpitch", ["Ava M", "Zoe C", "Mia H", "Ella B"]],
  ];
  const charges = [], subs = [];
  let n = 0;
  for (const [org, team, players] of roster) {
    for (const p of players) {
      n++;
      const amount = org === "voltage" ? 162 : 235;
      const payer = `${p.split(" ")[0]} Family`;
      const status = n % 4 === 0 ? "Past due" : "Current";
      subs.push({ id: `sub_demo${n}`, org, team, player: p, payer, status, amount,
        last_paid: status === "Current" ? "2026-10-05" : "2026-09-05" });
      charges.push({ date: "2026-08-15", id: `ch_demo_down${n}`, gross: org === "voltage" ? 250 : 500,
        fee: 8, refunded: 0, org, team, player: p, payer });
      if (status === "Current") {
        charges.push({ date: "2026-10-05", id: `ch_demo${n}`, gross: amount,
          fee: Math.round((amount * 0.029 + 0.3) * 100) / 100, refunded: 0, org, team, player: p, payer });
      }
    }
  }
  charges.push({ date: "2026-10-09", id: "ch_demo_orphan", gross: 50, fee: 1.75, refunded: 0,
    org: "unassigned", team: "UNASSIGNED", player: "UNASSIGNED", payer: "Unknown" });
  const expenses = [
    ["Date", "Description", "Debit", "Credit"],
    ["10/03/2026", "FIELD RENTAL MAPLE VALLEY PARKS", "450.00", ""],
    ["10/04/2026", "STRIPE TRANSFER", "", "1200.50"],
    ["10/06/2026", "SPORTS ENGINE LEAGUE FEE", "300.00", ""],
    ["10/08/2026", "TARGET #1234", "42.17", ""],
  ];
  const rules = [
    ["match", "org", "team", "category", "ignore"],
    ["STRIPE", "", "", "", "TRUE"],
    ["FIELD RENTAL", "voltage", "", "Facilities", ""],
    ["SPORTS ENGINE", "summit", "", "League fees", ""],
  ];
  return { charges, subs, expenses, rules };
}
