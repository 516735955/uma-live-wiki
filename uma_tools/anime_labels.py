"""Chinese display labels; accepted credits retain their original signatures."""

import html
import re
import unicodedata
from functools import lru_cache


ROLES = {
    "アフレコスタジオ": "配音录音室", "ダビングスタジオ": "混音录音室",
    "コーディネート": "协调", "モーションキャプチャー エンジニア": "动作捕捉工程师",
    "担当制作": "制作统筹",
    "担当補佐": "制作统筹助理",
    "背景進行": "背景制作进行", "背景進行補佐": "背景制作进行助理",
    # Keep production and animation production as separate responsibilities.
    # The raw Japanese credit is retained on every catalog row for later review.
    "制作プロデューサー": "制作制片人",
    "アニメーションプロデューサー": "动画制片人",
    "音楽プロデューサー": "音乐制片人",
    "音響制作プロデューサー": "音响制作制片人",
    "音響制作担当": "音响制作负责",
    "宣伝プロデューサー": "宣传制片人",
    "3Dプロデューサー": "3D制片人",
    "CGプロデューサー": "CG制片人",
    "3D CG": "3DCG",
    "3DCGリードモデラー": "3D首席建模师",
    "3DCGモデラー": "3D建模",
    "3Dモデラー": "3D建模",
    "3DCGアニメーター": "3D动画师",
    "CGレイアウター": "CG构图",
    "録音スタジオ": "录音室", "製作委員会": "出品委员会", "第二原画": "第二原画", "二原": "第二原画",
    "ライブパート第二原画": "舞台动画第二原画",
    "LIVEパート演出": "舞台动画演出", "LIVEパート作画監督": "舞台动画作画监督",
    "LIVEパート総作画監督": "舞台动画总作画监督",
    "ライブパート": "舞台动画", "ライブシーン": "舞台场景",
    "デザイン協力": "设计协力", "プロダクションマネージャー": "制作管理", "ライティング": "灯光", "編成": "编排",
    "作詞": "作词", "作曲": "作曲", "編曲": "编曲", "挿入曲": "插曲",
    "プロジェクトマネージャー": "项目经理", "レイアウター": "构图师",
    "デジタル動仕制作管理": "数字中间动画与上色制作管理", "デジタル修正": "数字修正",
    "CGデザイナー": "CG设计师", "翻訳": "翻译",
    "海外・配信セールス": "海外与流媒体销售",
    "美術監督": "美术监督", "撮影監督": "摄影监督", "音響監督": "音响监督",
    "3D監督": "3D监督", "CG監督": "CG监督",
    "監督": "导演", "副監督": "副导演", "助監督": "助理导演", "シリーズ構成": "系列构成",
    "絵コンテ": "分镜", "画コンテ": "分镜", "コンテ": "分镜",
    "演出": "动画演出", "動画": "中间动画", "仕上げ": "上色",
    "アニメーション": "动画", "キャラクターデザイン": "角色设计",
    "シナリオディレクター": "剧本总监", "ストーリー構成": "故事构成",
    "シナリオ": "剧本", "プロデュース": "制作策划", "プロデューサー": "制片人",
    "ディレクター": "总监", "アシスタント": "助理", "リードモデラー": "首席建模师",
    "モデリング": "建模", "モデラー": "建模师", "アニメーター": "动画师",
    "メイン": "主要", "アクション": "动作", "プロップデザイン": "道具设计",
    "2D works": "二维制作", "2Dワークス": "二维制作", "2Dデザイン": "二维设计",
    "CGモデル設定": "CG模型设定", "監修": "监修", "総作画監督": "总作画监督",
    "作画監督": "作画监督", "作監": "作画监督", "監督補佐": "导演助理",
    "補佐": "助理", "助手": "助理", "協力": "协力", "検査": "检查",
    "美術": "美术", "背景": "背景", "設定": "设定", "制作": "制作",
    "デスク": "管理", "統括": "统筹", "進行": "统筹", "撮影": "摄影",
    "編集": "剪辑", "特殊効果": "特效", "色彩設計": "色彩设计",
    "色指定": "色彩指定", "音響": "音响", "効果": "效果", "録音": "录音",
    "調整": "调音", "音楽": "音乐", "原作": "原作", "原画": "原画",
    "脚本": "脚本", "企画": "企划", "構成": "构成", "製作": "出品", "配給": "发行",
    "宣伝": "宣传", "広告": "广告", "担当": "负责", "資料": "资料", "写真": "照片", "文": "文字",
    "設計": "设计", "振付": "编舞", "ライブ": "演出舞台", "パート": "部分",
    "シーン": "场景", "レイアウト": "构图", "L/O": "构图", "アイキャッチ": "过场动画",
    "サウンドアドバイザー": "声音顾问", "コンテンツ": "内容",
    "タイトルロゴデザイン": "标题标志设计", "タイトルロゴ": "标题标志设计",
    "デザイン": "设计", "オンライン": "联机", "オフライン": "离线",
    "デジタルシネママスタリング": "数字电影母版制作", "デジタルラボ": "数字后期",
    "ラボコーディネーター": "后期协调", "ローカル": "地方", "予告編": "预告片",
    "ツール開発": "工具开发", "管理": "管理", "フロアマネージャー": "现场经理",
    "メディア": "媒体", "ライセンス": "授权", "公式SNS運用": "官方社交媒体运营",
    "公式サイト": "官方网站", "公式ノベライズ": "官方小说改编",
    "ナレーション": "旁白", "漫画（作画）": "漫画作画", "漫画（脚本）": "漫画脚本",
    "漫画": "漫画", "台本製作": "台本制作", "スタジオ": "录音室",
    "Directed by": "指导", "Mixed at": "混音场所", "Recorded at": "录音场所",
    "Music Recording & Mixing Engineer": "音乐录音与混音工程师",
    "Music Scoring Recordist": "配乐录音师", "Musician's Coordinate": "乐手协调",
    "Orchestrator": "管弦乐编配", "Production Assistait": "制作助理", "Production Assistant": "制作助理",
    "Programming & All Other Instruments": "程序编曲与其他乐器",
    "Score, Programming & Sampling Team": "乐谱、程序编曲与采样团队",
    "Special Thanks": "特别鸣谢", "Strings": "弦乐", "Artist Management": "艺人管理",
    "Acoustic & Electric Bass, Guitarron": "原声与电贝斯、墨西哥低音吉他",
    "Acoustic & Electric Guitar": "原声与电吉他", "WEB": "网站",
    "エグゼクティブプロデューサー": "执行制片人", "アソシエイトプロデューサー": "联合制片人",
    "ラインプロデューサー": "制片主任", "制作庶務": "制作庶务", "制作事務": "制作事务",
    "フランス語監修": "法语监修", "外国語監修": "外语监修", "筆文字": "毛笔字", "フォント協力": "字体协力", "販売促進": "销售推广",
    "キャスティングマネージャー": "配音选角管理", "サウンドミキサー": "声音混音",
    "ライブステージ": "舞台", "ライブ振付": "舞台编舞",
    "チーフプロデューサー": "首席制片人", "ミキシングエンジニア": "混音工程师", "タイアップ": "联动合作", "エンジニア": "工程师",
    "モーションキャプチャー": "动作捕捉", "モニターワークス": "屏幕影像制作",
    "マネージャー": "经理", "ステージ": "舞台",
    "サウンドエディター": "声音剪辑", "国内配信": "日本上线", "国内ライセンス": "日本授权",
    "海外ライセンス": "海外授权", "契約管理": "合同管理", "パッケージ制作": "包装制作",
    "番組宣伝": "节目宣传", "ビデオグラム制作・宣伝": "影碟制作与宣传",
    "プロモーションムービー": "宣传影片", "オリジナルキャラクターデザイン": "原始角色设计",
    "アイキャッチ・サブタイトルデザイン": "过场动画与副标题设计", "PV制作": "宣传片制作",
    "作画指導": "作画指导", "原作担当編集": "原作责任编辑", "原作編集協力": "原作编辑协力",
    "ファンファーレ音源協力": "号角音源协力", "録音調整": "录音调音",
    "衣装": "服装", "フィニッシュワーク": "后期收尾", "フィニッシング": "后期收尾", "モーショングラフィックス": "动态图形", "モーション": "动态制作",
}


