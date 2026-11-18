# Tokyo Kids Explorer

A mobile-first web app (installable PWA) that helps a family with kids find fun
things to do in Tokyo and get there by train, subway or bus.

- **Starting point:** tap or drag a pin on the map (Leaflet + OpenStreetMap),
  search a hotel, station or landmark (Google Places Autocomplete), or use your
  phone's location. Saved on the phone.
- **Activities:** live family-friendly places from Google Places (New), sorted
  by distance. Tap one to see address, rating, reviews, opening hours, an
  "Open now" badge, price level, distance and the official website. Filter by
  category and "Open now".
- **How to get there:** gets a transit route from the Google Routes API and asks
  Claude to write a short, simple family guide (steps, things to watch out for,
  IC cards / child fares, tips). Cached for 24 hours.
- **Navigate:** opens Google Maps with transit directions.

No data is entered by hand, and the API keys never reach the browser: every
Google and Claude call goes through Vercel serverless functions in `/api`.

## Project layout

| Path | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app (plain HTML/CSS/JS) |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA: install to home screen, offline shell |
| `vendor/leaflet/` | Leaflet 1.9.4 map library (BSD-2 licence) |
| `api/autocomplete.js` | Places Autocomplete (New) for the search box |
| `api/place.js` | Place Details (New): coordinates of the chosen suggestion |
| `api/activities.js` | Places Text Search (New): activities by category |
| `api/guide.js` | Routes API (transit) + Claude guide |
| `lib/` | Shared server code (not public routes) |
| `scripts/dev-server.js` | Run everything locally without the Vercel CLI |
| `tests/` | `npm test` – checks the API functions with fake Google/Claude replies |

## Keeping costs low

- **Field masks:** each Google call asks only for the fields the screen shows.
  Place Details asks only for location + address (cheapest tier).
- **Autocomplete sessions:** typing + picking a place is billed as one session,
  and the search waits until you stop typing (3+ letters).
- **Caching:** activity lists and route guides are cached for 24 hours in
  Vercel's CDN (shared by everyone) *and* on the phone. The start point is
  rounded (~1 km for activity lists, ~100 m for routes) so cache hits are likely.
- **"Open now" is computed on the phone** from weekly hours, so cached lists
  never show a stale badge.
- **Claude:** one short request per route per day (`claude-opus-5-5`, low effort, ~150-word answer).
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
7. **Set a safety limit (recommended):** menu ☰ → **APIs & Services** →
   **Enabled APIs** → tap **Places API (New)** → **Quotas & system limits**.
   Find the "requests per day" rows (e.g. Text Search, Autocomplete) → pencil
   icon → set e.g. **300 per day** → **Submit**. Do the same for **Routes API**
   (e.g. 200 per day). Also: menu ☰ → **Billing** → **Budgets & alerts** →
   **Create budget** → e.g. 10 USD with email alerts.

## (b) Create an Anthropic API key with a spending limit

1. Open **console.anthropic.com** (Claude Console) and sign up / sign in.
2. **Add credit:** **Settings** → **Billing** → buy a small amount of prepaid
   credit (e.g. 5 USD). Each route guide costs about one US cent, so this
   lasts a long time. When the credit runs out, calls simply stop – you can't
   be charged more than you loaded unless you turn on auto-reload (leave it **off**).
3. **Set a spend limit:** **Settings** → **Limits** (or **Billing → Spend
   limits**) → set a **monthly limit**, e.g. 5 USD → save.
4. **Create the key:** **Settings** → **API keys** → **Create key** → name it
   `tokyo-kids` → **Create**. Copy the key (starts with `sk-ant-…`) right away
   – it is shown only once. Keep it private.

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
- "Google found no public-transport route": Google has no transit data for that
  trip – use the **Navigate** button instead.
- To see server errors: Vercel project → **Logs**.
