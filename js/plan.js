// Ready-made 3-day family plan (kids 10 and 12), budget-minded.
// Facts checked in Nov 2026; prices and hours change, so each paid stop links
// to its official site. Weekday numbers: 0 = Sunday … 6 = Saturday.
// Coordinates are approximate (used for directions); the Google Maps links
// search by name, so they always open the right place.

export const PLAN_VERSION = "2026-11";

const STOPS = [
  /* ---------------- Day 1: Asakusa · Ueno · Akihabara ---------------- */
  {
    id: "plan-sensoji", day: 1, emoji: "⛩️", name: "Senso-ji Temple & Nakamise Street", type: "Temple",
    lat: 35.7148, lng: 139.7967, time: "08:00", stay: "1–1.5 h", cost: "Free (fortune slip ¥100)",
    maps: "Senso-ji Temple, Asakusa",
    tip: "Tokyo's oldest temple. Come early: before 9:00 it's calm and great for photos (main hall opens 6:30 Oct–Mar, 6:00 Apr–Sep; grounds always open). Kids love the omikuji fortune: shake the box, take the drawer with your number. Bad fortune? Tie it on the rack and leave it behind. Nakamise shops open around 9–10.",
    website: "https://www.senso-ji.jp/english/",
  },
  {
    id: "plan-kagetsudo", day: 1, emoji: "🍈", food: true, name: "Asakusa Kagetsudo (giant melon bread)", type: "Snack / bakery",
    lat: 35.7146, lng: 139.7955, time: "09:30", stay: "20 min", cost: "A few hundred yen each",
    maps: "Asakusa Kagetsudo Honten",
    tip: "Warm, crispy melon pan – a classic Asakusa snack. Eat it at the shop: walking while eating is considered rude in Japan. Cash is safest at small stalls.",
  },
  {
    id: "plan-kahaku", day: 1, emoji: "🦕", name: "National Museum of Nature and Science", type: "Science museum",
    lat: 35.7163, lng: 139.7764, time: "10:30", stay: "2–2.5 h", cost: "Adults ¥630 · kids FREE (high school and under)",
    closed: [1], closedNote: "Closed Mondays (Tuesday if Monday is a holiday)",
    maps: "National Museum of Nature and Science, Ueno",
    tip: "Best-value museum in Tokyo: dinosaurs, a full whale skeleton, Japanese robots and hands-on science. Start in the Global Gallery (dinosaurs, B1). Special exhibitions cost extra – the permanent halls are plenty. From Asakusa: Ginza Line to Ueno (5 min).",
    website: "https://www.kahaku.go.jp/english/",
    tickets: { url: "https://www.kahaku.go.jp/english/riyou/nyukan-annai/", label: "Admission info", note: "Pay at the entrance – no booking needed." },
  },
  {
    id: "plan-ameyoko", day: 1, emoji: "🍢", food: true, name: "Lunch: Ameyoko market street", type: "Street food",
    lat: 35.7097, lng: 139.7745, time: "13:00", stay: "1 h", cost: "~¥800–1,500 per person",
    maps: "Ameyoko Shopping Street, Ueno",
    tip: "Busy old market under the train tracks: skewers, takoyaki, fruit sticks, cheap ramen and kebab stalls. Let each kid pick one thing. Stay together – it gets crowded. Many stalls are cash only.",
  },
  {
    id: "plan-uenozoo", day: 1, emoji: "🦒", optional: true, name: "Ueno Zoo (if energy left)", type: "Zoo",
    lat: 35.7150, lng: 139.7714, time: "14:30", stay: "1.5–2 h", cost: "Adults ¥600 · kids 12 and under FREE · 13–15 ¥200",
    closed: [1], closedNote: "Closed Mondays · last entry 16:00",
    maps: "Ueno Zoo main gate",
    tip: "Cheap and easy right next to the museum. Note: the pandas went back to China in January 2026. Gorillas, tigers and the polar bears are the highlights. Skip it if jet lag hits – this is the day to rest early.",
    website: "https://www.tokyo-zoo.net/english/ueno/",
    tickets: { url: "https://www.tokyo-zoo.net/english/ueno/", label: "Zoo info", note: "Buy at the gate (machines take cash and IC cards)." },
  },
  {
    id: "plan-akihabara", day: 1, emoji: "🎮", optional: true, name: "Akihabara: arcades & toy floors", type: "Games & anime",
    lat: 35.6987, lng: 139.7728, time: "17:00", stay: "1–1.5 h", cost: "Free to look · claw games ¥100–200 a try",
    maps: "Akihabara Electric Town",
    tip: "Two stops from Ueno (JR Yamanote/Keihin-Tohoku – pay with IC card, not covered by the subway pass). Arcades (GiGO, Taito Station) have photo booths (purikura) and rhythm games. Set a claw-machine budget before going in! Some upper arcade floors are 18+ – stay on the main floors.",
  },
  {
    id: "plan-yodobashi", day: 1, emoji: "🍛", food: true, name: "Dinner: Yodobashi Akiba restaurant floor (8F)", type: "Family restaurants",
    lat: 35.6987, lng: 139.7744, time: "18:30", stay: "1 h", cost: "~¥1,000–1,800 per person",
    maps: "Yodobashi Akiba",
    tip: "A whole floor of family restaurants (tonkatsu, curry, sushi, Italian) with picture menus – easy for picky eaters. On the way, the toy floor (6F) is huge and free to browse.",
  },

  /* ---------------- Day 2: Harajuku · Shibuya · Shinjuku ---------------- */
  {
    id: "plan-meiji", day: 2, emoji: "⛩️", name: "Meiji Jingu Shrine", type: "Shrine & forest",
    lat: 35.6764, lng: 139.6993, time: "08:30", stay: "1 h", cost: "Free",
    maps: "Meiji Jingu",
    tip: "A forest walk to a big wooden shrine (gates open at sunrise). See the wall of sake barrels on the way. At the purification fountain: rinse left hand, right hand, then mouth from your hand – kids love doing it right. Station: Harajuku (JR) or Meiji-jingumae (subway).",
    website: "https://www.meijijingu.or.jp/en/",
  },
  {
    id: "plan-takeshita", day: 2, emoji: "🍓", food: true, name: "Takeshita Street + crepe", type: "Street & snack",
    lat: 35.6715, lng: 139.7030, time: "10:00", stay: "1 h", cost: "Crepe ~¥600–900",
    maps: "Takeshita Street, Harajuku",
    tip: "Colourful, crowded teen street. Before 11:00 is much calmer. Crepes (e.g. Marion Crepes) are the must-try – one each, or share to save. Eat at the stand, not while walking.",
  },
  {
    id: "plan-kiddyland", day: 2, emoji: "🧸", name: "Kiddy Land Harajuku", type: "Toy store",
    lat: 35.6688, lng: 139.7083, time: "11:00", stay: "45 min", cost: "Free to browse",
    maps: "Kiddy Land Harajuku",
    tip: "Five floors of Japanese characters (Sanrio, Ghibli, Snoopy, Pokémon). Give each kid a small souvenir budget. Tax refund with passport from ¥5,000 – save the receipt in the 🧾 Tax refund tab. Then walk down Cat Street to Shibuya (~15 min, flat).",
  },
  {
    id: "plan-uobei", day: 2, emoji: "🍣", food: true, name: "Lunch: Uobei Shibuya (bullet-train sushi)", type: "Conveyor sushi",
    lat: 35.6585, lng: 139.6983, time: "12:30", stay: "45 min", cost: "Plates ~¥120–150 · ~¥1,500 per person",
    maps: "Uobei Shibuya Dogenzaka",
    tip: "Order on a tablet (English), and your sushi arrives on a mini 'bullet train' – a kids' favourite and great value. Expect a short queue at peak lunch; arriving before 12:00 helps. Green tea and water are free.",
  },
  {
    id: "plan-scramble", day: 2, emoji: "🚦", name: "Shibuya Crossing & Hachiko", type: "Landmark",
    lat: 35.6595, lng: 139.7005, time: "13:30", stay: "30 min", cost: "Free",
    maps: "Shibuya Scramble Crossing",
    tip: "Cross it once together (hold hands), then watch from above for free from the station's walkways. Hachiko – the loyal dog statue – is right by the crossing; tell the kids his story first.",
  },
  {
    id: "plan-pokemon", day: 2, emoji: "⚡", name: "Pokémon Center & Nintendo TOKYO (Shibuya PARCO 6F)", type: "Game stores",
    lat: 35.6620, lng: 139.6987, time: "14:00", stay: "1 h", cost: "Free to browse",
    maps: "Shibuya PARCO",
    tip: "Both on the same floor – a highlight for 10–12-year-olds. Weekdays are calmer. Life-size Mewtwo at the Pokémon Center entrance makes a great photo. Set a budget first!",
  },
  {
    id: "plan-tocho", day: 2, emoji: "🌇", name: "Free sunset view: Tokyo Metropolitan Government Building", type: "Observation deck",
    lat: 35.6896, lng: 139.6922, time: "16:00", stay: "45 min", cost: "Free",
    maps: "Tokyo Metropolitan Government Building Observation Deck",
    tip: "45th-floor view over all of Tokyo – on clear days even Mt. Fuji – for free (security check at the lift). Each deck closes some days (South: 1st & 3rd Tuesday, North: 2nd & 4th Monday). After dark there's a free projection show on the building. Paid alternative with an open-air roof: Shibuya Sky (book weeks ahead for sunset).",
    website: "https://www.gotokyo.org/en/tourists/info/observatory.html",
    tickets: { url: "https://www.shibuya-scramble-square.com/sky/", label: "Shibuya Sky (paid option)", note: "Adults ~¥2,700–3,400 online; elementary kids ~¥1,200 (same day). Not needed if you do the free deck." },
  },
  {
    id: "plan-shinjuku-dinner", day: 2, emoji: "🍜", food: true, name: "Dinner: ramen in Shinjuku", type: "Ramen",
    lat: 35.6920, lng: 139.7022, time: "18:00", stay: "1 h", cost: "~¥1,000–1,500 per bowl",
    maps: "Ichiran Shinjuku",
    tip: "Ichiran's private booths and paper order sheets (in English) are fun for kids – choose 'mild' spice. Slurping is polite! Cheaper option: a gyudon or curry chain (Matsuya, Sukiya, CoCo Ichibanya) around ¥600–900.",
  },

  /* ---------------- Day 3: teamLab · Toyosu · Odaiba · Tokyo Station ---------------- */
  {
    id: "plan-teamlab", day: 3, emoji: "✨", name: "teamLab Planets (Toyosu)", type: "Digital art museum",
    lat: 35.6491, lng: 139.7898, time: "09:00", stay: "1.5–2 h", cost: "Adults ~¥3,600–4,200 · ages 4–12 ~¥1,500 · 13–17 ~¥2,800",
    maps: "teamLab Planets TOKYO",
    tip: "BOOK ONLINE BEFORE THE TRIP – timed tickets sell out. The first slot is the least crowded. You walk barefoot through knee-deep water: wear shorts or trousers that roll above the knee (some floors are mirrors – no skirts). Free lockers. Bring passports/ID for child prices. Station: Shin-Toyosu (Yurikamome).",
    website: "https://www.teamlab.art/e/planets/",
    tickets: { url: "https://teamlabplanets.dmm.com/en/", label: "Buy teamLab tickets (official)", note: "Prices change by date – buy on the official store, not resellers." },
  },
  {
    id: "plan-lalaport", day: 3, emoji: "🍱", food: true, name: "Lunch: LaLaport Toyosu food court", type: "Food court",
    lat: 35.6553, lng: 139.7942, time: "11:30", stay: "1 h", cost: "~¥900–1,400 per person",
    maps: "LaLaport Toyosu",
    tip: "Big mall food court by the water – everyone can choose their own (udon, ramen, curry, burgers). 10–15 min walk from teamLab. Arrive before 12:00 to get a table.",
    website: "https://mitsui-shopping-park.com/lalaport/toyosu/",
  },
  {
    id: "plan-odaiba", day: 3, emoji: "🌉", name: "Odaiba Seaside Park (via the Yurikamome train)", type: "Beach park & views",
    lat: 35.6297, lng: 139.7745, time: "13:30", stay: "1.5 h", cost: "Free (Yurikamome fare by IC card)",
    maps: "Odaiba Seaside Park",
    tip: "Ride the driverless Yurikamome from Toyosu – grab the very front seats for a 'driver's view' over Rainbow Bridge. The Yurikamome is NOT covered by the Tokyo Subway Ticket; just tap your IC card. Sandy beach (no swimming), Statue of Liberty replica and bridge views.",
  },
  {
    id: "plan-smallworlds", day: 3, emoji: "🚀", optional: true, name: "SMALL WORLDS Tokyo (paid option)", type: "Miniature museum",
    lat: 35.6365, lng: 139.7930, time: "13:30", stay: "2 h", cost: "Adults ~¥3,200 · 12–17 ~¥2,100 · 4–11 ~¥1,700",
    maps: "SMALL WORLDS TOKYO",
    tip: "Huge indoor miniature world with moving trains, a space centre and anime scenes – great on a rainy day. Swap it for Odaiba Seaside Park if it rains; skip it to keep the day cheaper.",
    website: "https://www.smallworlds.jp/",
    tickets: { url: "https://www.smallworlds.jp/", label: "SMALL WORLDS tickets (official)", note: "Check current prices and online discounts on the official site." },
  },
  {
    id: "plan-character", day: 3, emoji: "🛍️", name: "Tokyo Character Street (Tokyo Station)", type: "Character shops",
    lat: 35.6800, lng: 139.7680, time: "16:30", stay: "1 h", cost: "Free to browse",
    maps: "Tokyo Character Street",
    tip: "Underground street of ~30 character shops (Pokémon, Ghibli, Sanrio, Jump, Lego). Inside Tokyo Station's Yaesu side, basement 1 (First Avenue). Shops ~10:00–20:30.",
    website: "https://www.gotokyo.org/en/spot/660/index.html",
  },
  {
    id: "plan-ramenstreet", day: 3, emoji: "🍜", food: true, name: "Dinner: Tokyo Ramen Street", type: "Ramen",
    lat: 35.6797, lng: 139.7682, time: "17:30", stay: "1 h", cost: "~¥1,000–1,400 per bowl",
    maps: "Tokyo Ramen Street",
    tip: "Eight famous ramen shops side by side, right next to Character Street (10:30–23:00). Buy tickets at the machine by the door; queues move fast. Go before 18:00 to beat the dinner rush.",
  },
];