_ROLE_PATTERN = re.compile("|".join(re.escape(key) for key in sorted(ROLES, key=len, reverse=True)))


@lru_cache(maxsize=512)
def role_label(raw):
    value = re.sub(r"<[^>]*>", "", html.unescape(raw)).strip()
    # Longest phrases first prevent overlapping job names from being split.
    return _ROLE_PATTERN.sub(lambda match: ROLES[match.group()], value).replace("･", "／").replace("・", "／").replace("/", "／")


ROLE_UNSPLIT = frozenset({
    # These phrases are atomic even though their punctuation resembles a
    # credit separator.  L/O itself is handled as a mapped role so it can
    # still be combined with a neighbouring 原画 credit.
    "アイキャッチ・サブタイトルデザイン", "海外・配信セールス", "ビデオグラム制作・宣伝",
})

# A trailing modifier can apply to every duty in the cell.  Do not interpret
# ``録音・調整助手`` as a main recording engineer plus an assistant mixer.
COMPOUND_ROLE_LABELS = {
    "録音・調整助手": ("录音助理", "调音助理"),
    "録音調整": ("录音", "调音"),
}


def role_labels(raw, group=""):
    """Return canonical atomic jobs while retaining the source string elsewhere.

    Japanese end credits commonly put two independently searchable jobs in one
    cell (for example ``総作画監督／色彩設計``).  Split only on the explicit
    credit separators after translating each component; phrases such as
    ``Music Recording & Mixing Engineer`` remain one job.
    """
    source = re.sub(r"<[^>]*>", "", html.unescape(raw)).strip()
    if source in COMPOUND_ROLE_LABELS:
        return list(COMPOUND_ROLE_LABELS[source])
    protected = {}
    for index, token in enumerate(("L/O", *ROLE_UNSPLIT)):
        marker = f"__ROLE_PART_{index}__"
        if token in source:
            source = source.replace(token, marker)
            protected[marker] = token
    # Split the source credit before translation.  Splitting the translated
    # value would corrupt a translated single role containing punctuation.
    parts = re.split(r"[／/･・]", source)
    return list(dict.fromkeys(role_label_for_group(protected.get(part.strip(), part.strip()), group) for part in parts if part.strip()))


