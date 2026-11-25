// Built-in expense rules, shared-payment splits and season budgets, taken from your workbooks.
// Rules typed on the Google Sheet "Rules" tab are checked first; these are the fallback. Edit this file to change them.
export const BUILTIN_RULES = [
  {
    "match": "STRIPE",
    "ignore": true,
    "note": "Stripe payouts and Summit-to-Summit Stripe transfers: money already counted as income"
  },
  {
    "match": "ATM DEPOSIT",
    "amount": 2850,
    "ignore": true,
    "note": "Natalie Thody's $2,850 check; counted as income in manual_payments, not an expense or extra deposit"
  },
  {
    "match": "TAHOMA SD",
    "org": "summit",
    "category": "TSD Facilities",
    "note": "Voltage share is split out by the entries in splits"
  },
  {
    "match": "HOME BASE",
    "org": "voltage",
    "category": "Indoor Practice Facilities",
    "note": "Indoor facility, Voltage only"
  },
  {
    "match": "SNOCO TEAM SALES",
    "amount": 2074.55,
    "org": "voltage",
    "category": "Uniforms",
    "note": "Voltage uniform order"
  },
  {
    "match": "SNOCO TEAM SALES",
    "org": "summit",
    "category": "Uniforms & apparel"
  },
  {
    "match": "CITY OF BLACK DIAMOND",
    "org": "summit",
    "category": "BDG"
  },
  {
    "match": "USSSA",
    "amount": 311,
    "org": "summit",
    "category": "Sanction / registration / background checks",
    "note": "July sanction/registration fee"
  },
  {
    "match": "USSSA",
    "amount": 263,
    "org": "summit",
    "category": "Sanction / registration / background checks",
    "note": "July sanction/registration fee"
  },
  {
    "match": "USSSA",
    "org": "summit",
    "category": "Tournament entry fees"
  },
  {
    "match": "TRANSFER TO ******4080",
    "org": "summit",
    "category": "Tournament entry fees",
    "note": "12U tournament payment"
  },
  {
    "match": "VENMO",
    "org": "summit",
    "category": "Tournament entry fees",
    "note": "14U tournament payment; verify receipt"
  },
  {
    "match": "COACHBGCHE",
    "org": "summit",
    "category": "Sanction / registration / background checks"
  },
  {
    "match": "USA SOFTBALL",
    "org": "summit",
    "category": "Sanction / registration / background checks"
  },
  {
    "match": "AMAZON",
    "org": "summit",
    "category": "Equipment & supplies"
  },
  {
    "match": "FRED MEYER",
    "org": "summit",
    "category": "Team events / miscellaneous supplies"
  },
  {
    "match": "SQUADUP",
    "org": "summit",
    "category": "Event fees"
  },
  {
    "match": "ICI*FEE",
    "org": "summit",
    "category": "Bank / payment fees"
  },
  {
    "match": "USPS",
    "org": "summit",
    "category": "Administration Fees"
  }
];