export const PLAN_DAYS = [
  {
    key: "d1", title: "Old Tokyo & dinosaurs", area: "Asakusa · Ueno · Akihabara",
    summary: "An easy first day close together – perfect for jet lag (you'll wake early anyway). Temple at breakfast time, a free-for-kids museum, a market lunch, and games in Akihabara if you still have energy.",
    budget: "≈ ¥11,000–14,000 for the family + transport (kids free at the museum and zoo).",
    before: ["Check the date: the museum and zoo are closed on Mondays.", "Bring cash coins for the fortune slip and market stalls."],
  },
  {
    key: "d2", title: "Shrines, sushi trains & Pokémon", area: "Harajuku · Shibuya · Shinjuku",
    summary: "Forest shrine in the morning, Harajuku sweets, the famous crossing, Pokémon & Nintendo, and a free sunset view over Tokyo.",
    budget: "≈ ¥12,000–15,000 for the family + transport + souvenirs (every sight is free).",
    before: ["Agree a souvenir budget with the kids before Kiddy Land / Pokémon Center.", "Sunset in winter is about 16:30 – be at the free deck by 16:00."],
  },
  {
    key: "d3", title: "Digital art & the bay", area: "Toyosu · Odaiba · Tokyo Station",
    summary: "Walk through water and light at teamLab Planets, lunch by the bay, ride the driverless train over the water, and finish with character shops and ramen at Tokyo Station.",
    budget: "≈ ¥20,000–23,000 for the family + transport (teamLab is most of it; SMALL WORLDS adds ≈ ¥10,000).",
    before: ["Book teamLab Planets online now – pick the first time slot.", "Pack shorts or roll-up trousers and a small towel for teamLab."],
  },
];

