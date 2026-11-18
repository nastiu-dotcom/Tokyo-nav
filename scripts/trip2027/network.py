"""Rail network model used to estimate door-to-door journey times.

Ride times between neighbouring stations are typical timetable values (minutes)
for the lines families actually use. Journey time =
  walk to station + 4 min (gates, platform, wait) + ride
  + 5 min per change of line + walk from station.
A walking route is used instead when it is quicker (walking estimate =
straight-line distance x 1.3 street-detour factor at 75 m/min, a relaxed
pace with kids). These are ESTIMATES, not timetable lookups: the app shows the
live Google route / Google Maps link for every leg.
"""
import heapq
import math

WAIT = 4        # gates + platform + typical wait
TRANSFER = 5    # per change of line
WALK_M_PER_MIN = 75
DETOUR = 1.3

# (station A, station B, minutes, line)
LINKS = [
    # Odakyu / JR Yamanote / JR Chuo-Sobu local
    ("Minami-Shinjuku", "Shinjuku", 2, "Odakyu Line"),
    ("Shibuya", "Harajuku", 2, "JR Yamanote Line"),
    ("Harajuku", "Yoyogi", 2, "JR Yamanote Line"),
    ("Yoyogi", "Shinjuku", 2, "JR Yamanote Line"),
    ("Shinjuku", "Ikebukuro", 9, "JR Yamanote Line"),
    ("Akihabara", "Kanda", 2, "JR Yamanote Line"),
    ("Shinjuku", "Yoyogi", 2, "JR Chuo-Sobu Line"),
    ("Yoyogi", "Sendagaya", 2, "JR Chuo-Sobu Line"),
    ("Sendagaya", "Shinanomachi", 2, "JR Chuo-Sobu Line"),
    ("Shinanomachi", "Yotsuya", 2, "JR Chuo-Sobu Line"),
    ("Yotsuya", "Ichigaya", 2, "JR Chuo-Sobu Line"),
    ("Ichigaya", "Iidabashi", 2, "JR Chuo-Sobu Line"),
    ("Iidabashi", "Suidobashi", 2, "JR Chuo-Sobu Line"),
    ("Suidobashi", "Ochanomizu", 2, "JR Chuo-Sobu Line"),
    ("Ochanomizu", "Akihabara", 2, "JR Chuo-Sobu Line"),
    ("Akihabara", "Asakusabashi", 2, "JR Chuo-Sobu Line"),
    ("Asakusabashi", "Ryogoku", 2, "JR Chuo-Sobu Line"),
    ("Ryogoku", "Kinshicho", 3, "JR Chuo-Sobu Line"),
    # Tokyo Metro
    ("Shinjuku", "Shinjuku-sanchome", 2, "Marunouchi Line"),
    ("Shinjuku-sanchome", "Shinjuku-gyoemmae", 1, "Marunouchi Line"),
    ("Shinjuku-gyoemmae", "Yotsuya-sanchome", 2, "Marunouchi Line"),
    ("Yotsuya-sanchome", "Yotsuya", 2, "Marunouchi Line"),
    ("Ochanomizu", "Hongo-sanchome", 2, "Marunouchi Line"),
    ("Hongo-sanchome", "Korakuen", 2, "Marunouchi Line"),
    ("Shibuya", "Meiji-jingumae", 2, "Fukutoshin Line"),
    ("Meiji-jingumae", "Kita-sando", 2, "Fukutoshin Line"),
    ("Kita-sando", "Shinjuku-sanchome", 2, "Fukutoshin Line"),
    ("Shinjuku-sanchome", "Ikebukuro", 9, "Fukutoshin Line"),
    ("Shibuya", "Omotesando", 2, "Ginza Line"),
    ("Omotesando", "Gaienmae", 2, "Ginza Line"),
    ("Kanda", "Suehirocho", 3, "Ginza Line"),
    ("Meiji-jingumae", "Omotesando", 2, "Chiyoda Line"),
    ("Oshiage", "Kinshicho", 2, "Hanzomon Line"),
    ("Kinshicho", "Jimbocho", 14, "Hanzomon Line"),
    ("Jimbocho", "Kudanshita", 2, "Hanzomon Line"),
    ("Kudanshita", "Takebashi", 2, "Tozai Line"),
    ("Kudanshita", "Iidabashi", 2, "Tozai Line"),
    ("Ikebukuro", "Higashi-Ikebukuro", 2, "Yurakucho Line"),
    ("Iidabashi", "Toyosu", 17, "Yurakucho Line"),
    ("Ichigaya", "Iidabashi", 2, "Yurakucho Line"),
    # Toei
    ("Suidobashi", "Jimbocho", 2, "Toei Mita Line"),
    ("Kasuga", "Suidobashi", 2, "Toei Mita Line"),
    ("Asakusa", "Honjo-azumabashi", 2, "Toei Asakusa Line"),
    ("Honjo-azumabashi", "Oshiage", 2, "Toei Asakusa Line"),
    ("Kuramae", "Asakusa", 2, "Toei Asakusa Line"),
    ("Kuramae", "Ryogoku", 3, "Toei Oedo Line"),
    ("Kasuga", "Iidabashi", 2, "Toei Oedo Line"),
    ("Kasuga", "Hongo-sanchome", 2, "Toei Oedo Line"),
    ("Yoyogi", "Kokuritsu-kyogijo", 2, "Toei Oedo Line"),
    ("Shinjuku", "Iidabashi", 12, "Toei Oedo Line"),
    # Private / other
    ("Tokyo Skytree", "Asakusa", 3, "Tobu Skytree Line"),
    ("Asakusa-TX", "Akihabara", 4, "Tsukuba Express"),
    ("Shinjuku", "Tokyo Teleport", 25, "Saikyo/Rinkai Line"),
    ("Tokyo Teleport", "Kokusai-tenjijo", 2, "Rinkai Line"),
    ("Toyosu", "Shin-Toyosu", 2, "Yurikamome"),
    ("Shin-Toyosu", "Shijo-mae", 2, "Yurikamome"),
    ("Shijo-mae", "Ariake-tennis-no-mori", 2, "Yurikamome"),
    ("Ariake-tennis-no-mori", "Ariake", 2, "Yurikamome"),
    ("Ariake", "Tokyo Big Sight", 2, "Yurikamome"),
    ("Tokyo Big Sight", "Aomi", 2, "Yurikamome"),
    ("Aomi", "Telecom Center", 2, "Yurikamome"),
    ("Telecom Center", "Tokyo International Cruise Terminal", 2, "Yurikamome"),
    ("Tokyo International Cruise Terminal", "Daiba", 2, "Yurikamome"),
    ("Daiba", "Odaiba-kaihinkoen", 2, "Yurikamome"),
    ("Odaiba-kaihinkoen", "Shibaura-futo", 4, "Yurikamome"),
]

