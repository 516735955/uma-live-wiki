"""Apply researched episode metadata and the verified theatrical edition."""

import argparse
import json
from pathlib import Path
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from build_anime_catalog import atomic_json
from collect_anime_official import fetch
from import_anime_episode_cast import normalized

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/anime"
TOHO = "https://prtimes.jp/main/html/rd/p/000000005.000118823.html"
UMAYON = [
    ("40点下！トレセン学園追試特別", "40分以下！特雷森学园补考特别赛", "特别周、神鹰和草上飞参加补考。特别周拿出待兼福来的骰子铅笔，试图靠运气完成试卷。", "40%25_And_Below%21_Tracen_Academy_Special_Make-up_Exams"),
    ("出来立て！トレセン学園案内ＶＴＲ", "新鲜出炉！特雷森学园介绍影片", "鲁道夫象征、东海帝王和气槽观看学园介绍影片。影片展示课堂、训练设施与学生生活，东海帝王却频频抢镜。", "Newly_Filmed%21_The_Tracen_Academy_Video_Introduction"),
    ("憧れの世界はホラここに", "向往的世界就在眼前", "雪之美人与重炮向往黄金城市的模特工作。黄金城市带她们来到拍摄现场，鼓励她们迈出追逐梦想的第一步。", "The_World_You%27ve_Dreamed_of_Is_Right_in_Front_of_You"),
    ("オペラ劇場・『嗚呼それが我が宿命』", "歌剧剧场·《啊，这就是我的宿命》", "好歌剧、丸善斯基、富士奇石与醒目飞鹰登上剧场舞台，展开一场关于爱情与决斗的华丽演出。", "The_Opera%3A_%22Alas%2C_It_Is_My_Fate%22"),
    ("大激戦！？ラーメン杯（ＧII）", "大激战！？拉面杯（GII）", "小栗帽、特别周与大树快车挑战巨碗拉面。面对堆成山的面条与配菜，三人各有自己的攻略方法。", "A_Major_Clash%3F%21_The_Ramen_Cup_%28GII%29"),
    ("お嬢様たちの優雅なランチ", "大小姐们的优雅午餐", "帝王光辉、美妙姿势与目白麦昆来到牛肉盖饭店，艾尼斯风神向她们介绍点餐与用餐的方法。", "An_Elegant_Lunch_for_Elegant_Young_Ladies"),
    ("カブトムシとりだよ！ＢＮＷ", "去抓独角仙吧！BNW", "胜利奖券拉着琵琶晨光与成田大进，在合宿期间替当地孩子寻找独角仙。一次踢树行动带来了意料之外的追兵。", "Time_to_Hunt_Rhinoceros_Beetles%21_BNW"),
    ("ヒーロー劇場・ウマソルジャーV！！", "英雄剧场·赛马娘战队V！！", "微光飞驹率领赛马娘战队，迎战爱丽速子与曼城茶座。队员们的颜色、配合与秘密武器成为这场战斗的关键。", "Hero_Theater%3A_Uma_Soldier_V%21%21"),
    ("夢を叶えよう！逃げ切りシスターズ☆", "实现梦想吧！逃切姐妹☆", "醒目飞鹰想为逃切姐妹寻找新成员。她与无声铃鹿、美浦波旁追上忙碌的艾尼斯风神，又遇到了主动报名的丸善斯基。", "Make_the_Dream_Come_True%21_Getaway_Sisters"),
    ("ビビったら負け！肝試し対決！", "害怕就输了！试胆对决！", "伏特加与大和赤骥争论谁更胆小，决定在试胆大会上一决胜负。森林里的岔路和熟悉的身影让事情变得更加诡异。", "You_Get_Spooked%2C_You_Lose%21_Test_of_Courage_Showdown%21"),
    ("うまよんサスペンス劇場", "赛马娘四格悬疑剧场", "优秀素质与目白赖恩调查骏川手纲遇袭案，在悬崖上追问荣进闪耀的行程与不在场证明。", "Umayon_Suspense_Theater"),
    ("本日のメインレース！金船障害（ＧI）", "今日主赛！黄金船障碍赛（GI）", "玉藻十字、菱亚马逊与超级溪流参加障碍赛，依次挑战糖果、换装与寻人关卡。主持比赛的黄金船却也加入了争夺。", "Today%27s_Main_Race%21_The_Gilded_Vessel_Obstacle_Course_%28G1%29"),
    ("食い気より気品なのです！", "比食欲更重要的是气度！", "目白麦昆看见特别周与无声铃鹿享用芭菲，却努力坚持节食。东海帝王的劝诱与肚子的叫声让她难以继续维持体面。", "It%27s_More_Elegant_Than_Eating%21"),
    ("大人のオンナになりた〜い", "想成为成熟的女人", "重炮与东海帝王、雪之美人谈论成熟与时髦的女性。她对丸善斯基的一句评价，招来了本人特别的指导。", "I_Want_To_Be_An_Adult_Woman"),
    ("隙のない女帝", "无懈可击的女帝", "黄金船让特别周拿手机去找气槽合影。气槽察觉了拍照设置中的机关，反过来留下了一条给黄金船的讯息。", "Empress_Without_A_Gap"),
    ("後ろは気にならない？", "不会在意身后吗？", "特别周好奇领跑时的无声铃鹿是否担心身后，于是在吃饭、训练和休息时都紧紧跟着她，进行自己的实验。", "Don%27t_You_Care_About_The_Back%3F"),
    ("もっと食べよう！タマ！", "再多吃一点吧！小玉！", "小栗帽发现玉藻十字在食堂里吃得很少。玉藻十字知道食物可以自由取用，却仍难以改变过去节省的习惯。", "Let%27s_Eat_More%21_Tama%21"),
    ("大きくなれませんよ〜？", "这样可长不大哦？", "超级溪流听说玉藻十字吃得少，便用妈妈般的口吻和喂饭办法来帮忙，结果引来了玉藻十字的抗议。", "You_Can%27t_Grow_Up%3F"),
    ("目指せ一等賞大作戦！", "冲向第一名大作战！", "春丽把胡萝卜形状的冰棒挂在无声铃鹿前方，想用它激励奔跑。无声铃鹿跑得太快，春丽只好等她绕场回来。", "Aim_For_The_First_Prize_Grand_Strategy%21"),
    ("皇帝に挑む資格", "挑战皇帝的资格", "东海帝王缠着鲁道夫象征一起跑步。鲁道夫提出先在大胃王比赛中战胜小栗帽，才接受这次挑战。", "Qualification_To_Challenge_The_Emperor"),
    ("袖を千切った制服と包帯", "撕掉袖子的制服与绷带", "爱丽速子实验时被药品伤到手臂，只得剪掉制服袖子并缠上绷带。伏特加看到后，建议再加上一条帅气的链子。", "Uniforms_With_Torn_Sleeves_And_Bandages"),
    ("私の計画を狂わせる敵", "打乱我计划的敌人", "醒目飞鹰邀请荣进闪耀参加棒球活动，却听她把棒球称作敌人：棒球转播曾打乱了她按时收看新闻的计划。", "Enemies_Who_Upset_My_Plan"),
    ("美浦寮怪談大会！", "美浦寮怪谈大会！", "菱亚马逊发现寮里的怪谈总以曼城茶座作结，便请她亲自讲一个故事。曼城茶座说，她在夜晚的走廊里看见了自己。", "Miho_Dormitory_Ghost_Story_Competition%21"),
    ("浜辺のD？", "海边的D？", "黄金船在夏季合宿时抓来海蟑螂，想吓唬特别周。特别周却说自己害怕的是鼠妇，两人为这些虫子的区别争论起来。", "D_On_The_Beach%3F"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    documents = {name: json.loads((DATA / (name + ".json")).read_text(encoding="utf-8")) for name in ["works", "units", "staff", "people", "relations", "source_registry", "watch_resources"]}
    sources = documents["source_registry"]["sources"]
    people = documents["people"]["people"]
    people_by_name = {normalized(person["name"]): person for person in people}
    publication_signatures = {
        "原智幸(写真)": ("原智幸", "资料协力／摄影"),
        "乗峯栄一(文)": ("乗峯栄一", "资料协力／文字"),
        "ノベライズ／𠮷村清子": ("𠮷村清子", "官方小说改编／执笔"),
        "シナリオディレクター・ストーリー構成／小針哲也": ("小針哲也", "官方小说改编／剧本总监与故事构成"),
        "コンテンツディレクター／秋津琢磨": ("秋津琢磨", "官方小说改编／内容总监"),
    }
    for credit in documents["staff"]["credits"]:
        if credit["work_id"] != "anime-movie-beginning-new-era":
            continue
        if credit["name"] in publication_signatures:
            name, role = publication_signatures[credit["name"]]
            person = people_by_name.get(normalized(name))
            if person is None:
                person = {"id": "staff-" + name, "name": name, "aliases": [], "source_refs": [credit["source_ref"]]}
                people.append(person)
                people_by_name[normalized(name)] = person
            credit.update(credited_name=credit["name"], name=name, role=role, person_id=person["id"])
        elif credit["name"] == "原作／Cygames":
            credit.update(credited_name=credit["name"], name="Cygames", organization="Cygames", role="官方小说改编／原作")
        elif credit["name"] == "KADOKAWA／角川文庫":
            credit.update(credited_name=credit["name"], name="KADOKAWA／角川文庫", organization="KADOKAWA／角川文庫")
    existing_sources = {source["id"] for source in sources}
    def source(identifier, label, url, kind="reference"):
        if identifier not in existing_sources:
            sources.append({"id": identifier, "kind": kind, "label": label, "url": url, "observed_at": "2026-10-04"})
            existing_sources.add(identifier)
    season_one = next(row for row in documents["units"]["series"] if row["work_id"] == "anime-s1")
    ova_summaries = [
        "Spica队受命协助筹办学园感谢祭。为了让疏远的琵琶晨光、成田大进和胜利奖券重拾奔跑的热情，学生会安排了BNW接力赛，队员们分头展开劝说。",
        "BNW接力赛开始宣传。无法参赛的大和赤骥受学生会委托走访三支队伍，了解各队准备情况并收集BNW三人的感想，却发现成田大进仍未归队。",
        "BNW接力赛正式开跑，琵琶晨光、成田大进与胜利奖券各自的队伍展开激烈争夺。成田大进及时与队友重聚，重新踏上奔跑的舞台。",
    ]
    for number, summary, numeral in zip(range(14, 17), ova_summaries, ["%E2%91%A0", "%E2%91%A1", "%E2%91%A2"]):
        identifier = f"reference-bnw-e{number - 13:02d}"
        source(identifier, "BNW单集剧情资料", "https://umamusu.wiki/BNW%27s_Oath_" + numeral)
        detail = season_one["details"][str(number)]
        detail["summary_zh"] = summary
        detail["source_refs"] = list(dict.fromkeys(detail.get("source_refs", []) + [identifier]))
    series = next(row for row in documents["units"]["series"] if row["work_id"] == "anime-umayon")
    series["titles_ja"] = [row[0] for row in UMAYON]
    series["titles_zh"] = [row[1] for row in UMAYON]
    for number, row in enumerate(UMAYON, 1):
        identifier = f"reference-umayon-e{number:02d}"
        source(identifier, "四格单集内容资料", "https://umamusu.wiki/" + row[3])
        detail = series["details"][str(number)]
        detail.update(summary_zh=row[2])
        detail["source_refs"] = list(dict.fromkeys(detail.get("source_refs", []) + [identifier]))
        if number > 12:
            detail.update(original_number=number - 12, duration="90秒", dates=[{"label": "发行日期", "date": "2021-12-08"}])
    detail = series["details"]["13"]
    detail.update(release_date="2021-10-19", dates=[{"label": "先行公开", "date": "2021-10-19"}, {"label": "发行日期", "date": "2021-12-08"}])
    source("official-umayon-extra-preview", "四格新作第一话先行公开", "https://www.youtube.com/watch?v=6bIi-H-4aHI", "official")
    detail["source_refs"] = list(dict.fromkeys(detail["source_refs"] + ["official-umayon-extra-preview"]))
    resources = documents["watch_resources"]["resources"]
    preview = next((row for row in resources if row.get("id") == "umayon-extra-preview-e13"), None)
    if preview is None:
        preview = {"id": "umayon-extra-preview-e13"}
        resources.append(preview)
    preview.clear()
    preview.update(id="umayon-extra-preview-e13", scope={"type": "unit", "id": "anime-umayon-e13"}, authority="official", status="active", content_type="full_episode", platform="youtube", url="https://www.youtube.com/watch?v=6bIi-H-4aHI", source_ref="official-umayon-extra-preview")
    works = documents["works"]["works"]
    assets = json.loads((DATA / "asset_sources.json").read_text(encoding="utf-8"))["assets"]
    for work in works:
        asset = next((asset for asset in assets if asset["work_id"] == work["id"]), None)
        if asset:
            work["cover_original"] = asset["source_url"]
    rttt = next(work for work in works if work["id"] == "anime-rttt")
    rttt.update(film_duration="99分钟", film_cover="https://movie-umamusume.jp/assets/images/rttt/img_rttt01.jpg")
    network_dates = [date for date in rttt["dates"] if date["date"] == "2023-04-16"]
    for date in network_dates:
        date["edition"] = "web"
    rttt["dates"] = network_dates + [{"label": "剧场上映", "date": "2024-05-10", "edition": "film"}, {"label": "Blu-ray发行", "date": "2025-01-22", "edition": "film"}]
    movie = next(work for work in works if work["id"] == "anime-movie-beginning-new-era")
    movie["duration"] = "108分钟"
    source("official-toho-film-release", "东宝电影发行与剧照", TOHO, "official")
    for relation in documents["relations"]["relations"]:
        if relation["source_id"] != "anime-rttt":
            continue
        if relation["target_type"] == "character" or relation.get("usage_type") == "op":
            relation["editions"] = ["web", "film"]
            relation["evidence_refs"] = list(dict.fromkeys(relation.get("evidence_refs", []) + ["official-toho-film-release"]))
        else:
            relation["edition"] = "web"
    for credit in documents["staff"]["credits"]:
        if credit["work_id"] == "anime-rttt" and not credit.get("unit_id"):
            credit["editions"] = ["web", "film"]
            credit["source_refs"] = list(dict.fromkeys(credit.get("source_refs", []) + ["official-toho-film-release"]))
    # The distributor's image section contains eight film frames per title.
    # Posters, package illustrations and repeated image-gallery thumbnails
    # are excluded from stills.
    soup = BeautifulSoup(fetch(TOHO), "html.parser")
    images = list(dict.fromkeys(image["src"].split("?", 1)[0] for image in soup.select('img[src*="release_image"]') if "x1080.jpg" in image["src"] or any(size in image["src"] for size in ["1920x799", "2015x843", "2015x837", "2014x841", "2015x841", "1920x804", "2016x841"])))
    if len(images) != 16:
        raise ValueError("distributor film image groups changed")
    rttt["film_stills"] = [{"url": url, "original": url, "source_ref": "official-toho-film-release"} for url in images[:8]]
    movie_unit = next(series for series in documents["units"]["series"] if series["work_id"] == movie["id"])["details"]["1"]
    stills = movie_unit.setdefault("stills", [])
    urls = {image["url"] for image in stills}
    stills.extend({"url": url, "original": url, "source_ref": "official-toho-film-release"} for url in images[8:] if url not in urls)
    print("Umayon: 24 researched titles and summaries; film press stills: 8 RTTT + 8 New Era")
    if args.write:
        for name, document in documents.items():
            atomic_json(DATA / (name + ".json"), document)


if __name__ == "__main__":
    main()
