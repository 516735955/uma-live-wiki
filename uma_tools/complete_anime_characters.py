"""Complete fixed anime identities from official profiles and episode signatures."""

import argparse
import json
import re
from pathlib import Path

from collect_anime_official import fetch, cms
from build_anime_catalog import atomic_json
from import_anime_episode_cast import normalized
from character_scope import excluded_signature

ROOT = Path(__file__).resolve().parents[1]


def sync_character_pedigree_mappings(characters):
    """Register character-only entries without inferring real-horse identities."""
    path = ROOT / "data/pedigree_source.json"
    source = json.loads(path.read_text(encoding="utf-8"))
    mappings = source["character_mappings"]
    nodes = {node["id"] for node in source["nodes"]}
    for character in characters:
        identifier = character["id"]
        if identifier in mappings:
            continue
        kind = "non_uma" if character.get("role_type") == "human" else "original"
        mappings[identifier] = {"horse": None, "kind": kind}
        if identifier not in nodes:
            source["nodes"].append({"id": identifier, "zh": character["zh"],
                                    "ja": character["ja"], "en": character.get("en", ""),
                                    "avatar": character.get("img", ""), "pure": True})
            nodes.add(identifier)
    atomic_json(path, source)

# These are distinct named characters, not generic background signatures.
# Their casting is taken from the individual episode credit snapshot.
NAMED = {
    "ツウカア": ("tsuukaa", "默契之交", "umamusume"),
    "ますお": ("masuo", "益男", "human"),
    "みなみ": ("minami", "南", "human"),
    "南坂": ("minamisaka", "南坂", "human"),
    "黒沼": ("kuronuma", "黑沼", "human"),
    "ブロワイエ": ("broye", "ブロワイエ", "umamusume"),
    "サンバイザー": ("sun_visor", "サンバイザー", "umamusume"),
    "クイーンベレー": ("queen_berry", "クイーンベレー", "umamusume"),
    "リオナタール": ("rionatal", "リオナタール", "umamusume"),
    "ダイサンゲン": ("daisangen", "ダイサンゲン", "umamusume"),
    "レリックアース": ("relic_earth", "レリックアース", "umamusume"),
    "メリービューティー": ("merry_beauty", "メリービューティー", "umamusume"),
    "ルナスワロー": ("luna_swallow", "ルナスワロー", "umamusume"),
    "ナントウイチバン": ("nanto_ichiban", "ナントウイチバン", "umamusume"),
    "サウスヒロイン": ("south_heroine", "サウスヒロイン", "umamusume"),
    "セカイトーハー": ("sekai_toha", "セカイトーハー", "umamusume"),
    "ウォークダンサー": ("walk_dancer", "ウォークダンサー", "umamusume"),
    "スプリングシング": ("spring_sing", "スプリングシング", "umamusume"),
    "フェイスノーモア": ("faith_no_more", "フェイスノーモア", "umamusume"),
    "ロマンスバブリー": ("romance_bubbly", "ロマンスバブリー", "umamusume"),
    "フユノナカスミ": ("fuyuno_nakasumi", "フユノナカスミ", "umamusume"),
}