# Stations close enough to walk between inside the network (minutes).
WALK_LINKS = [
    ("Oshiage", "Tokyo Skytree", 5),
    ("Asakusa", "Asakusa-TX", 6),
    ("Akihabara", "Suehirocho", 5),
    ("Harajuku", "Meiji-jingumae", 2),
    ("Shinjuku", "Shinjuku-sanchome", 7),
    ("Ochanomizu", "Akihabara", 12),
    ("Daiba", "Tokyo Teleport", 6),
    ("Kokusai-tenjijo", "Tokyo Big Sight", 4),
    ("Ariake", "Kokusai-tenjijo", 5),
]


def _graph():
    g = {}
    for a, b, m, line in LINKS:
        g.setdefault(a, []).append((b, m, line))
        g.setdefault(b, []).append((a, m, line))
    for a, b, m in WALK_LINKS:
        g.setdefault(a, []).append((b, m, "walk"))
        g.setdefault(b, []).append((a, m, "walk"))
    return g


GRAPH = _graph()


def rail(a, b):
    """Shortest station-to-station time incl. transfers. Returns (min, lines)."""
    if a == b:
        return 0, []
    # state: (cost, station, current line, path lines)
    pq = [(0, a, None, ())]
    best = {}
    while pq:
        cost, st, line, path = heapq.heappop(pq)
        if st == b:
            return cost, list(path)
        key = (st, line)
        if key in best and best[key] <= cost:
            continue
        best[key] = cost
        for nb, m, ln in GRAPH.get(st, []):
            extra = 0
            if ln != "walk" and line not in (None, "walk") and ln != line:
                extra = TRANSFER
            newpath = path if (path and path[-1] == ln) else path + (ln,)
            heapq.heappush(pq, (cost + m + extra, nb, ln, newpath))
    raise KeyError(f"no rail path {a} -> {b}")


def haversine_km(a, b):
    r = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def walk_minutes(a, b):
    return max(1, round(haversine_km(a, b) * 1000 * DETOUR / WALK_M_PER_MIN))


def journey(p, q):
    """Door-to-door estimate between two places with station/walk data.

    p, q: dicts with lat, lng, node (station), walk (minutes to station).
    Returns dict(minutes, mode, line, walkMinutes).
    """
    direct = walk_minutes((p["lat"], p["lng"]), (q["lat"], q["lng"]))
    best = {"minutes": direct, "mode": "walk", "line": "On foot", "walkMinutes": direct}
    if p["node"] == q["node"]:
        return best
    ride, lines = rail(p["node"], q["node"])
    rail_lines = [l for l in lines if l != "walk"]
    total = p["walk"] + WAIT + ride + q["walk"]
    if rail_lines and total < direct:
        subway = {"Marunouchi Line", "Fukutoshin Line", "Ginza Line", "Chiyoda Line", "Hanzomon Line",
                  "Tozai Line", "Yurakucho Line", "Toei Mita Line", "Toei Asakusa Line", "Toei Oedo Line"}
        mode = "subway" if any(l in subway for l in rail_lines) else "train"
        best = {"minutes": total, "mode": mode, "line": " → ".join(rail_lines),
                "walkMinutes": p["walk"] + q["walk"]}
    return best
