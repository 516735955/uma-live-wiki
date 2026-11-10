#!/usr/bin/env python3
"""Build data/events/venue_profiles.json from Eventernote place pages and
Wikipedia (DBpedia mirrors for Japanese and English Wikipedia).

The site's venue registry (data/events/venues.json) already normalizes names,
cities and some addresses. This script enriches the venues that actually have
events with capacity, address, coordinates, official site, access notes and a
Wikipedia link, then writes a stable JSON document that the catalog API merges
into /api/catalog/venues and /api/catalog/venue.

Sources:
  * Eventernote place pages (所在地 / 電話番号 / 公式サイト / 収容人数 / 会場TIPS)
  * Japanese Wikipedia via ja.dbpedia.org (abstract, 収容人数, 所在地, geo, homepage)
  * English Wikipedia via dbpedia.org for overseas venues

Usage:
  python uma_tools/fetch_venue_profiles.py            # uses the on-disk cache
  python uma_tools/fetch_venue_profiles.py --refresh  # ignores cached responses
  python uma_tools/fetch_venue_profiles.py --limit 5  # quick smoke run
"""

import argparse
import collections
import datetime
import hashlib
import html
import io
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
TOOL_DIR = Path(__file__).resolve().parent
CACHE_DIR = TOOL_DIR / "venue_cache"
OUTPUT = DATA_DIR / "events" / "venue_profiles.json"
USER_AGENT = "uma-live-wiki venue metadata (https://github.com/516735955/uma-live-wiki)"

REFRESH = False
REQUEST_DELAY = 0.35

BANNED_LABEL_WORDS = (
    "駅", "station", "line", "鉄道", "株式会社", "会社", "学校", "大学",
    "バス", "路線", "空港線", "インターチェンジ",
)
VENUE_HINT_WORDS = (
    "ホール", "アリーナ", "劇場", "会場", "競技場", "スタジアム", "ドーム",
    "展示", "センター", "メッセ", "パーク", "広場", "館", "座",
    "hall", "arena", "theatre", "theater", "stadium", "dome", "centre",
    "center", "expo", "convention", "auditorium", "cinema", "pavilion",
)

CITY_TOKENS = {
    "东京": ("東京", "東京都"),
    "横滨": ("横浜",),
    "大阪": ("大阪",),
    "名古屋": ("名古屋",),
    "福冈": ("福岡",),
    "札幌": ("札幌",),
    "神户": ("神戸",),
    "京都": ("京都",),
    "仙台": ("仙台",),
    "广岛": ("広島",),
    "那霸": ("那覇",),
    "台北": ("台北", "臺北"),
    "香港": ("香港", "Hong Kong"),
    "常滑": ("常滑",),
    "所泽": ("所沢",),
    "苫小牧": ("苫小牧",),
    "北广岛": ("北広島",),
    "川崎": ("川崎",),
    "千叶": ("千葉",),
    "埼玉": ("埼玉",),
    "浦安": ("浦安",),
    "静冈": ("静岡",),
    "冈山": ("岡山",),
    "高松": ("高松",),
    "德岛": ("徳島",),
    "松山": ("松山",),
    "熊本": ("熊本",),
    "鹿儿岛": ("鹿児島",),
    "金泽": ("金沢",),
    "福井": ("福井",),
    "冲绳": ("沖縄",),
    "首尔": ("ソウル", "Seoul"),
    "新加坡": ("シンガポール", "Singapore"),
    "曼谷": ("バンコク", "Bangkok"),
}


def http_get(url, timeout=40, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.read().decode("utf-8", "replace")
        except Exception as error:  # noqa: BLE001 - retry any transport failure
            last = error
            time.sleep(1.2 * (attempt + 1))
    raise last


def cache_path(kind, key):
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:20]
    return CACHE_DIR / kind / (digest + ".json")


