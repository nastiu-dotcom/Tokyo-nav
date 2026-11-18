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
- **Start points and places:** tap or drag a pin on the map (Leaflet +
  OpenStreetMap), search a hotel, station or landmark (Google Places
  Autocomplete), or use the phone's location. Everything is saved on the phone.
- **Activities:** live family-friendly places from Google Places (New), sorted
  by distance. Tap one to see address, rating, reviews, opening hours, an
  "Open now" badge, price level, distance and the official website. Filter by
  category and "Open now".
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
| `lib/` | Shared server code (not public routes) |
| `scripts/dev-server.js` | Run everything locally without the Vercel CLI |
| `tests/` | `npm test` – checks the API functions with fake Google/Claude replies |

## Budget: what is free and what is paid

| Action in the app | Who | Cost |
|---|---|---|
| Map, pin, "Use my location", Navigate button | OpenStreetMap / Google Maps link | Free, no key |
| Search box, activity lists, "How to get there" (route + built-in tips) | Google | Free within Google's monthly free usage – cap it with quotas (step a-7) so it can never become paid |
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

### If something doesn't work

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
