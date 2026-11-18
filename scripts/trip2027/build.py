"""Build data/tokyo-5day-2027.json and docs/tokyo-5day-guide.md, then validate.

Run:  python3 scripts/trip2027/build.py
"""
import datetime as dt
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from data import ARRIVAL, ATTRACTIONS, DATES, FOOD, HOTEL, KONBINI_TIP, PREP  # noqa: E402
from network import WAIT, journey, rail, walk_minutes  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
CATS = ["museum", "anime", "food", "views", "kids_fun", "arcade"]
MAX_LEG = 45
FOOD_MAX_WALK = 12  # "approximately 10 minutes"
FOOD_WALK_OVERRIDE = {}  # per-stop exceptions (none needed)

DAYS = [
    dict(key="d1", title="Sakura gardens, fire engines & Godzilla", area="Yoyogi · Shinjuku · Harajuku · Shibuya",
         summary="Start the trip next to the hotel with Shinjuku Gyoen's cherry blossoms, a free fire-engine museum and Godzilla peering over Shinjuku. Afternoon in Harajuku and Shibuya for gyoza, anime treasures, arcades and a free (or paid) skyline view.",
         before=["Shinjuku Gyoen is in peak sakura week: arrive at 9:00; no alcohol, bags checked.",
                 "Arcades: under-16s must leave by 18:00 – do them in the afternoon.",
                 "SHIBUYA SKY is optional and expensive – book online only if you want it."],
         five=["shinjuku-gyoen", "fire-museum", "isetan-food-hall", "godzilla-head", "taito-kabukicho"],
         seven=["shinjuku-gyoen", "fire-museum", "isetan-food-hall", "godzilla-head", "taito-kabukicho",
                "hikarie-sky-lobby", "mandarake-shibuya"]),
    dict(key="d2", title="Skytree, penguins & old Edo", area="Oshiage · Skytree · Sumida · Ryogoku",
         summary="A Friday in east Tokyo: the reopened Edo-Tokyo Museum, then Skytree, Kirby and Pokémon under one roof and penguins at Sumida Aquarium. Finish with riverside cherry blossoms and arcade games.",
         before=["Book Skytree (weekday advance) and Kirby Café online.",
                 "The Sumo Museum is weekdays only – today is your chance.",
                 "Sumida Park sakura: Friday is calmer than the weekend."],
         five=["edo-tokyo-museum", "skytree", "kirby-cafe", "sumida-aquarium", "taito-asakusa"],
         seven=["edo-tokyo-museum", "skytree", "kirby-cafe", "pokemon-center-skytree", "sumida-aquarium",
                "sumida-park", "taito-asakusa"]),
    dict(key="d3", title="Rides, baseball & retro games", area="Tokyo Dome · Korakuen · Kanda · Akihabara",
         summary="Saturday of rides at Tokyo Dome City, Ohtani at the Baseball Museum and an Edo garden in bloom. Then Kanda's anime shrine, trains rushing past at mAAch ecute and retro arcade games in Akihabara.",
         before=["Saturday + spring break: ride queues grow after 11:00 – start at Tokyo Dome City at opening.",
                 "Check the ride passport price calendar the day before.",
                 "Origami Kaikan is usually closed Sundays – Saturday works."],
         five=["baseball-museum", "big-o", "kanda-myojin", "maach-ecute", "super-potato"],
         seven=["koishikawa-korakuen", "baseball-museum", "dome-attractions", "kanda-myojin", "maach-ecute",
                "radio-kaikan", "super-potato"]),
    dict(key="d4", title="Bay day: footbaths, Gundam & Joypolis", area="Toyosu · Ariake · Odaiba",
         summary="Sunday by the bay: market brunch and a free footbath at Toyosu, an earthquake-survival adventure at Sona Area and Gundam at DiverCity. End with arcades, Joypolis (or LEGOLAND) and takoyaki with retro sweets at DECKS.",
         before=["Toyosu Market is CLOSED on Sundays – Senkyaku Banrai (food hall) is open.",
                 "Miraikan is closed until Apr 23, 2027 and the giant Gundam statue is gone (2026).",
                 "Joypolis is expensive (~¥16,000 for three) – decide in advance; Round1 is the cheap alternative.",
                 "Yurikamome/Rinkai trains are not covered by the Tokyo Subway Ticket.",
                 "Optional evening: walk the free Rainbow Bridge promenade (~1.7 km; closed 3rd Monday and in strong wind) – eat first, there is no food on the bridge."],
         five=["senkyaku-banrai", "sona-area", "divercity-gundam", "round1-divercity", "joypolis"],
         seven=["senkyaku-banrai", "sona-area", "divercity-gundam", "round1-divercity", "fuji-tv", "joypolis",
                "decks-takoyaki"]),
    dict(key="d5", title="Pokémon, capsule toys & the rooftop aquarium", area="Ikebukuro · Sunshine City",
         summary="Monday-proof day (many museums close on Mondays, Sunshine City doesn't): earthquake simulator, rooftop aquarium and a planetarium. Then Pokémon Center Mega Tokyo, 3,000 capsule-toy machines, Namja Town's gyoza and a sunset 240 m up.",
         before=["Monday April 5: most city museums are closed – this day avoids them.",
                 "Book the Bosaikan (earthquake simulator) in advance; tours are in Japanese.",
                 "Bring ¥100 coins for Gashapon (change machines inside)."],
         five=["bosaikan", "mutekiya", "gigo-ikebukuro", "pokemon-center-mega", "tenbou-park"],
         seven=["sunshine-aquarium", "planetarium-manten", "pokemon-center-mega", "gashapon-store", "namja-town",
                "gigo-ikebukuro-2", "tenbou-park"]),
]