@lru_cache(maxsize=1024)
def role_key(raw, group=""):
    """Stable canonical key used by all import deduplication paths."""
    return tuple(sorted(role_labels(raw, group)))


def role_label_for_group(raw, group=""):
    """Translate roles whose meaning depends on the credit section."""
    if raw == "Directed by" and group in ("音楽", "音乐"):
        return "音乐制作指导"
    value = role_label(raw)
    if group in ("モーションキャプチャー", "动作捕捉"):
        if value == "录音室助理":
            return "动作捕捉工作室助理"
        if value == "录音室经理":
            return "动作捕捉工作室经理"
    return value


def person_label(raw):
    value = re.sub(r"<[^>]*>", "", html.unescape(raw)).strip()
    return re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", value)


def person_name_key(value):
    """Normalize a person spelling for exact identity lookups.

    This is deliberately conservative: it normalizes Unicode presentation and
    known glyph variants, but never folds Latin punctuation/case or guesses that
    two otherwise different credited spellings are the same person.
    """
    value = person_label(value)
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value)).translate(
        str.maketrans("髙﨑𠮷鷄", "高崎吉鶏")
    )


def person_identity_lookup(people, staff):
    """Return a conservative canonical-person resolver shared by importers.

    ``people`` is the authority. ``alias_ids`` resolve retired staff IDs, while
    a credited spelling is usable only when exactly one existing canonical ID
    has carried it. Ambiguous spellings and unseen OCR variants return None.
    """
    by_id = {person["id"]: person for person in people}
    by_name = {}
    name_conflicts = set()
    for person in people:
        for name in (person.get("name", ""), *person.get("aliases", [])):
            key = person_name_key(name)
            prior = by_name.get(key)
            if prior and prior["id"] != person["id"]:
                name_conflicts.add(key)
            else:
                by_name[key] = person
    alias_candidates = {}
    for person in people:
        for alias_id in person.get("alias_ids", []):
            alias_candidates.setdefault(alias_id, set()).add(person["id"])
    alias_conflicts = {alias_id for alias_id, ids in alias_candidates.items() if len(ids) > 1}
    by_alias_id = {
        alias_id: next(person for person in people if person["id"] == next(iter(ids)))
        for alias_id, ids in alias_candidates.items()
        if alias_id not in alias_conflicts
    }
    credited_ids = {}
    credited_conflicts = set()
    for credit in staff:
        person_id = credit.get("person_id")
        credited_name = credit.get("credited_name")
        if not person_id or person_id not in by_id or not credited_name:
            continue
        key = person_name_key(credited_name)
        prior = credited_ids.get(key)
        if prior and prior != person_id:
            credited_conflicts.add(key)
        else:
            credited_ids[key] = person_id

    def find(name):
        key = person_name_key(name)
        if key in name_conflicts:
            raise ValueError(f"ambiguous canonical person spelling: {name}")
        person = by_name.get(key)
        if person:
            return person
        alias_id = "staff-" + key
        if alias_id in alias_conflicts:
            raise ValueError(f"ambiguous historical person ID: {alias_id}")
        person = by_alias_id.get("staff-" + key)
        if person:
            return person
        if key in credited_conflicts:
            raise ValueError(f"ambiguous credited person spelling: {name}")
        if key in credited_ids:
            return by_id[credited_ids[key]]
        return None

    return find, by_name