VOICE_PROFILES = {
    "井坂瞳": ("isaka-hitomi", "井坂瞳", "6月21日", "茨城県", "FIRST WIND production", "https://firstwind.co.jp/talentpage/isaka_hitomi/", "https://firstwind.co.jp/wp-content/uploads/2019/11/isaka_hitomi.jpeg"),
    "有隅融": ("arizumi-tooru", "有隅融", "4月3日", "埼玉県", "81プロデュース", "https://www.81produce.co.jp/actor_search/index.php/item?id=371", "https://www.81produce.co.jp/dcms_media/image/arizumi_tooru.jpg"),
    "上西哲平": ("uenishi-teppei", "上西哲平", "9月1日", "山梨県", "81プロデュース", "https://www.81produce.co.jp/actor_search/index.php/item?id=12", "https://www.81produce.co.jp/dcms_media/image/uenishi_teppei.jpg"),
    "池澤春菜": ("ikezawa-haruna", "池泽春菜", "12月15日", "ギリシャ", "アクロス エンタテインメント", "https://across-ent.com/voice_actor/detail.html?id=111", "https://across-ent.com/assets/media/aa9e63b595238cd3850c852ada78e6870e1ed0a8.jpg"),
    "古川慎": ("furukawa-makoto", "古川慎", "9月29日", "熊本県", "TOY'S FACTORY", "https://www.toysfactory.co.jp/sp/artist/makotofurukawa/bio", "https://www.toysfactory.co.jp/artist_images/007902_X831fYdf2xjsZI1lykCTbG_spzWEQr.jpg"),
    "赤崎千夏": ("akasaki-chinatsu", "赤崎千夏", "8月10日", "鹿児島県", "81プロデュース", "https://www.81produce.co.jp/dcms_plusdb/index.php/item?id=148", "https://www.81produce.co.jp/dcms_media/image/akasaki_chinatsu.jpg"),
    "釘宮理恵": ("kugimiya-rie", "钉宫理惠", "5月30日", "熊本県", "アイムエンタープライズ", "https://imenterprise.jp/profile.php?id=52", "https://imenterprise.jp/files/img/KUGIMIYARIE20190330054353.jpg"),
    "山田京奈": ("yamada-keina", "山田京奈", "12月25日", "埼玉県", "青二プロダクション", "https://www.aoni.co.jp/search/yamada-keina.html", "https://www.aoni.co.jp/search/items/yamada-keina.jpg"),
    "小松未可子": ("komatsu-mikako", "小松未可子", "11月11日", "三重県", "ヒラタオフィス", "https://hirata-office.jp/talent_profile/woman/mikako_komatsu.html", "https://hirata-office.jp/talent_profile/img/mikako_komatsu.jpg"),
    "漆山ゆうき": ("urushiyama-yuki", "漆山ゆうき", "11月24日", "山形県", "賢プロダクション", "https://www.kenproduction.co.jp/talent/211", "https://www.kenproduction.co.jp/img/talent/211/1.jpg"),
    "宮古風佳": ("miyako-fuka", "宫古风佳", "8月26日", "大阪府", "賢プロダクション", "https://www.kenproduction.co.jp/talent/246", "https://www.kenproduction.co.jp/img/talent/246/1.jpg"),
    "河上明日香": ("kawakami-asuka", "河上明日香", "9月25日", "広島県", "アトミックモンキー", "https://www.atomicmonkey.jp/talent/kawakamiasuka", "https://www.atomicmonkey.jp/atmnadmin-corporate/wp-content/uploads/2015/12/62e772068b6a1d64c227ff9f8ae55df5.jpg"),
    "黒田崇矢": ("kuroda-takaya", "黑田崇矢", "4月17日", "東京都", "HIYUSE（灯唯世）", "https://talent.hiyuse.jp/talent-kuroda.html", "https://talent.hiyuse.jp/assets/img/kuroda.jpg"),
    "東城日沙子": ("tojo-hisako", "东城日沙子", "8月21日", "埼玉県", "HIGH PINE", "https://highpine.co.jp/talent/tojo-hisako.html", "https://highpine.co.jp/image/tojo_hisako.jpg"),
    "原優子": ("hara-yuko", "原优子", "6月13日", "埼玉県", "円企画", "https://seigura.com/directory/39386/", "https://seigura.com/wp-content/uploads/2026/05/e1617024f9c5ccb26b46021f7acdf218.jpg"),
}

PUBLIC_PROFILES = {"原優子"}