export const SPLITS = [
  {
    "date": "2026-07-10",
    "match": "TAHOMA SD",
    "amount": 123.5,
    "voltage": [
      {
        "date": "2026-06-17",
        "category": "Turf Practice Facilities",
        "amount": 55,
        "desc": "THS Baseball Field tryouts (inv 3267)"
      },
      {
        "date": "2026-07-10",
        "category": "Facility convenience fees",
        "amount": 1.14,
        "desc": "Tahoma convenience fee, Voltage share (invoice 3267)"
      }
    ],
    "remainder_org": "summit",
    "remainder_category": "TSD Facilities",
    "note": "Voltage lines are the Voltage Budget Tracker's Tahoma School District entries, dated by use. Voltage also carries its pro-rata share of each invoice's convenience fee, dated on the payment. The rest goes to Summit."
  },
  {
    "date": "2026-09-19",
    "match": "TAHOMA SD",
    "amount": 86.19,
    "voltage": [
      {
        "date": "2026-08-02",
        "category": "Dirt Practice Facilities",
        "amount": 11,
        "desc": "TES Baseball Field Upper (inv 3377)"
      },
      {
        "date": "2026-08-07",
        "category": "Dirt Practice Facilities",
        "amount": 11,
        "desc": "TES Baseball Field Upper (inv 3377)"
      },
      {
        "date": "2026-08-12",
        "category": "Dirt Practice Facilities",
        "amount": 11,
        "desc": "TES Baseball Field Upper (inv 3377)"
      },
      {
        "date": "2026-09-19",
        "category": "Facility convenience fees",
        "amount": 1.48,
        "desc": "Tahoma convenience fee, Voltage share (invoice 3377)"
      }
    ],
    "remainder_org": "summit",
    "remainder_category": "TSD Facilities",
    "note": "Voltage lines are the Voltage Budget Tracker's Tahoma School District entries, dated by use. Voltage also carries its pro-rata share of each invoice's convenience fee, dated on the payment. The rest goes to Summit."
  },
  {
    "date": "2026-10-08",
    "match": "TAHOMA SD",
    "amount": 1159.03,
    "voltage": [
      {
        "date": "2026-07-01",
        "category": "Dirt Practice Facilities",
        "amount": 11,
        "desc": "TES Baseball Field Upper (inv 3327)"
      },
      {
        "date": "2026-07-12",
        "category": "Dirt Practice Facilities",
        "amount": 11,
        "desc": "TES Baseball Field Upper (inv 3327)"
      },
      {
        "date": "2026-07-13",
        "category": "Turf Practice Facilities",
        "amount": 55,
        "desc": "THS Fastpitch Field practice (inv 3327)"
      },
      {
        "date": "2026-07-24",
        "category": "Dirt Practice Facilities",
        "amount": 11,
        "desc": "TES Baseball Field Upper (inv 3327)"
      },
      {
        "date": "2026-09-11",
        "category": "Turf Practice Facilities",
        "amount": 61,
        "desc": "THS Baseball Field practice (inv 3451)"
      },
      {
        "date": "2026-09-13",
        "category": "Dirt Practice Facilities",
        "amount": 13,
        "desc": "TES Baseball Field Upper (inv 3451)"
      },
      {
        "date": "2026-09-14",
        "category": "Indoor Practice Facilities",
        "amount": 33.75,
        "desc": "TES Gym indoor (inv 3451)"
      },
      {
        "date": "2026-09-18",
        "category": "Dirt Practice Facilities",
        "amount": 13,
        "desc": "TES Baseball Field Upper (inv 3451)"
      },
      {
        "date": "2026-09-20",
        "category": "Dirt Practice Facilities",
        "amount": 13,
        "desc": "TES Baseball Field Upper (inv 3451)"
      },
      {
        "date": "2026-09-21",
        "category": "Indoor Practice Facilities",
        "amount": 33.75,
        "desc": "TES Gym indoor (inv 3451)"
      },
      {
        "date": "2026-09-25",
        "category": "Indoor Practice Facilities",
        "amount": 46.25,
        "desc": "MVMS Auxiliary Gym indoor (inv 3451)"
      },
      {
        "date": "2026-09-27",
        "category": "Dirt Practice Facilities",
        "amount": 13,
        "desc": "TES Baseball Field Upper (inv 3451)"
      },
      {
        "date": "2026-09-28",
        "category": "Indoor Practice Facilities",
        "amount": 33.75,
        "desc": "SLES Gym indoor (inv 3451)"
      },
      {
        "date": "2026-10-08",
        "category": "Facility convenience fees",
        "amount": 11.84,
        "desc": "Tahoma convenience fee, Voltage share (invoice 3327 + 3451)"
      }
    ],
    "remainder_org": "summit",
    "remainder_category": "TSD Facilities",
    "note": "Voltage lines are the Voltage Budget Tracker's Tahoma School District entries, dated by use. Voltage also carries its pro-rata share of each invoice's convenience fee, dated on the payment. The rest goes to Summit."
  }
];

export const BUDGETS = {
  "voltage": {
    "Dirt Practice Facilities": 420,
    "Turf Practice Facilities": 2420,
    "Indoor Practice Facilities": 3190,
    "Tournament Entry Fees": 4500,
    "Scrimmage Fees": 1200,
    "Equipment - Light Flight Pitching Machine": 600,
    "Equipment - Portable Batting Cage": 500,
    "503C Taxes": 200,
    "Equipment - Misc": 500,
    "Administration Fees": 300,
    "Team Insurance": 160,
    "Team Building": 300,
    "Uniforms": 4296,
    "Contingency Buffer (10%)": 1858.6
  },
  "summit": {
    "Tournament entry fees": 17000,
    "Event fees": 2920,
    "Equipment & supplies": 500,
    "TSD Facilities": 7968,
    "BDG": 10080,
    "Uniforms & apparel": 14520,
    "Coaching & Development": 3000,
    "Administration Fees": 724
  }
};