def organization_label(raw):
    """Unify verified spelling variants without changing the recorded signature."""
    value = re.sub(r"<[^>]*>", "", html.unescape(raw)).strip()
    return {
        "Roll2": "ROLL2",
        "Cygames Pictures": "CygamesPictures",
        "Clover Works": "CloverWorks",
        "WITSTUDIO": "WIT STUDIO",
        "T2Studio": "T2 studio",
        "T2studio": "T2 studio",
        "フィズサウンド クリエイション": "フィズサウンドクリエイション",
        "草薙(KUSANAGI)": "草薙（KUSANAGI）",
        "WHITE FOX 伊豆高原スタジオ": "WHITE FOX伊豆高原スタジオ",
        "Rebuilding Quanta 株式会社": "Rebuilding Quanta株式会社",
        "DRmovie": "DRMOVIE",
    }.get(value, value)


def music_usage(raw):
    return {"ending": "ed", "ending_theme": "ed", "opening": "op", "opening_theme": "op"}.get(raw, raw)


def group_label(raw):
    if any(token in raw for token in ("片尾署名", "片尾職員", "公式 Staff", "公式Staff", "官网单集", "官网作品")):
        return ""
    if raw in ("片头动画", "片头动画制作") or raw.startswith("オープニング"):
        return "片头动画"
    if raw in ("片尾动画", "片尾动画制作") or raw.startswith("エンディング"):
        return "片尾动画"
    # These are credit-sheet containers rather than duties.  Keeping them as a
    # separate UI group made the same job appear multiple times in a season.
    return {"本編": "", "本篇": "", "音響": "", "音响": "", "制作": "", "": "", "音楽": "音乐", "资料协力": "资料协力", "資料協力": "资料协力", "ライブパート": "舞台动画",
            "モーションキャプチャー": "动作捕捉"}.get(raw, raw)
