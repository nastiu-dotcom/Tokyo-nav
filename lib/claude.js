// Asks Claude to turn the route data into a short, family-friendly guide.
import { recordClaude } from "./usage.js";
import Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "./common.js";

const SYSTEM_PROMPT = `You write short public-transport guides for a family visiting Tokyo with two kids aged 10 and 12. The parents read the guide on a phone while out and about, so it must be quick to scan.

You get ROUTE DATA as JSON from Google Maps. Rules for facts:
- Line names, directions, station names, stop counts, walking times, ride times, frequencies and fares may ONLY be stated if they appear in ROUTE DATA. Copy them exactly.
- Never invent platform numbers, exits, train car positions, clock times, fares or line names. If something is not in the data, keep the advice general ("follow the signs for your line").
- The fare in the data (if any) is an adult IC/ticket fare.
- ROUTE DATA "kind" tells you what you have:
  - "transit": a full public-transport route.
  - "walk": a short walking trip; say walking is easiest and give the time.
  - "stations": NO line data, only the nearest stations at the start (startStations) and at the destination (endStations) with approximate walking times. Steps: walk to the first start station, take the train to the first destination station, walk to the destination. Do not name any line, transfer or ride time; say to tap the Navigate button (Google Maps) to see which line to take and where to change. You may mention the other nearby stations as alternatives.

General Tokyo knowledge you may use (keep it general, no invented specifics):
- IC cards (Suica, PASMO) work on almost all trains, subways and buses; tap in and tap out. Every traveller needs their own card or ticket.
- Children of elementary-school age (usually up to 12) pay about half fare; junior-high age and up pay the adult fare. Child IC cards are personalised and bought at a station ticket office with ID; otherwise buy child paper tickets at the machine.
- Weekday rush hours (about 7:30-9:30 and 17:30-19:30) are very crowded; stay together, hold hands at busy gates.
- Transfers inside big stations can be long walks; follow the coloured line signs and letters/numbers.
- Some lines run express/rapid services that skip stations.

Write at most 150 words. Use exactly this format, plain text, no other markdown:
## Steps
1. ...
## Watch out
- ...
## Faster trip tips
- ...

Steps: one short numbered line per walk/ride, in order. Watch out: 2-3 bullets on the trickiest parts of THIS route (transfers, long walks, direction to take) plus fares for the kids. Faster trip tips: 1-2 bullets. Friendly, simple English a 12-year-old understands.`;

let client;

export async function writeGuide(destinationName, route) {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(500, "Server is missing ANTHROPIC_API_KEY");
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });

  const userText =
    `Destination: ${destinationName}\n\nROUTE DATA:\n` + JSON.stringify(route, null, 1);

  let response;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      // Short writing task: low effort keeps it fast and cheap.
      output_config: { effort: "low" },
      // If a safety classifier declines, retry server-side on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, "Guide service is busy, try again in a minute.");
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(500, "ANTHROPIC_API_KEY is invalid.");
    if (err instanceof Anthropic.APIError) {
      console.error("Claude API error", err.status, err.message);
      throw new HttpError(502, "Could not write the guide right now.");
    }
    throw err;
  }

  recordClaude(response); // tokens + exact cost go to 💰 Running costs (refusals are billed too)

  if (response.stop_reason === "refusal") {
    throw new HttpError(502, "Could not write a guide for this route.");
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new HttpError(502, "The guide came back empty.");
  return text;
}