def read_cache(kind, key):
    path = cache_path(kind, key)
    if REFRESH or not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_cache(kind, key, value):
    path = cache_path(kind, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def normalize(value):
    text = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return re.sub(r"[\s\u3000・･·\-‐‑–—―_/／()（）「」『』,，.。:：;；'\"!！?？]", "", text)


def strip_parentheticals(value):
    text = str(value or "").strip()
    previous = None
    while previous != text:
        previous = text
        text = re.sub(r"[（(][^（()）]*[）)]\s*$", "", text).strip()
    return text


def name_candidates(rows):
    primary = []
    derived = []
    seen = set()

    def add(target, value):
        for part in re.split(r"\s*/\s*", str(value or "")):
            part = part.strip().lstrip("!_").strip()
            for variant in (part, strip_parentheticals(part)):
                variant = variant.strip()
                key = normalize(variant)
                if len(key) < 3 or key in seen:
                    continue
                seen.add(key)
                target.append(variant)

    for row in rows:
        for field in ("name_ja", "display", "name_zh", "raw"):
            add(primary, row.get(field))
        for alias in row.get("aliases") or []:
            add(primary, alias)

    # Facility suffixes rarely appear in the Wikipedia article title. Keep the
    # shorter base as a lower-confidence candidate (幕張メッセ, 東京国際フォーラム…).
    suffix = re.compile(
        r"(?:イベントホール|国際展示場ホール|展示ホール|メインホール|メインアリーナ|大ホール|小ホール|"
        r"ホール|アリーナ|シアター|ステージ|展示場|会場|[0-9０-９]+号館|[A-Za-z]館)\s*$"
    )
    for name in list(primary):
        base = suffix.sub("", name).strip()
        if base != name and len(normalize(base)) >= 5:
            add(derived, base)
    for row in rows:
        for field in ("name_ja", "display", "name_zh"):
            value = str(row.get(field) or "").strip()
            base = suffix.sub("", strip_parentheticals(value)).strip()
            if base and base != value and len(normalize(base)) >= 5:
                add(derived, base)
    return primary, derived


def sparql(lang, query, cache_key):
    cached = read_cache("sparql", lang + ":" + cache_key)
    if cached is not None:
        return cached
    endpoint = "https://" + lang + ".dbpedia.org/sparql" if lang == "ja" else "https://dbpedia.org/sparql"
    url = endpoint + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    time.sleep(REQUEST_DELAY)
    try:
        payload = json.loads(http_get(url))
        rows = payload.get("results", {}).get("bindings", [])
    except Exception as error:  # noqa: BLE001 - a failed lookup is not fatal
        print("  ! sparql failed:", lang, cache_key, str(error)[:80])
        rows = []
    write_cache("sparql", lang + ":" + cache_key, rows)
    return rows


def ja_query(name):
    safe = re.sub(r"[\"'\\]", "", name)
    return (
        'SELECT ?s ?label ?abstract ?capacity ?address ?lat ?long ?homepage ?pageID WHERE {'
        ' ?s rdfs:label ?label .'
        ' ?label bif:contains "\'%s\'" .'
        ' FILTER(lang(?label) = "ja")'
        ' OPTIONAL { ?s <http://dbpedia.org/ontology/abstract> ?abstract . FILTER(lang(?abstract) = "ja") }'
        ' OPTIONAL { ?s <http://ja.dbpedia.org/property/収容人数> ?capacity }'
        ' OPTIONAL { ?s <http://ja.dbpedia.org/property/所在地> ?address }'
        ' OPTIONAL { ?s <http://www.w3.org/2003/01/geo/wgs84_pos#lat> ?lat }'
        ' OPTIONAL { ?s <http://www.w3.org/2003/01/geo/wgs84_pos#long> ?long }'
        ' OPTIONAL { ?s <http://dbpedia.org/ontology/wikiPageExternalLink> ?homepage }'
        ' OPTIONAL { ?s <http://dbpedia.org/ontology/wikiPageID> ?pageID }'
        '} LIMIT 30'
    ) % safe


def en_query(name):
    safe = re.sub(r"[\"'\\]", "", name)
    return (
        'SELECT ?s ?label ?abstract ?capacity ?address ?lat ?long ?homepage ?pageID WHERE {'
        ' ?s rdfs:label ?label .'
        ' ?label bif:contains "\'%s\'" .'
        ' FILTER(lang(?label) = "en")'
        ' OPTIONAL { ?s <http://dbpedia.org/ontology/abstract> ?abstract . FILTER(lang(?abstract) = "en") }'
        ' OPTIONAL { ?s <http://dbpedia.org/ontology/capacity> ?capacity }'
        ' OPTIONAL { ?s <http://dbpedia.org/ontology/address> ?address }'
        ' OPTIONAL { ?s <http://www.w3.org/2003/01/geo/wgs84_pos#lat> ?lat }'
        ' OPTIONAL { ?s <http://www.w3.org/2003/01/geo/wgs84_pos#long> ?long }'
        ' OPTIONAL { ?s <http://xmlns.com/foaf/0.1/homepage> ?homepage }'
        ' OPTIONAL { ?s <http://dbpedia.org/ontology/wikiPageID> ?pageID }'
        '} LIMIT 30'
    ) % safe


def collect_rows(raw_rows):
    """Collapse the flat SPARQL rows into one record per resource."""
    resources = {}
    for row in raw_rows:
        uri = row.get("s", {}).get("value", "")
        if not uri or "wikidata.dbpedia.org" in uri:
            continue
        record = resources.setdefault(uri, {
            "uri": uri,
            "label": row.get("label", {}).get("value", ""),
            "abstracts": [], "capacities": [], "addresses": [],
            "lat": "", "long": "", "homepages": [], "pageID": "",
        })
        if row.get("abstract"):
            record["abstracts"].append(row["abstract"]["value"])
        if row.get("capacity"):
            record["capacities"].append(row["capacity"]["value"])
        if row.get("address"):
            record["addresses"].append(row["address"]["value"])
        if row.get("lat"):
            record["lat"] = row["lat"]["value"]
        if row.get("long"):
            record["long"] = row["long"]["value"]
        if row.get("homepage"):
            record["homepages"].append(row["homepage"]["value"])
        if row.get("pageID"):
            record["pageID"] = row["pageID"]["value"]
    return list(resources.values())


def score_resource(record, candidate, city):
    label = record.get("label", "")
    norm_label = normalize(label)
    norm_candidate = normalize(candidate)
    if not norm_label or not norm_candidate:
        return -1
    score = 0.0
    if norm_label == norm_candidate:
        score = 100
    elif norm_candidate in norm_label or norm_label in norm_candidate:
        score = 52 + 24 * min(len(norm_label), len(norm_candidate)) / max(len(norm_label), len(norm_candidate))
    else:
        return -1
    lowered = label.casefold()
    if any(word in lowered for word in BANNED_LABEL_WORDS):
        score -= 45
    address = " ".join(record.get("addresses") or [])
    if address:
        score += 10
    if record.get("capacities"):
        score += 8
    abstract = " ".join(record.get("abstracts") or [])
    sample = (label + " " + abstract).casefold()
    if any(word in sample for word in VENUE_HINT_WORDS):
        score += 6
    tokens = CITY_TOKENS.get(str(city or "").strip(), ())
    if tokens and any(token.casefold() in (address + " " + abstract).casefold() for token in tokens):
        score += 12
    return score


def wiki_lookup(primary, derived, city):
    best = None
    best_score = 0.0
    for candidates, threshold in ((primary, 70), (derived, 88)):
        for candidate in candidates:
            for record in collect_rows(sparql("ja", ja_query(candidate), "ja:" + candidate)):
                score = score_resource(record, candidate, city)
                if score > best_score:
                    best, best_score = record, score
            if best_score >= 96:
                break
        if best and best_score >= threshold:
            return best
    return best if best_score >= 70 else None


def wiki_lookup_en(primary, derived, city):
    best = None
    best_score = 0.0
    for candidates, threshold in ((primary, 74), (derived, 90)):
        for candidate in candidates:
            if not re.search(r"[A-Za-z]", candidate):
                continue
            for record in collect_rows(sparql("en", en_query(candidate), "en:" + candidate)):
                score = score_resource(record, candidate, city)
                if score > best_score:
                    best, best_score = record, score
            if best_score >= 96:
                break
        if best and best_score >= threshold:
            return best
    return best if best_score >= 74 else None


def pick(values, prefer_numeric=False):
    values = [v for v in values if v not in (None, "")]
    if not values:
        return ""
    if prefer_numeric:
        for value in values:
            if re.fullmatch(r"\d+", str(value)):
                return value
    return values[0]


def capacity_details(value):
    text = unicodedata.normalize("NFKC", str(value or "")).strip()
    number = r"(\d[\d,]*)"
    screens = re.search(number + r"\s*(?:スクリーン|screens?\b)", text, re.I)
    if screens:
        details = {"screen_count": int(screens[1].replace(",", ""))}
        total = re.search(r"(?:合計|計|total(?: of)?\s*)" + number + r"\s*(?:席|seats?\b)", text, re.I)
        if total:
            details.update(capacity=int(total[1].replace(",", "")), capacity_unit="seats")
        return details

    count = re.search(r"(?P<qualifier>約\s*|about\s+|最大\s*)?(?P<count>\d[\d,]*)\s*(?P<unit>席|人|名|seats?\b|people\b)", text, re.I)
    if count:
        unit = "seats" if count["unit"] == "席" or count["unit"].lower().startswith("seat") else "people"
        details = {"capacity": int(count["count"].replace(",", "")), "capacity_unit": unit}
        if count["qualifier"]:
            details["capacity_maximum" if count["qualifier"].strip() == "最大" else "capacity_approximate"] = True
        return details
    if re.fullmatch(number, text):
        return {"capacity": int(text.replace(",", ""))}
    return {}


def wiki_profile(record, lang):
    if not record:
        return None
    uri = record["uri"]
    title = uri.rsplit("/", 1)[-1]
    if lang == "ja":
        wikipedia = "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
    else:
        wikipedia = "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
    capacity_value = pick(record.get("capacities") or [], prefer_numeric=True)
    return {
        "wikipedia": wikipedia,
        "title": title.replace("_", " "),
        **capacity_details(capacity_value),
        "capacity_text": str(capacity_value or ""),
        "address": pick(record.get("addresses") or []),
        "latitude": record.get("lat") or "",
        "longitude": record.get("long") or "",
        "homepage": pick(record.get("homepages") or []),
        "abstract": (record.get("abstracts") or [""])[0],
    }


def strip_tags(value):
    text = re.sub(r"<br\s*/?>", "\n", str(value or ""), flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def fetch_eventernote_place(place_url):
    cached = read_cache("eventernote", place_url)
    if cached is not None:
        return cached
    time.sleep(REQUEST_DELAY)
    try:
        page = http_get(place_url)
    except Exception as error:  # noqa: BLE001 - a missing place page is not fatal
        print("  ! eventernote failed:", place_url, str(error)[:80])
        page = ""
    data = {"url": place_url, "address": "", "phone": "", "website": "",
            "capacity_text": "", "seat_map_url": "", "access": ""}
    if page:
        table = re.search(r'<div class="gb_place_detail_table">(.*?)</div>', page, re.S)
        body = table.group(1) if table else ""
        rows = re.findall(r"<tr>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>\s*</tr>", body, re.S)
        for label, value in rows:
            label = strip_tags(label)
            text = strip_tags(value)
            links = re.findall(r'href="([^"]+)"', value)
            if label == "所在地":
                data["address"] = text
            elif label == "電話番号":
                data["phone"] = text
            elif label == "公式サイト":
                data["website"] = links[0] if links else text
            elif label == "収容人数":
                data["capacity_text"] = text
            elif label == "座席情報":
                data["seat_map_url"] = links[0] if links else ""
            elif label == "会場TIPS":
                data["access"] = text
    write_cache("eventernote", place_url, data)
    return data


def eventernote_urls(rows):
    urls = []
    for row in rows:
        for source in row.get("sources") or []:
            url = source.get("url") if isinstance(source, dict) else source
            if isinstance(url, str) and "eventernote.com/places/" in url and url not in urls:
                urls.append(url)
    return urls


def registry_address(rows):
    for row in rows:
        if row.get("address_ja"):
            return str(row["address_ja"]).strip()
    return ""


def profile_for(rows):
    primary, derived = name_candidates(rows)
    city = next((row.get("city") for row in rows if row.get("city")), "")
    ja = wiki_profile(wiki_lookup(primary, derived, city), "ja")
    en = None
    if not ja or not all(ja.get(key) for key in ("capacity", "address", "latitude")):
        en = wiki_profile(wiki_lookup_en(primary, derived, city), "en")
    if ja and en:
        for key in ("address", "latitude", "longitude", "homepage"):
            if not ja.get(key) and en.get(key):
                ja[key] = en[key]

    places = eventernote_urls(rows)
    place = fetch_eventernote_place(places[0]) if places else None

    address = (place or {}).get("address") or registry_address(rows) or (ja or en or {}).get("address", "")
    address_source = ""
    if address:
        address_source = "eventernote" if (place or {}).get("address") else (
            "venue_registry" if registry_address(rows) else "wikipedia")

    sources = []
    if places:
        sources.append({"kind": "eventernote_place", "url": places[0]})
    if ja:
        sources.append({"kind": "wikipedia_ja", "url": ja["wikipedia"]})
    if en:
        sources.append({"kind": "wikipedia_en", "url": en["wikipedia"]})

    capacity_text = ""
    capacity = {}
    for candidate, kind, url in (
        (place, "eventernote_place", places[0] if places else ""),
        (ja, "wikipedia_ja", (ja or {}).get("wikipedia")),
        (en, "wikipedia_en", (en or {}).get("wikipedia")),
    ):
        text = (candidate or {}).get("capacity_text", "")
        details = capacity_details(text)
        if details:
            capacity_text = text
            capacity = details
            if capacity.get("capacity"):
                capacity["capacity_source"] = {"kind": kind, "url": url}
            break

    profile = {
        "address": address,
        "address_source": address_source,
        **capacity,
        "capacity_text": capacity_text,
        "phone": (place or {}).get("phone", ""),
        "official_url": (place or {}).get("website", "") or (ja or en or {}).get("homepage", ""),
        "seat_map_url": (place or {}).get("seat_map_url", ""),
        "access": (place or {}).get("access", ""),
        "latitude": float((ja or en)["latitude"]) if (ja or en or {}).get("latitude") else None,
        "longitude": float((ja or en)["longitude"]) if (ja or en or {}).get("longitude") else None,
        "description_ja": (ja or {}).get("abstract", ""),
        "description_en": (en or {}).get("abstract", ""),
        "wikipedia_ja": (ja or {}).get("wikipedia", ""),
        "wikipedia_en": (en or {}).get("wikipedia", ""),
        "sources": sources,
        "updated": datetime.date.today().isoformat(),
    }
    # Drop empty fields so the committed JSON stays readable.
    return {key: value for key, value in profile.items() if value not in ("", None, [])}


def main():
    global REFRESH
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="ignore cached responses")
    parser.add_argument("--limit", type=int, default=0, help="only process the first N venues")
    args = parser.parse_args()
    REFRESH = args.refresh

    events = json.loads((DATA_DIR / "events_catalog.json").read_text(encoding="utf-8"))["events"]
    registry = json.loads((DATA_DIR / "events" / "venues.json").read_text(encoding="utf-8"))["venues"]

    by_id = collections.defaultdict(list)
    for row in registry:
        by_id[row["id"]].append(row)

    venue_ids = sorted({(event.get("venue_id") or "").strip() for event in events} - {""})
    if args.limit:
        venue_ids = venue_ids[: args.limit]

    previous = json.loads(OUTPUT.read_text(encoding="utf-8"))["profiles"] if OUTPUT.exists() else {}
    profiles = dict(previous) if args.limit else {}
    stats = collections.Counter()
    for index, venue_id in enumerate(venue_ids, 1):
        rows = by_id.get(venue_id) or []
        if not rows:
            continue
        profile = profile_for(rows)
        saved = previous.get(venue_id, {})
        if saved.get("capacity_source", {}).get("kind") == "official":
            for field in ("capacity", "capacity_text", "capacity_unit", "capacity_approximate", "capacity_maximum", "capacity_source", "screen_count"):
                profile.pop(field, None)
                if field in saved:
                    profile[field] = saved[field]
        profiles[venue_id] = profile
        if profile.get("capacity"):
            stats["capacity"] += 1
        if profile.get("address"):
            stats["address"] += 1
        if profile.get("wikipedia_ja") or profile.get("wikipedia_en"):
            stats["wikipedia"] += 1
        if profile.get("official_url"):
            stats["official_url"] += 1
        if profile.get("latitude"):
            stats["coordinates"] += 1
        print("[%3d/%3d] %-50s capacity=%-8s wiki=%s address=%s" % (
            index, len(venue_ids), venue_id[:50],
            profile.get("capacity_text") or "-",
            "ja" if profile.get("wikipedia_ja") else ("en" if profile.get("wikipedia_en") else "-"),
            "yes" if profile.get("address") else "-",
        ))

    document = {
        "schema_version": 1,
        "generated_at": datetime.date.today().isoformat(),
        "profiles": dict(sorted(profiles.items())),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("wrote", OUTPUT)
    print("coverage:", dict(stats), "of", len(profiles))


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    main()
