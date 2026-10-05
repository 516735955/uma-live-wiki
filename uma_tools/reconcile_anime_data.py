"""Reconcile official work credits without manufacturing episode credits."""

import argparse
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from collect_anime_official import fetch
from build_anime_catalog import atomic_json
from anime_labels import person_label
from character_scope import selected_characters, excluded_signature

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/anime"


def read(name, key):
    return json.loads((DATA / name).read_text(encoding="utf-8"))[key]


def norm(value):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).translate(str.maketrans("髙﨑𠮷", "高崎吉"))


def decode_credit_gaiji(value):
    # The source's legacy Shift-JIS decoder shifts NEC/IBM extension rows
    # ED/EE to F2/F3 private-use rows. Reverse only these two known rows.
    output = []
    for character in value:
        if "\ue000" <= character <= "\uf8ff":
            encoded = character.encode("cp932")
            if len(encoded) != 2 or encoded[0] not in (0xF2, 0xF3):
                raise ValueError("unresolved credit character")
            character = (int.from_bytes(encoded, "big") - 0x500).to_bytes(2, "big").decode("cp932")
        output.append(character)
    return "".join(output)


def public_voice_photo(voice):
    """Use the portrait element on the actor's verified profile page."""
    url = voice.get("profile", {}).get("official_profile") or ""
    if voice["identity"]["ja"] == "富田美憂":
        url = "https://columbia.jp/artist-info/tomitamiyu/prof.html"
    elif voice["identity"]["ja"] == "浪川大輔":
        url = "https://stay-luck.com/talent/namikawa-daisuke/"
        voice["profile"]["official_profile"] = url
    elif voice["identity"]["ja"] == "くじら":
        url = "https://seigura.com/directory/484/"
    portraits = {
        "浪川大輔": "https://stay-luck.com/files/namikawa.png",
        "くじら": "https://seigura.com/wp-content/uploads/2024/05/974f1b7dac7a5f94229858dc92cb3cd1.jpg",
        "大塚芳忠": "https://crazy-box.co.jp/wp/wp-content/uploads/2025/01/大塚芳忠＿HP用タテ-scaled.jpg",
    }
    if voice["identity"]["ja"] in portraits:
        return {"url": portraits[voice["identity"]["ja"]], "source_url": url, "source_title": "人物照片"}
    if not url:
        return None
    soup = BeautifulSoup(fetch(url), "html.parser")
    name = norm(voice["identity"]["ja"])
    candidates = [image for image in soup.select("img") if norm(image.get("alt", "")).removeprefix("写真:") == name or norm(image.get("alt", "")).startswith(name + "肖像写真")]
    selectors = {
        "www.aoni.co.jp": 'img[alt="pic"]',
        "www.imenterprise.jp": 'img[src*="/files/img/"]',
        "www.vims.co.jp": 'img.wp-post-image:not(.lazyload)',
        "haikyo.co.jp": 'img[src^="/photo/"]:not([src*="/photo/s"])',
        "aptepro.jp": 'img.wp-post-image',
        "stay-luck.com": 'img[src$="/namikawa.png"]',
        "crazy-box.co.jp": 'img[src*="/uploads/"]',
    }
    for host, selector in selectors.items():
        if url.startswith("https://" + host + "/"):
            candidates = soup.select(selector)
    if not candidates:
        return None
    image = candidates[0]
    src = image.get("data-src") or image.get("src") or ""
    if not src or src.startswith("data:"):
        return None
    return {"url": urljoin(url, src), "source_url": url, "source_title": "官方人物照片"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    characters = json.loads((ROOT / "data/character_index_data.js").read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))
    voices = json.loads((ROOT / "data/voice_actor_profiles.json").read_text(encoding="utf-8"))["voice_actors"]
    voice_names = {norm(name): voice for voice in voices for name in [voice["identity"]["ja"], voice["identity"]["zh"], *voice["identity"].get("aliases", [])]}
    people, staff, relations = read("people.json", "people"), read("staff.json", "credits"), read("relations.json", "relations")
    decoded = 0
    for credit in staff:
        raw = credit.get("name", "")
        name = decode_credit_gaiji(raw)
        if name == raw:
            continue
        credit["credited_name"] = raw
        credit["name"] = name
        if not credit.get("organization"):
            person = next((p for p in people if norm(p["name"]) == norm(name)), None)
            if person is None:
                person = {"id": "staff-" + person_label(name), "name": person_label(name), "aliases": [], "source_refs": [credit["source_ref"]]}
                people.append(person)
            credit["person_id"] = person["id"]
        decoded += 1
    # Collapse spelling differences caused solely by whitespace. Historical
    # routes resolve through alias_ids; per-credit signatures are unchanged.
    canonical_people = {}
    merged_people = []
    aliases = {}
    for person in people:
        key = re.sub(r"\s+", "", unicodedata.normalize("NFKC", person["name"]))
        existing = canonical_people.get(key)
        if existing:
            existing["alias_ids"] = list(dict.fromkeys(existing.get("alias_ids", []) + [person["id"]] + person.get("alias_ids", [])))
            existing["aliases"] = list(dict.fromkeys(existing.get("aliases", []) + [person["name"]] + person.get("aliases", [])))
            existing["source_refs"] = list(dict.fromkeys(existing.get("source_refs", []) + person.get("source_refs", [])))
            aliases[person["id"]] = existing["id"]
        else:
            canonical_people[key] = person
            merged_people.append(person)
    people = merged_people
    for credit in staff:
        if credit.get("person_id") in aliases:
            credit["person_id"] = aliases[credit["person_id"]]
    new_characters = [
        ("tojo_hana", "东条华", "東条ハナ", "豊口めぐみ", "Spica训练员的前同事，担任Rigil队的训练员。", ""),
        ("tanabe_trainer", "田边训练员", "タナベトレーナー", "緒方賢一", "曾指导富士奇石的资深训练员。离开育成工作多年后，他相信森林宝穴的潜力，重新投入指导。", "img_main09.png"),
        ("roux", "卢", "ルー", "櫻井みゆき", "与森林宝穴一起参加自由风格竞赛的三人组成员，一直热情地为她加油。", "img_main10.png"),
        ("shima", "岛", "シマ", "伊駒ゆりえ", "与森林宝穴一起参加自由风格竞赛的三人组成员，对田边训练员和富士奇石十分礼貌。", "img_main10.png"),
        ("mei", "梅", "メイ", "仁見紗綾", "与森林宝穴一起参加自由风格竞赛的三人组成员，每逢她参赛都会前往应援。", "img_main10.png"),
        ("izumimoto_nana", "泉本奈奈", "泉本奈々", "本泉莉奈", "担任Twinkle Series实况解说的播音员，以准确而富有感染力的解说著称。", "img_main11.png"),
    ]
    added = 0
    for cid, zh, ja, cv, summary, image in new_characters:
        if not selected_characters([{"id": cid}]):
            continue
        if any(character["id"] == cid for character in characters):
            continue
        voice = voice_names[norm(cv)]
        characters.append({"id": cid, "zh": zh, "ja": ja, "en": "", "cv": cv,
                           "cv_zh": voice["identity"]["zh"], "main": "#3157ed", "sub": "#ffa932",
                           "img": urljoin("https://movie-umamusume.jp/assets/images/character/", image) if image else "",
                           "page": "https://movie-umamusume.jp/character/" if image else "https://anime-umamusume.jp/archive/2nd/character/",
                           "role_type": "human", "summary_zh": summary,
                           "birth": "", "height": "", "weight": "", "sankak": ""})
        added += 1
    character_names = {norm(c["ja"]): c for c in characters}
    character_names.update({"トレーナー": next(c for c in characters if c["id"] == "spica_trainer"),
                            "沖田トレーナー": next(c for c in characters if c["id"] == "narita_trainer")})
    # These are named characters already maintained by the main database.
    character_names.update({"乙名史悦子記者": next(c for c in characters if c["id"] == "otonashietsuko"),
                            "秋川やよい理事長": next(c for c in characters if c["id"] == "akikawayayoi")})
    sources = read("source_registry.json", "sources")
    character_source = "official-cingray-character-roster"
    if not any(s["id"] == character_source for s in sources):
        sources.append({"id": character_source, "kind": "official", "label": "芦毛灰姑娘角色资料", "url": "https://anime-cinderellagray.com/character/", "observed_at": "2026-10-04"})
    additions = selected_characters(read("cingray_character_additions.json", "characters"))
    for character in additions:
        if any(r["source_id"] == "anime-cinderella-gray" and r["target_type"] == "character" and r["target_id"] == character["id"] for r in relations):
            continue
        voice = voice_names.get(norm(character.get("cv", "")))
        relation = {"id": "cg-character-roster-" + character["id"], "source_type": "anime_work", "source_id": "anime-cinderella-gray",
                    "relation_type": "work_character", "target_type": "character", "target_id": character["id"], "label": "", "display_order": len(relations), "evidence_refs": [character_source]}
        if voice:
            relation["voice_actor_id"] = voice["id"]
        relations.append(relation)
    movie_url = "https://movie-umamusume.jp/caststaff/"
    movie_soup = BeautifulSoup(fetch(movie_url), "html.parser")
    for modal in movie_soup.select('.p-caststaff-modal'):
        node = modal.select_one('.p-caststaff-modal__name')
        image = modal.select_one('.p-caststaff-modal__img img')
        if not node or not image:
            continue
        role = node.select_one('.p-caststaff-modal__role')
        if role:
            role.decompose()
        voice = voice_names.get(norm(node.get_text(strip=True)))
        if voice and not (voice.get('photo') or {}).get('url'):
            voice['photo'] = {"url": urljoin(movie_url, image['src']), "source_url": movie_url, "source_title": "新时代之门官方人物照片"}
    for voice in voices:
        if (voice.get("photo") or {}).get("url"):
            continue
        try:
            photo = public_voice_photo(voice)
        except Exception as error:
            print(f"Portrait unavailable: {voice['identity']['ja']}: {type(error).__name__}")
            continue
        if photo:
            voice["photo"] = photo
    soup = BeautifulSoup(fetch("https://anime-umamusume.jp/archive/2nd/caststaff/"), "html.parser")
    sections = soup.select(".caststaff__contents")
    cast_rows = [(dl.dt.get_text(strip=True), dl.dd.get_text(strip=True)) for dl in sections[0].select("dl")]
    staff_rows = [(dl.dt.get_text(strip=True), dl.dd.get_text(strip=True)) for dl in sections[1].select("dl")]
    if not cast_rows or not staff_rows:
        raise ValueError("official Cast/Staff sections could not be parsed")
    for order, (role, actor) in enumerate(cast_rows):
        if excluded_signature(role):
            continue
        character, voice = character_names[norm(role)], voice_names[norm(actor)]
        existing = next((r for r in relations if r["source_id"] == "anime-s2" and r["target_type"] == "character" and r["target_id"] == character["id"]), None)
        if existing:
            existing.update(voice_actor_id=voice["id"], signature=role)
        else:
            relations.append({"id": "s2-official-cast-" + character["id"], "source_type": "anime_work", "source_id": "anime-s2",
                              "relation_type": "credited_cast", "target_type": "character", "target_id": character["id"],
                              "voice_actor_id": voice["id"], "signature": role, "label": "", "display_order": order,
                              "evidence_refs": ["official-master-anime-s2"]})
    organizations = {"Cygames", "P.A.WORKS", "UTAMARO movement", "スタジオKAI"}
    for order, (role, names) in enumerate(staff_rows):
        for name in names.split("・"):
            if any(c["work_id"] == "anime-s2" and not c.get("unit_id") and c["role"] == role and norm(c.get("name") or c.get("organization") or "") == norm(name) for c in staff):
                continue
            credit = {"work_id": "anime-s2", "role": role, "name": name, "order": order, "source_ref": "official-master-anime-s2"}
            if name in organizations or "製作委員会" in name:
                credit["organization"] = name
            else:
                person = next((p for p in people if norm(p["name"]) == norm(name)), None)
                if person is None:
                    person = {"id": "staff-" + person_label(name), "name": person_label(name), "aliases": [], "source_refs": ["official-master-anime-s2"]}
                    people.append(person)
                credit["person_id"] = person["id"]
            staff.append(credit)
    excluded = []
    kept = []
    for relation in relations:
        if relation.get("target_type") != "voice_actor" or relation.get("relation_type") != "credited_cast":
            kept.append(relation)
            continue
        signature = norm(relation.get("signature") or "")
        if signature in character_names:
            relation.update(target_type="character", target_id=character_names[signature]["id"])
        elif signature == "ナレーション":
            relation.update(label="旁白", role_name="旁白")
        elif re.fullmatch(r"ウマ娘[A-D]", signature) or signature in {"大将", "女将", "観客", "霊の声", "幽霊", "ファインのSP", "スタッフ"}:
            excluded.append(relation)
            continue
        kept.append(relation)
    for relation in kept:
        if relation.get('target_type') != 'character' or not relation.get('voice_actor_id'):
            continue
        character = next(c for c in characters if c['id'] == relation['target_id'])
        voice = next(v for v in voices if v['id'] == relation['voice_actor_id'])
        if not any(role.get('character_id') == character['id'] for role in voice.get('roles', [])):
            voice.setdefault('roles', []).append({"character_id": character['id'], "name": character['zh'], "name_ja": character['ja'], "former": False,
                                                 "image": character['img'], "color_main": character['main'], "color_sub": character['sub']})
    units = read("units.json", "series")
    umayon = next(series for series in units if series["work_id"] == "anime-umayon")
    for number in range(13, 25):
        umayon["labels"][str(number)] = f"第 {number} 话"
        umayon["details"][str(number)]["original_number"] = number - 12
    print(f"Official S2: {len(cast_rows)} Cast rows, {len(staff_rows)} Staff roles; named characters added: {added}; extras excluded: {len(excluded)}; legacy credit names decoded: {decoded}; whitespace identities merged: {len(aliases)}")
    if args.write:
        (ROOT / "data/character_index_data.js").write_text("window.CHAR_INDEX = " + json.dumps(characters, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
        for name, key, rows in [("people.json", "people", people), ("staff.json", "credits", staff), ("relations.json", "relations", kept), ("units.json", "series", units)]:
            atomic_json(DATA / name, {"schema_version": 1, key: rows})
        atomic_json(DATA / 'source_registry.json', {"schema_version": 1, "sources": sources})
        voice_document = json.loads((ROOT / 'data/voice_actor_profiles.json').read_text(encoding='utf-8'))
        voice_document['voice_actors'] = voices
        atomic_json(ROOT / 'data/voice_actor_profiles.json', voice_document)
        if excluded:
            archive_path = DATA / "excluded_extra_cast.json"
            archived = json.loads(archive_path.read_text(encoding="utf-8"))["relations"] if archive_path.exists() else []
            ids = {r["id"] for r in archived}
            atomic_json(archive_path, {"schema_version": 1, "relations": archived + [r for r in excluded if r["id"] not in ids]})


if __name__ == "__main__":
    main()