TRANSPORT = {  # IC-card pay-as-you-go estimates per day (12-year-old pays ADULT fares from Apr 1)
    "d1": (600, 600, 300), "d2": (1000, 1000, 500), "d3": (800, 800, 400), "d4": (1700, 1700, 850),
    "d5": (500, 500, 250),
}
FOOD_PP = (3000, 2800, 2300)  # snack + lunch + dinner, budget choices (adult, 12, 10)


def yen(n):
    return f"¥{n:,}"


def stay_minutes(s):
    """'1.5–2 h' -> 90, '45 min' -> 45, '45 min–1 h' -> 45, '1 h 40 min' -> 100."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:–\s*\d+(?:\.\d+)?)?\s*(h|min)", s)
    if not m:
        return 45
    v = float(m.group(1)) * (60 if m.group(2) == "h" else 1)
    extra = re.search(r"h\s+(\d+)\s*min", s)
    return int(v + (int(extra.group(1)) if m.group(2) == "h" and extra else 0))


def place(a):
    return {"lat": a["lat"], "lng": a["lng"], "node": a["node"], "walk": a["walk"]}


def hotel_minutes(a):
    best = walk_minutes((HOTEL["lat"], HOTEL["lng"]), (a["lat"], a["lng"]))
    for node, w in HOTEL["nodes"]:
        ride, _ = rail(node, a["node"]) if node != a["node"] else (0, [])
        best = min(best, w + WAIT + ride + a["walk"])
    return best


def build():
    by_id = {a["id"]: a for a in ATTRACTIONS}
    stops, food, edges = [], [], []

    for a in ATTRACTIONS:
        date = DATES[a["day"] - 1]
        weekday = (dt.date.fromisoformat(date).weekday() + 1) % 7  # 0 = Sunday
        open_today = weekday not in a["closed"]
        s = {k: a[k] for k in ["id", "day", "emoji", "name", "type", "categories", "appCategory", "lat", "lng",
                               "address", "station", "hours", "closed", "closedNote", "bestTime", "stay", "cost",
                               "booking", "maps", "tip", "website"]}
        s["tickets"] = a["tickets"] or {"url": "", "label": "", "note": "No ticket needed / pay at the door"}
        s["indoor"] = a["indoor"]
        s["hotelMinutes"] = hotel_minutes(a)
        # extras (ignored by strict schema readers, used by the app)
        s["tripDate"] = date
        s["openOnTripDay"] = open_today
        s["weatherAlt"] = a["weatherAlt"]
        s["priceYen"] = {"adult": a["prices"][0], "age12": a["prices"][1], "age10": a["prices"][2]}
        s["verify"] = a["verify"]
        stops.append(s)

        # ---- food: nearest meal / special / snack within ~10 min + nearest konbini
        here = (a["lat"], a["lng"])
        cands = []
        for f in FOOD:
            if f["day"] != a["day"]:
                continue
            if f["name"].lower()[:12] == a["name"].lower()[:12]:
                continue  # the attraction itself
            w = walk_minutes(here, (f["lat"], f["lng"]))
            if w <= FOOD_WALK_OVERRIDE.get(a["id"], FOOD_MAX_WALK):
                cands.append((w, f))
        cands.sort(key=lambda x: x[0])
        chosen = []
        for kind in ("meal", "special", "snack"):
            for w, f in cands:
                if f["kind"] == kind and f not in [c[1] for c in chosen]:
                    chosen.append((w, f))
                    break
        for w, f in cands:  # top up with whatever is closest
            if len(chosen) >= 3:
                break
            if f not in [c[1] for c in chosen]:
                chosen.append((w, f))
        for w, f in chosen:
            food.append({
                "id": f"plan-d{a['day']}-food-{a['id'].split('-', 2)[2]}-{f['slug']}", "day": a["day"], "food": True,
                "afterStop": a["id"], "kind": f["kind"], "emoji": f["emoji"], "name": f["name"], "type": f["type"],
                "lat": f["lat"], "lng": f["lng"], "walkMinutes": w, "hours": f["hours"], "closed": f["closed"],
                "cost": f["cost"], "cashOnly": f["cashOnly"], "kidFriendly": f["kidFriendly"], "maps": f["maps"],
                "tip": f["tip"], "verify": f["verify"],
            })
        food.append({
            "id": f"plan-d{a['day']}-food-{a['id'].split('-', 2)[2]}-konbini", "day": a["day"], "food": True,
            "afterStop": a["id"], "kind": "snack", "emoji": "🏪", "name": "Nearest konbini (7-Eleven / FamilyMart / Lawson)",
            "type": "Convenience store", "lat": a["lat"], "lng": a["lng"], "walkMinutes": 3, "hours": "24 h",
            "closed": [], "cost": "¥300–700", "cashOnly": False, "kidFriendly": "Very – onigiri, sandwiches, ice cream",
            "maps": f"convenience store near {a['maps']}", "tip": KONBINI_TIP,
            "verify": ["coordinates = the attraction; search 'konbini' on Google Maps for the nearest one"],
        })

    for d in range(1, 6):
        pool = [a for a in ATTRACTIONS if a["day"] == d]
        for i, p in enumerate(pool):
            for q in pool[i + 1:]:
                j = journey(place(p), place(q))
                if j["minutes"] <= MAX_LEG:
                    edges.append({"from": p["id"], "to": q["id"], "minutes": j["minutes"], "mode": j["mode"],
                                  "line": j["line"], "walkMinutes": j["walkMinutes"]})

    days = []
    for i, d in enumerate(DAYS):
        n = i + 1
        seven = [f"plan-d{n}-{s}" for s in d["seven"]]
        five = [f"plan-d{n}-{s}" for s in d["five"]]
        adult = sum(by_id[s]["prices"][0] for s in seven) + FOOD_PP[0] + TRANSPORT[d["key"]][0]
        k12 = sum(by_id[s]["prices"][1] for s in seven) + FOOD_PP[1] + TRANSPORT[d["key"]][1]
        k10 = sum(by_id[s]["prices"][2] for s in seven) + FOOD_PP[2] + TRANSPORT[d["key"]][2]
        t = TRANSPORT[d["key"]]
        att = [sum(by_id[s]["prices"][k] for s in seven) for k in range(3)]
        budget = (f"7-stop route ≈ {yen(adult + k12 + k10)} for all three "
                  f"(adult {yen(adult)} · age 12 {yen(k12)} · age 10 {yen(k10)}). "
                  f"Attractions {yen(sum(att))}, food {yen(sum(FOOD_PP))} (budget meals), transport {yen(sum(t))} (IC card; "
                  f"the 12-year-old pays adult fares from Apr 1). Extras (arcades, gashapon, souvenirs) not included.")
        days.append({"key": d["key"], "date": DATES[i], "title": d["title"], "area": d["area"], "summary": d["summary"],
                     "budget": budget, "before": d["before"], "suggestedRoute": seven,
                     "routes": {"five": five, "seven": seven},
                     "budgetYen": {"adult": adult, "age12": k12, "age10": k10, "total": adult + k12 + k10,
                                   "attractions": att, "food": list(FOOD_PP), "transport": list(t)}})

    data = {
        "version": "gpt-2026-11",
        "trip": {
            "hotel": {"name": HOTEL["name"], "lat": HOTEL["lat"], "lng": HOTEL["lng"], "station": HOTEL["station"],
                      "address": HOTEL["address"]},
            "firstDate": DATES[0], "kidsAges": [10, 12], "maxLegMinutes": MAX_LEG, "categories": CATS,
        },
        "arrival": ARRIVAL,
        "preparation": [{"id": sec["id"], "icon": sec["icon"], "title": sec["title"],
                         "items": [{"id": f"{sec['id']}-{k}", "text": t} for k, t in sec["items"]]} for sec in PREP],
        "days": days, "stops": stops, "food": food, "edges": edges,
        "verification": {
            "researched": "2026-11-18 via web search (official sites where found). April 2027 details are provisional unless stated.",
            "coordinates": "Entrance estimates (~50–150 m); Google Maps links search by name so navigation is unaffected.",
            "travelTimes": "Estimated from a rail-network model (walk + 4 min wait + ride + 5 min per transfer + walk) or a walking estimate (straight line x1.3 at 75 m/min). Not timetable lookups.",
            "hotel": HOTEL["verify"],
            "ageRule": "Japan's school year starts April 1: from 2027-04-01 the 12-year-old is junior-high age (adult train fares, junior-high admission bands).",
        },
    }
    return data


def validate(data):
    errs = []
    ids = [s["id"] for s in data["stops"]] + [f["id"] for f in data["food"]]
    if len(ids) != len(set(ids)):
        errs.append("duplicate ids")
    for i in ids:
        if not re.fullmatch(r"plan-[a-z0-9]+(-[a-z0-9]+)*", i):
            errs.append(f"bad id {i}")
    stop_ids = {s["id"] for s in data["stops"]}
    by_id = {s["id"]: s for s in data["stops"]}
    for f in data["food"]:
        if f["afterStop"] not in stop_ids:
            errs.append(f"food {f['id']} -> missing {f['afterStop']}")
    for s in data["stops"]:
        n = sum(1 for f in data["food"] if f["afterStop"] == s["id"])
        if not 3 <= n <= 4:
            errs.append(f"{s['id']} has {n} food options")
        if s["day"] not in range(1, 6):
            errs.append(f"{s['id']} bad day")
        if any(c not in CATS for c in s["categories"]):
            errs.append(f"{s['id']} unknown category")
    edge_set = {}
    for e in data["edges"]:
        if e["from"] not in stop_ids or e["to"] not in stop_ids:
            errs.append(f"edge to missing id {e}")
        if e["minutes"] > MAX_LEG:
            errs.append(f"edge > 45 {e}")
        if by_id[e["from"]]["day"] != by_id[e["to"]]["day"]:
            errs.append(f"cross-day edge {e}")
        edge_set[frozenset((e["from"], e["to"]))] = e
    for d in data["days"]:
        n = int(d["key"][1])
        pool = [s for s in data["stops"] if s["day"] == n]
        if not 12 <= len(pool) <= 16:
            errs.append(f"{d['key']} pool size {len(pool)}")
        for c in CATS:
            k = sum(1 for s in pool if c in s["categories"])
            if k < 2:
                errs.append(f"{d['key']} category {c} only {k}")
        for name, route in [("suggested", d["suggestedRoute"]), ("five", d["routes"]["five"]),
                            ("seven", d["routes"]["seven"])]:
            if not 5 <= len(route) <= 7:
                errs.append(f"{d['key']} {name} length {len(route)}")
            if name == "five" and len(route) != 5:
                errs.append(f"{d['key']} five-route not 5")
            if name == "seven" and len(route) != 7:
                errs.append(f"{d['key']} seven-route not 7")
            if any(r not in stop_ids or by_id[r]["day"] != n for r in route):
                errs.append(f"{d['key']} {name} route has bad id")
                continue
            cov = {c for r in route for c in by_id[r]["categories"]}
            if set(CATS) - cov:
                errs.append(f"{d['key']} {name} route misses {set(CATS) - cov}")
            for a, b in zip(route, route[1:]):
                if frozenset((a, b)) not in edge_set:
                    errs.append(f"{d['key']} {name}: no edge {a} -> {b}")
            for r in route:
                if not by_id[r]["openOnTripDay"]:
                    errs.append(f"{d['key']} {name}: {r} is closed on the trip day")
    return errs


def route_times(route, by_id, edge_of):
    t = 9 * 60 + by_id[route[0]]["hotelMinutes"]  # leave hotel at 9:00
    rows = []
    for i, r in enumerate(route):
        s = by_id[r]
        if i:
            t += edge_of(route[i - 1], r)["minutes"]
        m = re.search(r"(\d{1,2}):(\d{2})", s["hours"])  # first time in the hours = opening time
        if m:
            t = max(t, int(m.group(1)) * 60 + int(m.group(2)))
        rows.append((t, s))
        t += stay_minutes(s["stay"])
    return rows


def guide(data):
    by_id = {s["id"]: s for s in data["stops"]}
    edges = {frozenset((e["from"], e["to"])): e for e in data["edges"]}

    def edge_of(a, b):
        return edges[frozenset((a, b))]

    hh = lambda m: f"{m // 60:02d}:{m % 60:02d}"  # noqa: E731
    out = ["# Tokyo Kids Explorer – arrival day + 5-day family plan (March 31 – April 5, 2027)", "",
           "**Family:** 1 adult + kids aged 12 and 10 · **Base:** Rainbow Palace Yoyogi (3-55-1 Yoyogi) · "
           "**Rule:** after each stop, the app shows only places reachable within **45 minutes** door to door.", "",
           "> **Read first**",
           "> - Researched 2026-11-18. April 2027 hours/prices are provisional where marked ⚠️ – check the official link before you go.",
           "> - **Age rule:** Japan's school year starts April 1, so from April 1, 2027 your 12-year-old is junior-high age – adult train fares and junior-high admission bands. The 10-year-old is elementary (child fares).",
           "> - **Cherry blossoms:** Tokyo's average full bloom is around March 24–April 3, so expect peak sakura (and crowds) on Days 1–3. Japanese schools are on spring break: weekdays are busy at kid attractions too.",
           "> - **Monday April 5:** many museums close on Mondays – Day 5 (Ikebukuro) avoids them. Shinjuku Gyoen is open every day Mar 25–Apr 24, 2027 (official calendar).",
           "> - **Closed during the trip:** Miraikan (reopens Apr 23, 2027), Unicorn Gundam statue (removed 2026), Toyosu Market on Sunday Apr 4.",
           "> - Travel minutes are estimates from a rail-network model; the app's Navigate button gives live Google Maps directions.",
           ""]
    a = data["arrival"]
    out += [f"## ✈️ Arrival day · Wed Mar 31 — {a['area']}", "", f"**{a['title']}.** {a['summary']}", "",
            f"*{a['duration']}*", "", "### At Narita Airport, step by step", ""]
    for st in a["airportSteps"]:
        out.append(f"- **{st['title']}** – {st['detail']}")
    out += ["", "### Getting to Rainbow Palace Yoyogi", ""]
    for rt in a["routes"]:
        out += [f"#### {'⭐ ' if rt['recommended'] else ''}{rt['name']}", f"{rt['time']} · {rt['cost']}. {rt['why']}", ""]
        out += [f"{i}. {x}" for i, x in enumerate(rt["steps"], 1)] + [""]
    out += ["### Arrival checklist", ""] + [f"- [ ] {c}" for c in a["checklist"]] + [""]
    out += [f"**Evening:** {a['evening']}", "", f"**Budget:** {a['budget']}", "",
            "⚠️ Check before you go: " + ", ".join(a["verify"]), "",
            "## ✅ Preparation checklist", ""]
    for sec in data["preparation"]:
        out += [f"### {sec['icon']} {sec['title']}", ""] + [f"- [ ] {it['text']}" for it in sec["items"]] + [""]
    names = {"museum": "🏛️ Museum", "anime": "⚡ Anime & characters", "food": "🍜 Food", "views": "🌆 Views",
             "kids_fun": "🎢 Kids' fun", "arcade": "🕹️ Arcade"}
    for d in data["days"]:
        n = int(d["key"][1])
        pool = [s for s in data["stops"] if s["day"] == n]
        date = dt.date.fromisoformat(d["date"])
        out += [f"## Day {n} · {date.strftime('%a %b')} {date.day} — {d['area']}", "", f"**{d['title']}.** {d['summary']}", ""]
        out += ["**Before you go**", ""] + [f"- {b}" for b in d["before"]] + [""]
        out += ["### Attraction pool by category", ""]
        for c in CATS:
            items = [s for s in pool if c in s["categories"]]
            out.append(f"- **{names[c]}:** " + "; ".join(f"{s['emoji']} {s['name']} ({s['cost'].split('·')[0].strip()})" for s in items))
        out.append("")
        for label, key in (("Suggested route (7 stops)", "seven"), ("Short route (5 stops)", "five")):
            route = d["routes"][key]
            out += [f"### {label}", ""]
            for t, s in route_times(route, by_id, edge_of):
                out.append(f"1. **{hh(t)} {s['emoji']} {s['name']}** – {s['stay']} · {s['cost']}")
            out.append("")
        out += ["### Stop by stop: what's reachable next (≤ 45 min) and where to eat", ""]
        for s in pool:
            warn = " ⚠️ check: " + ", ".join(s["verify"]) if s["verify"] else ""
            out += [f"#### {s['emoji']} {s['name']}",
                    f"{s['type']} · {', '.join(s['categories'])} · from hotel ~{s['hotelMinutes']} min",
                    "",
                    f"- **Hours:** {s['hours']}" + (f" · {s['closedNote']}" if s["closedNote"] else ""),
                    f"- **Cost:** {s['cost']} · **Booking:** {s['booking']} · **Stay:** {s['stay']} · **Best time:** {s['bestTime']}",
                    f"- **Station:** {s['station']} · **Address:** {s['address']}",
                    f"- **Tip:** {s['tip']}"]
            if s["weatherAlt"]:
                out.append(f"- **Weather:** {'indoor' if s['indoor'] else 'outdoor'} · {s['weatherAlt']}")
            if s["website"]:
                out.append(f"- **Official site:** {s['website']}")
            if s["tickets"]["url"]:
                out.append(f"- **Tickets:** {s['tickets']['url']} – {s['tickets']['note']}")
            out.append(f"- **Google Maps:** https://www.google.com/maps/search/?api=1&query={s['maps'].replace(' ', '+')}{warn}")
            out.append("- **Eat nearby:**")
            for f in [f for f in data["food"] if f["afterStop"] == s["id"]]:
                out.append(f"  - {f['emoji']} {f['name']} ({f['kind']}, ~{f['walkMinutes']} min walk) – {f['cost']}"
                           f"{' · cash only' if f['cashOnly'] else ''} · {f['hours']} · {f['kidFriendly']}")
            reach = sorted(((edge_of(s["id"], o["id"]), o) for o in pool
                            if o["id"] != s["id"] and frozenset((s["id"], o["id"])) in edges), key=lambda x: x[0]["minutes"])
            out.append("- **Next within 45 min:** " + "; ".join(f"{o['name']} {e['minutes']} min ({e['line']})" for e, o in reach))
            out.append("")
        b = d["budgetYen"]
        out += ["### Budget for the day (7-stop route)", "",
                "| | Adult | Age 12 | Age 10 | Total |", "|---|---:|---:|---:|---:|",
                f"| Attractions | {yen(b['attractions'][0])} | {yen(b['attractions'][1])} | {yen(b['attractions'][2])} | {yen(sum(b['attractions']))} |",
                f"| Food (budget) | {yen(b['food'][0])} | {yen(b['food'][1])} | {yen(b['food'][2])} | {yen(sum(b['food']))} |",
                f"| Transport (IC) | {yen(b['transport'][0])} | {yen(b['transport'][1])} | {yen(b['transport'][2])} | {yen(sum(b['transport']))} |",
                f"| **Total** | **{yen(b['adult'])}** | **{yen(b['age12'])}** | **{yen(b['age10'])}** | **{yen(b['total'])}** |",
                "", "Free: gardens/parks (kids), Fire Museum, shrines, free views, browsing shops. Expensive: SHIBUYA SKY, Skytree, Joypolis, Kirby Café. Extras (crane games, gashapon, souvenirs) are not included.", ""]
    total = sum(d["budgetYen"]["total"] for d in data["days"])
    out += [f"**Five-day total (7-stop routes, budget food, IC transport): ≈ {yen(total)} for three people**, before extras and the hotel.", ""]
    return "\n".join(out)


if __name__ == "__main__":
    data = build()
    # Suggested clock times for each route (leave the hotel at 9:00).
    by_id = {s["id"]: s for s in data["stops"]}
    emap = {frozenset((e["from"], e["to"])): e for e in data["edges"]}
    for d in data["days"]:
        d["routeTimes"] = {k: [f"{t // 60:02d}:{t % 60:02d}" for t, _ in
                               route_times(r, by_id, lambda a, b: emap[frozenset((a, b))])]
                           for k, r in d["routes"].items()}
    errs = validate(data)
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "tokyo-5day-2027.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "tokyo-5day-guide.md").write_text(guide(data))
    print(f"stops {len(data['stops'])} · food {len(data['food'])} · edges {len(data['edges'])}")
    for d in data["days"]:
        n = int(d["key"][1])
        pool = [s for s in data["stops"] if s["day"] == n]
        pairs = len(pool) * (len(pool) - 1) // 2
        de = [e for e in data["edges"] if e["from"].startswith(f"plan-d{n}-")]
        print(f"{d['key']}: pool {len(pool)} · edges {len(de)}/{pairs} pairs ≤45 · total ¥{d['budgetYen']['total']:,}")
    if errs:
        print("VALIDATION ERRORS:")
        print("\n".join(errs))
        sys.exit(1)
    print("VALIDATION OK")
