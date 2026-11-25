// Brand settings. Edit this file to change colors, names, fonts or logos; no other code changes needed.
// To add a logo: put the file in public/brand/ and set `logo` to its path (missing files are hidden automatically).

const BRANDS = {
  // Shown when "all" orgs is selected: neutral, names both organizations.
  all: {
    title: "Org finances | Summit United and Voltage",
    name: "Summit United + Voltage Baseball Club",
    tagline: "Finance reports",
    logo: null,
    vars: {
      "bg": "#f4f6f8", "surface": "#ffffff", "text": "#16202a", "muted": "#5b6570", "border": "#dde1e6",
      "th-bg": "#eef1f5", "th-text": "#16202a", "accent": "#334155", "accent2": "#334155", "on-accent": "#ffffff",
      "link": "#1d4ed8", "bad": "#b42318", "ok": "#067647", "warn": "#b54708",
      "header-bg": "#ffffff", "header-text": "#16202a",
      "font-head": "system-ui, sans-serif", "font-body": "system-ui, sans-serif", "head-weight": "700", "head-spacing": "0",
    },
  },

  // Voltage Baseball Club: black #0A0A0A, yellow #F3E108, teal #24B0B7, diagonal stripes, Bangers / Barlow Condensed.
  voltage: {
    title: "Voltage Baseball Club | Finances",
    name: "Voltage Baseball Club",
    tagline: "Finance reports",
    logo: "brand/voltage-logo.png",
    vars: {
      "bg": "#0a0a0a", "surface": "#151515", "text": "#f5f5f5", "muted": "#a8a8a8", "border": "#2c2c2c",
      "th-bg": "#1d1d1d", "th-text": "#24b0b7", "accent": "#f3e108", "accent2": "#24b0b7", "on-accent": "#0a0a0a",
      "link": "#24b0b7", "bad": "#ff6b6b", "ok": "#24b0b7", "warn": "#f3e108",
      "header-bg": "repeating-linear-gradient(135deg, rgba(243,225,8,.10) 0 14px, rgba(243,225,8,0) 14px 28px), #0a0a0a",
      "header-text": "#f5f5f5",
      "font-head": "'Bangers', 'Barlow Condensed', Impact, sans-serif",
      "font-body": "'Barlow Condensed', 'Barlow', system-ui, sans-serif", "head-weight": "400", "head-spacing": ".04em",
    },
  },

  // Summit United / Summit Fastpitch: navy #1b2a41, teal #3eb4aa / #2e938b, soft teal #eaf7f5; Poppins + Inter (from the website).
  summit: {
    title: "Summit United | Finances",
    name: "Summit United",
    tagline: "Finance reports",
    logo: "brand/summit-logo.png",
    vars: {
      "bg": "#f1f3f4", "surface": "#ffffff", "text": "#1b2a41", "muted": "#55606b", "border": "#e2e6e8",
      "th-bg": "#eaf7f5", "th-text": "#1b2a41", "accent": "#3eb4aa", "accent2": "#2e938b", "on-accent": "#ffffff",
      "link": "#2e938b", "bad": "#b42318", "ok": "#2e938b", "warn": "#b54708",
      "header-bg": "#ffffff", "header-text": "#1b2a41",
      "font-head": "'Poppins', system-ui, sans-serif", "font-body": "'Inter', system-ui, sans-serif",
      "head-weight": "700", "head-spacing": "0",
    },
  },
};
