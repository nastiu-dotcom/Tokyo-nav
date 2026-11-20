# Tokyo Kids Explorer

A mobile-first web app (installable PWA) that helps a family with kids find fun
things to do in Tokyo and get there by train, subway or bus.

- **Two modes** (switch at the top):
  - **🗓️ Trip plan** – build your days in advance. Each day has a date, a start
    (hotel) and places in order. The main page shows the day's plan and **how
    to get from each place to the next**. New days start at the same hotel.
    **🔗 Share trip** makes a link that opens the same plan on another phone
    (the plan travels inside the link – no accounts, no database).
  - **🧭 Adventure** – today's route, built as you go: start from your
    location, see what's nearby, tap **“Go here next”**, and the route grows
    stop by stop. **Save to trip plan** keeps it as a day.
- **Ready-made 3-day plan** (tap “📥 Use the ready-made 3-day plan” in Trip
  mode), budget-minded for kids 10–12, food stops included:
  1. *Old Tokyo & dinosaurs* – Senso-ji, melon bread, Museum of Nature and
     Science (kids free), Ameyoko lunch, Ueno Zoo, Akihabara, Yodobashi dinner.
  2. *Shrines, sushi trains & Pokémon* – Meiji Jingu, Takeshita crepes,
     Kiddy Land, Uobei sushi, Shibuya Crossing, Pokémon Center/Nintendo,
     free sunset deck at the Metropolitan Government Building, ramen.
  3. *Digital art & the bay* – teamLab Planets (book ahead), LaLaport food
     court, Yurikamome to Odaiba Seaside Park (or SMALL WORLDS), Tokyo
     Character Street, Tokyo Ramen Street.

  Each stop has a time, how long to stay, cost, a tip, and links to Google
  Maps, tickets and the official site. Each day shows a family budget and
  warns if a place is closed on the chosen date. The plan lives in
  `js/plan.js` (facts checked Nov 2026 – prices change, links go to official
  sites). A **🇯🇵 Family tips** card covers passes, IC cards, cash, cheap
  eats, manners and emergency numbers.
- **📥 April 1–5, 2027 five-day trip** (1 adult + kids 12 and 10, base Rainbow
  Palace Yoyogi) – tap “Load the April 2027 5-day trip” in Trip mode:
  Shinjuku/Harajuku/Shibuya · Skytree/Sumida/Ryogoku · Tokyo Dome/Kanda ·
  Toyosu/Odaiba · Ikebukuro (Monday-proof). 62 researched attractions,
  3–4 food options after each, 5- and 7-stop routes per day, and a
  **“next stop within 45 minutes”** chooser. Data: `data/tokyo-5day-2027.json`;
  readable guide: `docs/tokyo-5day-guide.md`; source + validation:
  `scripts/trip2027/` (`python3 scripts/trip2027/build.py`).
  Travel times are estimates from a rail-network model (walk + wait + ride +
  transfers); items marked ⚠️ need checking closer to the date.
- **🧾 Tax refund tab:** scan or upload each receipt, add a product photo,
  shop, date, amount and description. Records (with photos) are stored only on
  the phone (IndexedDB), with the estimated refund, the ¥5,000 per-shop-per-day
  check, the 90-day export deadline, a “Show at customs” screen, sharing, and
  a backup file you can save and restore.
- **🗺️ Map tab:** every saved place on one map (free OpenStreetMap, no key) –
  your plan (colour per day), more ideas and food from the 5-day pools, your
  own **Google Maps saved places** (import the Google Takeout .zip /
  “Saved Places.json” / list .csv – read on the phone, nothing uploaded) and
  **tax-refund shops**. Tap a pin → open in Google Maps or get directions.
  Places without coordinates can be found with `/api/find` (Google free tier).