export const TIPS = [
  ["🚇", "Transport passes", "Tokyo Subway Ticket (Tokyo Metro + Toei subways only): 24h ¥1,000 / 48h ¥1,500 / 72h ¥2,000 adult, half for kids 6–11. Worth it from about 4 subway rides a day. Buy at the airports or big electronics stores with your passport. JR lines and the Yurikamome are not included – use an IC card for those.", "https://www.tokyometro.jp/lang_en/ticket/value/travel/index.html"],
  ["💳", "IC cards (Suica / PASMO)", "Everyone needs their own card. iPhone: add Suica in Apple Wallet or use the Welcome Suica Mobile app. Physical Welcome Suica at the airport. Kids 6–11 pay half fare only with a child IC card (issued at a staffed JR/subway office with the child's passport) or a child paper ticket. A 12-year-old pays child fare while still in elementary school.", "https://www.jreast.co.jp/multi/en/welcomesuica/"],
  ["💴", "Cash", "Carry ¥10,000–20,000 in cash. Temple stalls, markets and small restaurants are often cash only. 7-Eleven and Japan Post ATMs take foreign cards."],
  ["🍙", "Eat well for less", "Konbini (7-Eleven, Lawson, FamilyMart) breakfasts: onigiri, sandwiches, yogurt for ~¥300–500 each. Lunch sets are cheaper than dinner. Food courts and department-store basements (discounts after ~19:00). Water and tea are free in restaurants. No tipping."],
  ["⏰", "Beat crowds & rush hour", "Avoid trains 7:30–9:30 and 17:30–19:30 on weekdays. Start sights early (jet lag helps). Women-and-children-only cars run in the morning rush on many lines (pink signs)."],
  ["🙇", "Manners kids should know", "Be quiet on trains, no phone calls. Stand on the left on Tokyo escalators. Don't eat while walking. Few bins – carry a small trash bag. Shoes off where you see a step up or slippers."],
  ["🧭", "Stay together", "Give each kid a card with the hotel name, address (in Japanese) and your phone number. Agree a meeting point at big stations (e.g. a named ticket gate). Download Google Maps offline and Google Translate (camera mode reads menus)."],
  ["🚻", "Toilets & lockers", "Free, clean toilets at stations, konbini and department stores. Coin lockers at most stations (cash or IC card) – handy for shopping bags."],
  ["🛍️", "Tax refund", "Since Nov 1, 2026 you pay the full price (incl. 10% tax) and show your passport at the till; the tax is refunded after customs checks the goods when you leave Japan (≥ ¥5,000 before tax per shop per day, keep goods unused in hand luggage). Save every receipt with a product photo in the 🧾 Tax refund tab."],
  ["🆘", "Help", "Police 110 · Ambulance/fire 119 · Japan Visitor Hotline (24h, English) 050-3816-2787."],
];

const BY_ID = Object.fromEntries(STOPS.map((s) => [s.id, s]));
export const planStop = (id) => BY_ID[id] || null;
export const planDay = (key) => PLAN_DAYS.find((d) => d.key === key) || null;

/** Days ready to put into the trip (start = the family's hotel, set in the app). */
export function buildPlanDays(start, firstDate) {
  return PLAN_DAYS.map((d, i) => {
    let date = "";
    if (firstDate) {
      const x = new Date(`${firstDate}T12:00:00Z`);
      x.setUTCDate(x.getUTCDate() + i);
      date = x.toISOString().slice(0, 10);
    }
    return {
      id: Math.random().toString(36).slice(2, 10),
      planKey: d.key,
      date,
      start: start ? { ...start } : null,
      stops: STOPS.filter((s) => s.day === i + 1).map((s) => ({ ...s })),
    };
  });
}

/** Google Maps place link (no key needed). */
export function mapsLink(p) {
  const q = p.maps || p.name || `${p.lat},${p.lng}`;
  let u = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  if (p.id && !String(p.id).startsWith("pin-") && !String(p.id).startsWith("plan-")) u += `&query_place_id=${encodeURIComponent(p.id)}`;
  return u;
}