CHARACTER_PROFILES = {
    "ツウカア": ("To-Car", "https://umamusu.wiki/w/images/f/f0/To-Car.png", "第三季中登场的赛马娘，在日本德比中与里见光钻争夺胜利。"),
    "ますお": ("https://www.bilibili.com/bangumi/play/ep780851", "", "赛马娘竞赛的爱好者，常与南一起到场观赛。"),
    "みなみ": ("https://www.bilibili.com/bangumi/play/ep780851", "", "赛马娘竞赛的爱好者，常与益男一起到场观赛。"),
    "スプリングシング": ("https://times.abema.tv/articles/-/10169707", "", "参加岐阜王冠赏的赛马娘，在《芦灰》第14话登场。"),
    "黒沼": ("Kuronuma", "https://umamusu.wiki/w/images/9/9c/Kuronuma.png", "美浦波旁的训练员，身材魁梧，常戴着墨镜。他以严格的训练方式指导波旁。"),
    "ブロワイエ": ("Broye", "https://umamusu.wiki/w/images/0/0b/Broye_%28Main%29.png", "来自法国的强大赛马娘，以出色的竞技实力闻名。她在第一季中与神鹰和特别周展开较量。"),
    "サンバイザー": ("Sun_Visor", "https://umamusu.wiki/w/images/6/6a/Sunvisor.png", "第一季中登场的赛马娘，在无声铃鹿复出后的比赛中与她同场竞技。"),
    "クイーンベレー": ("Queen_Berry", "https://umamusu.wiki/w/images/3/31/Queen_Berry.png", "第一季中与特别周一同参加出道赛的赛马娘，留着灰色头发并戴有眼罩。她在比赛中积极争夺位置，最终获得第二名。"),
    "リオナタール": ("Rionatal", "https://umamusu.wiki/w/images/1/10/Rionatal_Race_Outfit.png", "第二季中登场的赛马娘。"),
    "ダイサンゲン": ("Daisangen", "https://umamusu.wiki/w/images/3/35/DaisangenFullbody.jpeg", "第二季中登场的赛马娘，在有马纪念中战胜了目白麦昆。"),
    "レリックアース": ("Relic_Earth", "https://umamusu.wiki/w/images/9/96/Relic_Earth_Main.png", "第二季中登场的赛马娘，曾参加有马纪念。"),
    "メリービューティー": ("Merry_Beauty", "https://umamusu.wiki/w/images/a/ab/Merry_Beauty_%28Main%29.png", "《芦毛灰姑娘》中登场的赛马娘，曾与黄金城市同场竞技。"),
    "ルナスワロー": ("Luna_Swallow", "https://umamusu.wiki/w/images/d/d6/Luna_Swallow_%28Main%29.png", "《芦毛灰姑娘》中登场的赛马娘，曾参加日本德比，并与小栗帽等人在有马纪念中同场竞技。"),
    "サウスヒロイン": ("South_Heroine", "https://umamusu.wiki/w/images/7/72/South_Heroine_%28Main%29.png", "笠松的赛马娘，与小栗帽一同参加了她的出道赛。"),
    "ウォークダンサー": ("Walk_Dancer", "https://umamusu.wiki/w/images/d/d6/Walk_Dancer_%28Main%29.png", "笠松的赛马娘，与小栗帽一同参加了她的出道赛。她与藤正进行曲同住一间宿舍。"),
    "セカイトーハー": ("Sekai_Touha", "https://umamusu.wiki/w/images/8/8c/Sekai_Touha_%28Main%29.png", "笠松的赛马娘，与小栗帽一同参加了她的出道赛。"),
    "フェイスノーモア": ("Faith_No_More", "https://umamusu.wiki/w/images/a/ac/Faith_No_More_%28Main%29.png", "从中央转入笠松的赛马娘，接受柴崎训练员的指导。性格活泼，曾赴大井与稻荷一同场竞技。"),
    "ロマンスバブリー": ("Romance_Bubbly", "https://umamusu.wiki/w/images/8/84/Romance_Bubbly_%28Main%29.png", "大井的赛马娘，在当地颇受欢迎，曾与稻荷一同场竞技。"),
    "フユノナカスミ": ("Fuyuno_Nakasumi", "https://umamusu.wiki/w/images/c/cc/Fuyuno_Nakasumi_%28Main%29.png", "大井的赛马娘，在当地颇受欢迎，曾与稻荷一同场竞技。"),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--character", action="append", help="Complete only these credited character names.")
    args = parser.parse_args()
    path = ROOT / "data/character_index_data.js"
    characters = json.loads(path.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))
    voice_path = ROOT / "data/voice_actor_profiles.json"
    voice_doc = json.loads(voice_path.read_text(encoding="utf-8"))
    voices = voice_doc["voice_actors"]
    episodes = json.loads((ROOT / "data/anime/episode_cast.json").read_text(encoding="utf-8"))["episodes"]
    voice_names = {normalized(v["identity"]["ja"]): v for v in voices}
    existing = {normalized(c["ja"]): c for c in characters}
    additions = []
    selected = {name for name in (args.character or NAMED) if not excluded_signature(name)}
    selected_actors = {normalized(actor) for episode in episodes for role, actor in episode["cast"]
                       if role in selected}
    for actor_name, profile in VOICE_PROFILES.items():
        if actor_name not in selected_actors:
            continue
        voice = voice_names.get(actor_name)
        if not voice:
            continue
        voice["identity"]["zh"] = profile[1]
        fields = {"birthday": profile[2], "birthplace": profile[3], "agency": profile[4],
                  "official_profile": profile[5] if actor_name not in PUBLIC_PROFILES else ""}
        voice["profile"].update(fields)
        voice["profile"]["field_status"].update({key: "verified" if value else "source_unavailable" for key, value in fields.items()})
        voice["profile"]["status"] = "complete" if all(fields.values()) else "partial"
        source = {"kind": "official_profile" if actor_name not in PUBLIC_PROFILES else "public_profile", "label": "人物资料", "url": profile[5]}
        if not any(s["url"] == profile[5] for s in voice["profile"].get("sources", [])):
            voice["profile"].setdefault("sources", []).append(source)
        voice["photo"] = {"url": profile[6], "source_url": profile[5], "source_title": "人物照片"}
    for name, (cid, zh, kind) in NAMED.items():
        if name not in selected:
            continue
        signatures = [(episode, actor) for episode in episodes for role, actor in episode["cast"] if normalized(role) == normalized(name)]
        if not signatures:
            raise ValueError("no individual signature for " + name)
        actors = {normalized(actor) for _, actor in signatures}
        if len(actors) != 1:
            raise ValueError("ambiguous casting for " + name)
        actor_name = next(iter(actors))
        voice = voice_names.get(actor_name)
        if voice is None:
            raw_actor = signatures[0][1]
            profile = VOICE_PROFILES.get(actor_name)
            vid = "va-" + (profile[0] if profile else normalized(raw_actor))
            fields = {"birthday": profile[2] if profile else "", "birthplace": profile[3] if profile else "", "agency": profile[4] if profile else "", "official_profile": profile[5] if profile and actor_name not in PUBLIC_PROFILES else ""}
            source_url = profile[5] if profile else signatures[0][0]["url"]
            voice = {"id": vid, "slug": vid, "identity": {"zh": profile[1] if profile else raw_actor, "ja": raw_actor, "kana": "", "aliases": []},
                     "profile": {**fields, "social": [], "field_status": {key: "verified" if value else "source_unavailable" for key, value in fields.items()},
                                 "sources": [{"kind": "official_profile" if profile and actor_name not in PUBLIC_PROFILES else "public_profile" if profile else "credit_transcription", "label": "人物资料" if profile else "单集配音署名", "url": source_url}], "status": "complete" if all(fields.values()) else "partial"},
                     "photo": {"url": profile[6], "source_url": source_url, "source_title": "人物照片"} if profile else {}, "roles": [], "stats": {"events": 0, "concerts": 0, "programs": 0, "songs": 0}}
            voices.append(voice)
            voice_names[actor_name] = voice
        if normalized(name) in existing:
            existing[normalized(name)]["cv"] = voice["identity"]["ja"]
            existing[normalized(name)]["cv_zh"] = voice["identity"]["zh"]
            if zh != name:
                existing[normalized(name)]["zh"] = zh
            continue
        character = {"id": cid, "zh": zh, "ja": name, "en": "", "cv": voice["identity"]["ja"],
                     "cv_zh": voice["identity"]["zh"], "img": "", "page": "", "main": "#3157ed", "sub": "#ffa932",
                     "role_type": kind, "summary_zh": "", "birth": "", "height": "", "weight": "", "sankak": "",
                     "source_urls": list(dict.fromkeys(episode["url"] for episode, _ in signatures))}
        characters.append(character)
        existing[normalized(name)] = character
        additions.append(cid)
    # The site's public browser configuration supplies the current profiles.
    if "南坂" in selected:
        url = "https://anime-umamusume.jp/character/"
        html = fetch(url)
        domain = re.search(r'serviceDomain:"([^\"]+)"', html).group(1)
        key = re.search(r'apiKey:"([^\"]+)"', html).group(1)
        profile = next(row for row in cms(domain, key, "character")["contents"] if row["name"] == "南坂")
        existing["南坂"].update(img=profile["detail_img"][0]["url"], page=url,
                               summary_zh="Canopus队的训练员，待人温和，内心怀有对胜利的热情。他尊重队员的跑法，温柔地守护着个性鲜明的她们。")
    # Public character pages identify these animation frames. Their speculative
    # real-horse matches are excluded from the database relationships.
    for name, (page, image, summary) in CHARACTER_PROFILES.items():
        if name not in selected:
            continue
        character = existing[normalized(name)]
        source = page if page.startswith("https://") else "https://umamusu.wiki/" + page
        character.update(img=image, page=source, summary_zh=summary)
        character["source_urls"] = list(dict.fromkeys(character.get("source_urls", []) + [source]))
    print("Fixed named identities added:", ", ".join(additions))
    if args.write:
        path.write_text("window.CHAR_INDEX = " + json.dumps(characters, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
        atomic_json(voice_path, voice_doc)
        sync_character_pedigree_mappings(characters)


if __name__ == "__main__":
    main()
