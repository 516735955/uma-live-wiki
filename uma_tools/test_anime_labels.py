import json
import re
import unittest

from anime_labels import (group_label, person_identity_lookup, person_name_key,
                          role_key, role_labels, role_label)
from import_anime_ending_credits import merge_music_credits


class AnimeLabelTests(unittest.TestCase):
    def test_music_duties_merge_without_merging_different_institutions(self):
        composer = {"role": "作曲", "names": ["原署名"], "creator_ids": ["one"], "institutions": ["MONACA"]}
        combined = {**composer, "role": "作曲／编曲", "names": ["规范姓名"]}
        other = {**composer, "institutions": ["other"]}
        rows = merge_music_credits([combined, composer, other])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["role"], "作曲／编曲")
        self.assertEqual(rows[0]["names"], ["规范姓名"])
        self.assertEqual(rows[1]["institutions"], ["other"])

    def test_compound_credit_is_atomic_and_raw_label_stays_available(self):
        self.assertEqual(role_label("総作画監督／色彩設計"), "总作画监督／色彩设计")
        self.assertEqual(role_labels("総作画監督／色彩設計"), ["总作画监督", "色彩设计"])
        self.assertEqual(role_key("総作画監督／色彩設計"), ("总作画监督", "色彩设计"))
        self.assertEqual(role_key("色彩設計・総作画監督"), role_key("総作画監督／色彩設計"))
        self.assertEqual(role_labels('アニメーション&lt;br class="visible-sp"&gt;プロデューサー'), ["动画制片人"])

    def test_producer_responsibilities_do_not_collapse(self):
        self.assertEqual(role_labels("制作プロデューサー"), ["制作制片人"])
        self.assertEqual(role_labels("アニメーションプロデューサー"), ["动画制片人"])
        self.assertEqual(role_labels("音楽プロデューサー"), ["音乐制片人"])
        self.assertEqual(role_labels("録音・調整助手"), ["录音助理", "调音助理"])
        self.assertEqual(role_labels("Directed by", "音楽"), ["音乐制作指导"])
        self.assertEqual(role_key("録音調整"), role_key("録音・調整"))
        self.assertEqual(role_key("3Dモデラー"), role_key("3Dモデリング"))
        self.assertEqual(role_key("3DCGモデラー"), role_key("3Dモデラー"))
        self.assertEqual(role_key("3D CG"), role_key("3DCG"))
        self.assertEqual(role_labels("タイトルロゴ"), ["标题标志设计"])
        self.assertEqual(role_labels("タイトルロゴデザイン"), ["标题标志设计"])
        self.assertEqual(role_labels("音響制作担当"), ["音响制作负责"])

    def test_container_groups_share_default_scope(self):
        for value in ("", "本編", "本篇", "音響", "音响", "制作"):
            self.assertEqual(group_label(value), "")
        self.assertEqual(group_label("オープニングアニメーション"), "片头动画")

    def test_person_lookup_uses_alias_ids_and_rejects_unconfirmed_ocr(self):
        people = [
            {"id": "staff-canonical", "name": "小木曽", "aliases": [],
             "alias_ids": ["staff-小木曾"]},
        ]
        staff = [{"person_id": "staff-canonical", "credited_name": "小木曽"}]
        find, _ = person_identity_lookup(people, staff)
        self.assertEqual(find("小木曾")["id"], "staff-canonical")
        self.assertIsNone(find("小木曾晃"))

    def test_person_lookup_does_not_pick_an_ambiguous_credited_name(self):
        people = [
            {"id": "staff-a", "name": "甲", "aliases": [], "alias_ids": []},
            {"id": "staff-b", "name": "乙", "aliases": [], "alias_ids": []},
        ]
        staff = [
            {"person_id": "staff-a", "credited_name": "同音名"},
            {"person_id": "staff-b", "credited_name": "同音名"},
        ]
        find, _ = person_identity_lookup(people, staff)
        with self.assertRaisesRegex(ValueError, "ambiguous credited person spelling"):
            find("同音名")
        self.assertEqual(person_name_key("髙﨑𠮷鷄"), "高崎吉鶏")

    def test_person_lookup_rejects_an_alias_id_shared_by_people(self):
        people = [
            {"id": "staff-a", "name": "甲", "aliases": [], "alias_ids": ["staff-old"]},
            {"id": "staff-b", "name": "乙", "aliases": [], "alias_ids": ["staff-old"]},
        ]
        find, _ = person_identity_lookup(people, [])
        with self.assertRaisesRegex(ValueError, "ambiguous historical person ID"):
            find("old")

    def test_all_accepted_compound_roles_have_meaningful_atomic_labels(self):
        with open("data/anime/staff.json", encoding="utf-8") as handle:
            credits = json.load(handle)["credits"]
        compound = sorted({row["role"] for row in credits if re.search(r"[／/･・]", row["role"])})
        self.assertTrue(compound)
        for raw in compound:
            labels = role_labels(raw)
            self.assertTrue(labels, raw)
            self.assertTrue(all(label and not re.search(r"[\u3040-\u30ff]", label) for label in labels), raw)
            self.assertTrue(all("／" not in label for label in labels), raw)
        self.assertEqual(role_labels("L/O"), ["构图"])
        self.assertEqual(role_labels("アイキャッチ・サブタイトルデザイン"), ["过场动画与副标题设计"])
        self.assertEqual(role_labels("海外・配信セールス"), ["海外与流媒体销售"])
        self.assertEqual(role_labels("ビデオグラム制作・宣伝"), ["影碟制作与宣传"])


if __name__ == "__main__":
    unittest.main()
