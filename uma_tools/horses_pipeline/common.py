"""Common responsibilities for the canonical catalog pipeline."""
from __future__ import annotations



import hashlib


import html as html_lib


import io


import json


import os


import re


import socket


import sys


import tempfile


import time


import urllib.parse


import urllib.request


TOOLS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


ROOT = os.path.dirname(TOOLS_DIR)


DATA_DIR = os.path.join(ROOT, 'data')


PEDIGREE_SOURCE = os.path.join(DATA_DIR, 'pedigree_source.json')


OUT_LIST = os.path.join(DATA_DIR, 'horses_list.js')


OUT_DETAIL = os.path.join(DATA_DIR, 'horses_details.js')


CACHE_DIR = os.path.join(DATA_DIR, 'horses_cache')


LIST_PREFIX = 'window.HORSES = '


DETAIL_PREFIX = 'window.HORSES_DETAIL = '


UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'


PROXY = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or 'http://127.0.0.1:12000'


WIKI_SLEEP = 0.8


JBIS_SLEEP = 0.5


_NON_HORSE_TITLE = re.compile(
    r'の曲|歌曲|のアルバム|アルバム|ゲーム|漫画|小説|映画|曖昧さ回避|曖昧さ一覧|一覧表'
)


_NON_HORSE_WIKI = re.compile(
    r'\[\[(?:Category|カテゴリ|分类|分類):[^\]]*(?:の曲|歌曲|ゲーム|ソフトウェア|楽曲|アルバム|映画|漫画|小説|曖昧さ)'
)


_RACEHORSE_MARK = re.compile(
    r'Infobox\s*(?:racehorse|horse)|競走馬インフォボックス|競走馬情報ボックス'
    r'|\[\[(?:Category|カテゴリ|分类|分類):[^\]]*(?:競走馬|竞赛马|赛马|racehorse)'
    r'|戦績|重賞|GI競走|ダービー|オークス|有馬記念|天皇賞|战绩|一级赛|日本德比|日本打吡'
)


PHOTO_DIR = os.path.join(TOOLS_DIR, 'img', 'horses')


_PHOTO_EXT = ('.jpg', '.jpeg', '.png', '.webp')


_NON_HORSE_PHOTO = re.compile(
    r'statue|tomb|grave|monument|memorial|bust|logo|crest|jockey|owner|pedigree|'
    r'requestpicture|nuvola|placeholder|question|wikipedia|commons|ambox|icon|\.svg|'
    r'墓|銅像|像$|記念|記章|ロゴ', re.I
)


_PLACEHOLDER_MD5 = {'2A396AB5A03C93BDF76D222C157D3239'}


FIELD_ALIASES = {
    'sire': ('sire', '父'),
    'damsire': ('damsire', '母父'),
    'dam': ('dam', '母'),
    'sex': ('sex', '性別', '性别'),
    'foaled': ('foaled', '生年月日', '诞生', '诞辰'),
    'death': ('death_date', '死没', '死亡'),
    'colour': ('colour', '毛色'),
    'breeder': ('breeder', '生産者', '繁殖者', '生产牧场', '生產者'),
    'farm': ('生産牧場', '生產牧場'),
    'owner': ('owner', '馬主', '马主'),
    'trainer': ('trainer', '調教師', '调教师'),
    'stable': ('厩舎', '厩舍'),
    'record': ('record', '戦績', '戰績', '战绩', '通算成績', '通算成绩'),
    'earnings': ('earnings', '獲得賞金', '獲得獎金', '总奖金', '總獎金'),
    'country': ('country', '生産国', '产地', '產地'),
    'origin': ('馬名の由来', '馬名由来', '由來', '由来', '命名'),
}


ZH_PATTERNS = {
    'career': ('出賽前', '出生', '出道', '競賽生涯', '競賽', '戰績', '競走', '赛前'),
    'retirement': ('退役', '引退', '功労', '功劳', '種牡馬', '种马', '晩年', '晚年',
                   '纪念', '紀念', '表彰', '後世', '后世纪念'),
    'breeding': ('子嗣', '産駒', '产驹', '後代', '后代', '愛駒', '爱驹', '血脈'),
    'blood': ('血統', '血统', '家族', '牝系', '母系', '祖先'),
    'origins': ('命名', '由來', '由来', '馬名的由來', '马名的由来'),
}


JA_PATTERNS = {
    'career': ('生い立ち', '戦績', '競走', 'デビュー', '現役'),
    'retirement': ('引退', '種牡馬', '功労', '晩年', '記念', '没後', '死亡', '表彰'),
    'breeding': ('産駒', '子孫', '繁殖'),
    'blood': ('血統', '家系'),
    'origins': ('馬名の由来', '由来'),
}


SKIP_HEADERS = ('相關條目', '相关条目', '參考資料', '参考资料', '外部連結', '外部链接',
                '註釋', '注释', '脚注', '注釈', '出典', '参考文献')


P = {
    'INTRODUCTION', 'career', 'retirement', 'breeding', 'blood', 'origins'
}