- **💰 Running costs** (admins only: 👤 → 💰 Running costs): everything that can
  cost money, measured by the app itself on every API call and refreshed every
  30 seconds –
  - **Google Maps** per billing SKU against its free monthly calls (Text
    Search Enterprise 1,000 · Pro 5,000 · Essentials 10,000), the cost beyond
    them, and Google calls per day (chart + table);
  - **Claude**: guides, exact input/output tokens and $ (priced by the model
    that answered), cost per day, cost per guide;
  - **Upstash**: commands this month vs the free 500,000, storage by kind of
    data; **Vercel**: function runs per endpoint vs ~1M;
  - **who used what** (per person), and links to the real bills.

  **Spending controls** on the same page: AI guides on/off, a **monthly AI
  limit** (default $5 – guides stop when it's reached) and **Google: free
  allowance only** (default on – a feature stops when its free calls for the
  month are used, so Google can't charge you). Prices live in `lib/prices.js`
  (checked Nov 2026); counters in Upstash (`use:*`, kept ~13 months).
- **🧳 The whole trip** (top of the 🗓️ Trip tab): Thailand 19/3 → 1/4 and
  Japan 1/4 → 10/5/2027 on one bar, a countdown (then “Day N of 53”), what's
  next, and **🧳 The whole trip** – a timeline of ✈️ flights, 🏨 stays and
  📌 notes per country. Grown-ups add and edit them (price, currency, booking
  reference); everyone in the family sees the same timeline. It warns about
  **nights with no bed booked**, two stays on one night, and **Tokyo plan days
  dated while you're still in Thailand**. Trip name, budget (₪80,000) and
  country dates: **✏️ Dates & budget**. Kids see it without prices or
  booking numbers.
- **🔒 Family login:** the app, its data and every API need a login (name +
  password). First users: **nastia** (admin), **eden** and **Noam** (kids).
  **Kid accounts** open straight into the kids' view: the shared plan
  (read-only, no link needed), the map and the timeline – and suggest places. Admins open
  **👤 → 🛡️ Manage users** to add people, reset passwords, switch someone off
  or remove them. Everyone can change their own password in the 👤 menu.
  Passwords are stored only as scrypt hashes in your Upstash database; the
  login lasts 30 days on each phone; 8 wrong passwords lock that name for
  15 minutes. Setup: step (d) + step (e).
- **🇮🇱 Hebrew (default) + English:** the whole app – buttons, the 3-day plan,
  the April trip, arrival guide, checklist, tax refund and map – is in Hebrew,
  right-to-left. The **EN / עב** button at the top switches language.
  UI texts: `js/i18n-he.js`; trip content: `js/plan-he.js` and
  `scripts/trip2027/he_*.py`. `npm test` fails if a text has no Hebrew.
- **🎨 Pastel design, one colour per day:** arrival = lavender, Day 1 sakura
  pink, Day 2 sky blue, Day 3 mint, Day 4 peach, Day 5 lilac. Day chips, the
  day's header, timeline and map pins use that colour (`js/theme.js`).
- **👨‍👩‍👧 Share with the kids:** in Trip mode tap **“Share with the kids”** and
  send the link. On the kids' phones the plan and map open **read-only** (they
  type their name once). They can **suggest places** – search, “I'm here”, or
  long-press on the map. You see the suggestions (with a badge on 🗓️ Trip),
  pick a day and tap **✅ Add to day** or **✖ No**; the kids see the answer.
  Changes to your plan reach their phones automatically (checked every 90 s
  while the app is open, or tap 🔄). Needs the free Upstash Redis database –
  see step (d). Only hashed keys are stored; data expires 180 days after the
  last change.
- **Start points and places:** tap or drag a pin on the map (Leaflet +
  OpenStreetMap), search a hotel, station or landmark (Google Places
  Autocomplete), or use the phone's location. Everything is saved on the phone.
- **Activities:** live family-friendly places from Google Places (New), sorted
  by distance. Tap one to see address, rating, reviews, opening hours, an
  "Open now" badge, price level, distance and the official website. Filter by
  category (now including 🍜 Food) and "Open now".
- **How to get there:** asks the Google Routes API for a transit route and has
  Claude write a short, simple family guide (steps, things to watch out for,
  IC cards / child fares, tips). Cached for 24 hours.
  **Japan limitation:** Google does not give apps train/subway data for Japan
  (the transit request comes back empty in Tokyo). The app then falls back to
  real data it *can* get: a walking route for short trips (≤ 1.6 km), or the
  nearest stations at both ends (Places Nearby Search) for longer trips. The
  guide then says which stations to use, and the **Navigate** button
  (Google Maps app) gives the exact lines.
- **Navigate:** opens Google Maps with transit directions.

No data is entered by hand, and the API keys never reach the browser: every
Google and Claude call goes through Vercel serverless functions in `/api`.

## Project layout

| Path | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app (plain HTML/CSS/JS): modes, day plan, browsing |
| `js/` | Browser modules: helpers, route legs, map/search picker, share links |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA: install to home screen, offline shell |
| `vendor/leaflet/` | Leaflet 1.9.4 map library (BSD-2 licence) |
| `api/autocomplete.js` | Places Autocomplete (New) for the search box |
| `api/place.js` | Place Details (New): coordinates of the chosen suggestion |
| `api/activities.js` | Places Text Search (New): activities by category |
| `api/guide.js` | Routes API (transit → walk → nearest stations) + Claude guide |
| `middleware.js`, `login.html`, `admin.html` | Login gate for every page and API; login and user-management pages |
| `api/auth.js`, `api/admin.js`, `lib/users.js`, `lib/session.js` | Log in/out, change password; admin user management; signed session cookie |
| `api/timeline.js`, `js/timeline.js`, `js/timeline-core.js` | The whole trip: countries, flights, stays, notes, checks |
| `api/family.js` | Family sharing: create, read plan + wishlist, kids suggest, parent approves |
| `lib/` | Shared server code (not public routes); `lib/kv.js` talks to Upstash Redis |
| `js/i18n.js`, `js/i18n-he.js` | Language switch and Hebrew texts |
| `js/theme.js`, `js/family.js` | Day colours; family sharing on the phone |
| `scripts/dev-server.js` | Run everything locally without the Vercel CLI |
| `tests/` | `npm test` – checks the API functions with fake Google/Claude replies |

## Budget: what is free and what is paid

| Action in the app | Who | Cost |
|---|---|---|
| Map, pin, "Use my location", Navigate button | OpenStreetMap / Google Maps link | Free, no key |
| Search box, activity lists, "How to get there" (route + built-in tips) | Google | Free within Google's monthly free usage – cap it with quotas (step a-7) so it can never become paid |
| Family sharing (kids' link, suggestions) | Upstash Redis via Vercel | Free plan – a family uses a tiny part of it. No card needed. |
| **✨ AI family guide** | Claude (Anthropic) | **Paid, about 1 US cent per guide.** The app asks *"This is a PAID step… Continue?"* every time. Re-opening a saved guide (24 h) is free. |

- No Anthropic key at all → the AI button is hidden and the app is 100% free.
- Have a key but want to pause AI → in Vercel add the environment variable
  `AI_GUIDES` = `off` and redeploy.

## Keeping costs low

- **Field masks:** each Google call asks only for the fields the screen shows.
  Place Details asks only for location + address (cheapest tier).
- **Autocomplete sessions:** typing + picking a place is billed as one session,
  and the search waits until you stop typing (3+ letters).
- **Caching:** activity lists and route guides are cached for 24 hours in
  Vercel's CDN (shared by everyone) *and* on the phone. The start point is
  rounded (~1 km for activity lists, ~100 m for routes) so cache hits are likely.
- **Adding a stop doesn't search again:** the list is re-sorted from the new
  stop for free; a new Google search only happens when you tap
  “Find places near here”.
- **Stations are looked up once per place**, shared by the leg that arrives
  there and the leg that leaves.
- **"Open now" is computed on the phone** from weekly hours, so cached lists
  never show a stale badge.
- **Claude:** only after you confirm; one short request per trip per day (`claude-opus-5-5`, low effort, ~150-word answer).
- **Tokyo only:** the server refuses points outside greater Tokyo, so your keys
  can't be used as a free worldwide proxy.

## Run locally (optional, on a computer)

```bash
npm install
GOOGLE_MAPS_API_KEY=... ANTHROPIC_API_KEY=... npm run dev   # http://localhost:3000
npm test
```

---

# Setup guide (for beginners, on a phone)

You need three accounts: **Google Cloud**, **Anthropic** and **Vercel** (plus
your GitHub account, where this code lives). Everything below works in a phone
browser (Chrome or Safari). Tip: if a page looks cramped, use the browser menu
→ **"Desktop site"**.

## (a) Create and restrict the Google API key

1. Open **console.cloud.google.com** and sign in with your Google account.
   Accept the terms if asked.
2. **Create a project:** tap the project picker at the top (it may say
   "Select a project") → **New project** → name it `tokyo-kids` → **Create**.
   Make sure the new project is selected at the top.
3. **Turn on billing** (Google requires a card even for the free usage): menu ☰
   → **Billing** → link a billing account / add a card. Every month Google gives
   a free number of calls per API; a family trip stays far below it.
4. **Enable the two APIs:** menu ☰ → **APIs & Services** → **Library**.
   - Search **"Places API (New)"** → open it → **Enable**.
     (Pick the one that says **(New)**, not the old "Places API".)
   - Go back, search **"Routes API"** → open it → **Enable**.
5. **Create the key:** menu ☰ → **APIs & Services** → **Credentials** →
   **+ Create credentials** → **API key**. Copy the key (long text starting
   with `AIza…`) and keep it somewhere private for step (c).
6. **Restrict the key:** on the Credentials page tap the key's name (or "Edit
   API key").
   - **Name:** `tokyo-kids-server`.
   - **Application restrictions:** leave **None**. (The key is only used by
     Vercel's servers, whose addresses change, so website/IP restrictions
     would break it. It never appears in the web page.)
   - **API restrictions:** choose **Restrict key** → tick **Places API (New)**
     and **Routes API** only → **OK** → **Save**.
7. **Cap Google so it stays free (important):** Google charges automatically
   once a monthly free amount is used up. A *quota* is a hard limit: when
   reached, Google refuses calls instead of charging. Menu ☰ → **APIs &
   Services** → **Enabled APIs & services** → tap the API → **Quotas & system
   limits** → tick a row → pencil ✏️ → enter the number → **Submit**.

   | API → quota row (names can vary slightly) | Free per month* | Set to (per day) |
   |---|---|---|
   | Places API (New) → **Text Search** requests | 1,000 (fields used are "Enterprise") | **30** |
   | Places API (New) → **Nearby Search** requests | 5,000 ("Pro") | **150** |
   | Places API (New) → **Autocomplete** requests | 10,000 | **300** |
   | Places API (New) → **Place Details** (Get Place) requests | 10,000 ("Essentials") | **300** |
   | Routes API → **Compute Routes** requests | 10,000 ("Essentials") | **300** |

   30 days × the daily cap stays under each free amount. If a row only offers
   **per minute**, set it low (e.g. 2–5 per minute) and rely on the alert below.
   *Free amounts per Google's pricing page (Maps Platform, "free usage caps");
   check it once, as Google changes them occasionally.

   Then add an early warning: menu ☰ → **Billing** → **Budgets & alerts** →
   **Create budget** → amount **1 USD** → alerts at 50 % / 100 % → email.
   (A budget only warns; the quotas are what actually stop charges.)

## (b) Create an Anthropic API key with a spending limit (optional, paid)

The Claude API has **no free tier** – it is only used for the optional
✨ AI guide button. Skip this whole step to keep the app 100 % free.

1. Open **console.anthropic.com** (Claude Console) and sign up / sign in.
2. **Add credit:** **Settings** → **Billing** → buy the smallest prepaid
   amount (about 5 USD). Each AI guide costs about one US cent. Keep
   **auto-reload OFF** – then you can never be charged more than you loaded;
   when the credit is used up, the AI button just shows an error.
3. **Set a spend limit:** **Settings** → **Limits** (or **Billing → Spend
   limits**) → set a **monthly limit**, e.g. 5 USD → save.
4. **Create the key:** **Settings** → **API keys** → **Create key** → name it
   `tokyo-kids`.
   - **If it asks where the code runs / how you'll use the key:** choose the
     **server / backend / cloud** option (the code runs on Vercel's servers,
     not on your phone or computer). If it asks for a language or SDK: **TypeScript / JavaScript (Node.js)**.
     If it asks for allowed IP addresses, leave it empty (Vercel's addresses change).
   - **Create** → copy the key (starts with `sk-ant-…`) right away – it is
     shown only once. Paste it only into Vercel (step c), never into a chat.

## (c) Deploy on Vercel and add both keys

1. Open **vercel.com** → **Sign up** → **Continue with GitHub** and allow access.
2. Tap **Add New…** → **Project** → find the **Tokyo-nav** repository →
   **Import**. (If you don't see it: **Adjust GitHub App permissions** and
   give Vercel access to the repo.)
3. On the "Configure project" screen:
   - **Framework preset:** **Other**. Leave build/output settings empty.
   - Open **Environment Variables** and add two:
     - Name `GOOGLE_MAPS_API_KEY` → value: your `AIza…` key → **Add**
     - Name `ANTHROPIC_API_KEY` → value: your `sk-ant-…` key → **Add**
       (optional – leave it out to keep the app 100 % free)
   - Tap **Deploy** and wait about a minute.
4. Tap **Continue to Dashboard** → **Visit**. Your app lives at an address like
   `https://tokyo-nav-xxxx.vercel.app`.
5. **Deploying a branch / pull request:** Vercel also builds a *Preview* for
   each pull request (link appears as a comment on the PR). Production uses the
   `main` branch, so merge the pull request to update the main address.
6. **If you add or change a key later:** Project → **Settings** →
   **Environment Variables** → edit → then **Deployments** → newest one →
   **⋯** → **Redeploy** (keys are only read on deploy).
7. **Install on the phone:** open the app address →
   - iPhone (Safari): Share button → **Add to Home Screen**.
   - Android (Chrome): menu ⋮ → **Install app** / **Add to Home screen**.

## (d) Turn on family sharing (free Upstash Redis)

Only needed for **👨‍👩‍👧 Share with the kids**. Everything else works without it.

1. Open **vercel.com** → your **Tokyo-nav** project → tab **Storage**.
2. Tap **Create Database** (or **Browse Marketplace**) → choose
   **Upstash** → **Upstash for Redis** → **Continue**.
3. Pick the **Free** plan, region **Tokyo (ap-northeast-1)** if offered
   (any region works), give it a name like `tokyo-family` → **Create**.
   If it asks for a card, stop – the free plan shouldn't need one.
4. On the next screen **Connect** it to the **Tokyo-nav** project (all
   environments). Vercel adds the variables `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` for you – don't copy them anywhere.
5. **Deployments** → newest → **⋯** → **Redeploy**.
6. In the app: 🗓️ Trip → **👨‍👩‍👧 Share with the kids** → send the link to
   each kid (WhatsApp/Messages). They open it in the phone's browser and can
   **Add to Home Screen** too.

If the app says *“Family sharing is not set up yet”*, the database isn't
connected to the project or you didn't redeploy. The kid link is like a
password – anyone with it can see the plan and suggest places. To stop
sharing, tap **⚙️ Family settings → Stop sharing on this phone** (the data is
deleted automatically after 180 days without changes).

## (e) Turn on the family login

The app is locked to logged-in family members. It needs step (d) (the free
Upstash database) and one more setting – the first password:

1. Vercel → **Tokyo-nav** → **Settings** → **Environment Variables**.
2. Add Name `INITIAL_PASSWORD`, value: the first family password (at least
   8 characters) → **Save**. It is never written into the code or GitHub.
3. **Deployments** → newest → **⋯** → **Redeploy**.
4. Open the app → log in as **nastia** with that password. This first login
   creates three users: **nastia** (admin), **eden** and **Noam** (kids), all
   with that password. Names are not case-sensitive.
5. Each person: **👤 → 🔑 Change my password** – best to give everyone their
   own. Admin: **👤 → 🛡️ Manage users** to add users (e.g. grandparents),
   reset a forgotten password, switch someone off or remove them.

`INITIAL_PASSWORD` is used only once, while there are no users yet; changing
it later does nothing (use Manage users instead). Lost the only admin
password? In the Upstash console delete the key `auth:users` and log in again
with `INITIAL_PASSWORD` (this recreates the three users; trip data is kept).

### If something doesn't work

- "Login is not set up yet…": do step (d) and (e), then Redeploy.
- "Server is missing GOOGLE_MAPS_API_KEY / ANTHROPIC_API_KEY": the variable
  name is misspelled, or you didn't redeploy after adding it.
- "This API key is not authorized…" / "API has not been used in project": the
  API isn't enabled, or isn't ticked under **API restrictions** (step a-4 / a-6).
  Changes can take a few minutes.
- The guide names stations but no train lines: expected in Japan (see the
  limitation above) – tap **Navigate** for the exact lines.
- To see server errors: Vercel project → **Logs**.

### Keep your keys secret

Only put keys in Vercel's **Environment Variables** – never in the code, in
GitHub, or in chat messages/screenshots. If a key was ever shared somewhere,
make a new one (Google: Credentials → the key → **Regenerate key**; Anthropic:
API keys → delete and create a new one) and update it in Vercel.
