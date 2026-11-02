#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
三百首游 · 数据构建脚本
=======================

把飞书「三百首」「解析」两张表的导出 NDJSON 转成游戏用的 cards.json / cards.js。

用法（三种任选）：

  1) 直接读已有导出：
     python build_cards.py --songs raw_songs.ndjson --parses raw_parses.ndjson

  2) 从飞书现拉（需要本机已装并登录 lark-cli）：
     python build_cards.py --from-feishu

  3) 只给一个目录，脚本自己找 raw_songs.ndjson / raw_parses.ndjson：
     python build_cards.py --dir .

输出（写到脚本所在目录的上一级 data/ 下）：
  data/cards.json   给程序读
  data/cards.js     给网页 <script> 直接读（双击 index.html 也能跑）
  data/build_report.txt  本次构建的统计报告

设计约定
--------
* 字段名采用「别名表」容错：飞书里改过名的列（例如「解析（请到解析模块查看）」
  演变为「解析 / 解析数 / 解析有无」）不会让脚本崩。新增列只要在 ALIASES 里补一行。
* 所有原始字段另外完整保留在 card["raw"] 里，未来加新玩法不必重跑飞书。
* 歌与解析的关联优先用飞书的 link 字段（解析 列的 record_id），
  拿不到 link 时才退回按歌名匹配。
* 脚本只读输入，不删除任何文件；输出是整体覆盖 data/ 下两个数据文件（有备份）。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 飞书 Base 与两张表的 ID 不进仓库：放在项目根的 feishu.json（已在 .gitignore 里），
# 或通过环境变量 SB_BASE_TOKEN / SB_TABLE_SONGS / SB_TABLE_PARSES 提供。
# 仓库里只有 feishu.example.json 这个模板。
BASE_TOKEN = ""
TABLE_SONGS = ""
TABLE_PARSES = ""


def load_feishu_config():
    """读飞书表配置：feishu.json → 环境变量。返回 (base, songs, parses)。"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = {}
    cfg_path = os.path.join(root, "feishu.json")
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, encoding="utf-8") as f:
                cfg = json.load(f) or {}
        except Exception as e:
            print("  [warn] feishu.json 解析失败，忽略：%s" % e)
    tables = cfg.get("tables") or {}
    base = cfg.get("baseToken") or os.environ.get("SB_BASE_TOKEN", "")
    songs = tables.get("songs") or os.environ.get("SB_TABLE_SONGS", "")
    parses = tables.get("parses") or os.environ.get("SB_TABLE_PARSES", "")
    return base, songs, parses

# ---------------------------------------------------------------- 字段别名
# 左：规范化后的键；右：飞书里可能出现的列名（按优先级）
ALIASES = {
    "name":        ["歌曲", "歌名", "曲名"],
    "year":        ["年份", "发行年份"],
    "date":        ["日期", "发行日期"],
    "type":        ["类型（尝试）", "类型", "类型(尝试)"],
    "subjects":    ["历史主体", "历史主体/题材", "题材"],
    "lyricist":    ["作词", "词"],
    "composer":    ["作曲", "曲"],
    "arranger":    ["编曲"],
    "singer":      ["演唱（含人本）", "演唱", "演唱(含人本)"],
    "tuner":       ["调校"],
    "staff":       ["staff集合", "staff"],
    "duos":        ["staff组", "staff组合", "staff组集合"],
    "voicebank":   ["声库"],
    "isVirtual":   ["是否中V", "中V"],
    "special":     ["特别篇"],
    "batch":       ["批次"],
    "dateSource":  ["日期考证"],
    "noteLinks":   ["解析", "解析链接"],
    "noteCount":   ["解析数"],
    "hasNote":     ["解析有无", "解析（请到解析模块查看）"],
    "p5sing":      ["5sing(默认为无)", "5sing"],
    "pqg":         ["qg(默认为有)", "qg"],
    "pqq":         ["qq(默认为有)", "qq"],
    "pwyy":        ["wyy(默认为有)", "wyy"],
    # 解析表
    "aSong":       ["歌名", "歌曲"],
    "aBy":         ["解读人", "作者"],
    "aPlatform":   ["平台"],
    "aAddr":       ["地址", "链接"],
    "aDate":       ["解读日期", "日期"],
    "aImage":      ["参考图片"],
    "aLyricist":   ["作词"],
    "aVirtual":    ["中V"],
}

ERAS = [
    ("创世", 2008, 2012),
    ("萌发", 2013, 2015),
    ("兴盛", 2016, 2018),
    ("极盛", 2019, 2020),
    ("新声", 2021, 2023),
    ("复兴", 2024, 2026),
]


def pick(row, key, default=None):
    """按别名表取第一个存在的字段；支持 list 值解包。"""
    for name in ALIASES.get(key, [key]):
        if name in row and row[name] is not None:
            v = row[name]
            if isinstance(v, list):
                return v
            return v
    return default if default is not None else []


def as_list(row, key):
    v = pick(row, key, [])
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip() not in ("", "None")]
    if v in ("", None):
        return []
    return [str(v).strip()]


def as_csv_list(row, key):
    """飞书公式列常把多个名字用逗号拼成一个字符串，这里拆开。"""
    out = []
    for item in as_list(row, key):
        for part in item.replace("，", ",").split(","):
            part = part.strip()
            if part and part not in out:
                out.append(part)
    return out


def as_text(row, key, default=""):
    v = pick(row, key, default)
    if isinstance(v, list):
        return str(v[0]).strip() if v else default
    return str(v).strip() if v not in (None, "") else default


def as_int(row, key, default=0):
    v = pick(row, key, default)
    if isinstance(v, list):
        v = v[0] if v else default
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def load_ndjson(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def era_of(year):
    for i, (_label, lo, hi) in enumerate(ERAS):
        if lo <= year <= hi:
            return i
    return len(ERAS) - 1


def norm_addr(platform, addr):
    """把解析地址规整成可点击链接（做不到就给空）。"""
    addr = (addr or "").strip()
    if not addr:
        return ""
    if addr.startswith("http://") or addr.startswith("https://"):
        return addr
    p = platform or ""
    if "bilibili" in p or "B站" in p:
        m = re.search(r"cv(\d+)", addr, re.I)
        if m:
            return "https://www.bilibili.com/read/cv%s" % m.group(1)
        if re.fullmatch(r"BV[0-9A-Za-z]{10}", addr):
            return "https://www.bilibili.com/video/%s" % addr
        if re.fullmatch(r"\d+", addr):
            return "https://www.bilibili.com/video/BV%s" % addr if len(addr) == 10 else ""
    if "小红书" in p:
        m = re.search(r"([0-9a-f]{24})", addr)
        if m:
            return "https://www.xiaohongshu.com/explore/%s" % m.group(1)
    return ""


def build_parse_index(parses):
    """按 record_id 与歌名两个索引，供关联使用。"""
    by_id, by_name = {}, defaultdict(list)
    for r in parses:
        rid = r.get("record_id") or r.get("recordId") or ""
        item = {
            "id": rid,
            "song": as_text(r, "aSong"),
            "by": as_list(r, "aBy"),
            "platform": as_text(r, "aPlatform"),
            "addr": as_text(r, "aAddr"),
            "url": norm_addr(as_text(r, "aPlatform"), as_text(r, "aAddr")),
            "date": as_text(r, "aDate")[:10],
            "images": len(as_list(r, "aImage")),
        }
        if rid:
            by_id[rid] = item
        if item["song"]:
            by_name[item["song"]].append(item)
    # 同名多条按日期倒序，最新在前
    for k in by_name:
        by_name[k].sort(key=lambda x: x["date"], reverse=True)
    return by_id, by_name


def consumed_keys():
    """所有被映射消费的飞书列名，剩下的才进 raw（留给未来加列）。"""
    keys = set()
    for names in ALIASES.values():
        keys.update(names)
    keys.add("record_id")
    return keys


def build(songs, parses):
    by_id, by_name = build_parse_index(parses)
    out, issues = [], []
    known = consumed_keys()

    for r in songs:
        name = as_text(r, "name")
        if not name:
            continue
        year = as_int(r, "year", 0)
        type_raw = as_text(r, "type")
        type_group = type_raw.split("-")[0].split("－")[0].strip() if type_raw else "未分类"

        # --- 解析关联：优先 link record_id，其次歌名
        notes = []
        for ref in (pick(r, "noteLinks", []) or []):
            if isinstance(ref, dict):
                rid = ref.get("id") or ref.get("record_id")
                if rid and rid in by_id:
                    notes.append(by_id[rid])
        if not notes:
            notes = list(by_name.get(name, []))
        # 去重
        seen, uniq = set(), []
        for n in notes:
            key = n.get("id") or (n.get("by"), n.get("date"))
            if key in seen:
                continue
            seen.add(key)
            uniq.append(n)
        notes = uniq

        has_note_flag = as_list(r, "hasNote")
        declared = "有" in has_note_flag
        if declared and not notes:
            issues.append("「%s」标记为有解析，但未关联到解析记录" % name)

        platforms = {
            "5sing": as_text(r, "p5sing") or "无",
            "qg":    as_text(r, "pqg") or "有",
            "qq":    as_text(r, "pqq") or "有",
            "wyy":   as_text(r, "pwyy") or "有",
        }
        # 5sing 字段语义是「默认为无」，其余「默认为有」
        available = []
        if platforms["5sing"] == "有":
            available.append("5sing")
        for k, label in (("qg", "酷狗"), ("qq", "QQ音乐"), ("wyy", "网易云")):
            if platforms[k] != "无":
                available.append(label)

        card = {
            "id": r.get("record_id", ""),
            "name": name,
            "year": year,
            "date": as_text(r, "date")[:10],
            "type": type_raw,
            "typeGroup": type_group,
            "subjects": as_list(r, "subjects"),
            "lyricist": as_list(r, "lyricist"),
            "composer": as_list(r, "composer"),
            "arranger": as_list(r, "arranger"),
            "singer": as_list(r, "singer"),
            "tuner": as_list(r, "tuner"),
            "staff": as_csv_list(r, "staff"),
            "duos": as_csv_list(r, "duos"),
            "voicebank": as_list(r, "voicebank"),
            "isVirtual": "是" in as_list(r, "isVirtual"),
            "isSpecial": "特别篇" in as_list(r, "special"),
            "batch": as_text(r, "batch"),
            "dateSource": as_text(r, "dateSource"),
            "platforms": platforms,
            "available": available,
            "era": era_of(year),
            "notes": notes,
            "noteCount": len(notes),
            "hasNote": bool(notes) or declared,
            # 未识别的新增列完整保留，未来加玩法不必重跑飞书
            "extra": {k: v for k, v in r.items() if k not in known and v not in (None, "", [])},
        }
        if not card["date"] and card["year"]:
            card["date"] = "%d" % card["year"]
        out.append(card)

    out.sort(key=lambda c: (c["year"], c["name"]))
    return out, issues


def report(cards, parses_raw):
    L = []
    add = L.append
    add("=" * 60)
    add("三百首游 · 数据构建报告")
    add("生成时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    add("=" * 60)
    add("")
    add("【总量】")
    add("  歌曲卡片：%d 首" % len(cards))
    add("  解析记录：%d 条（去重歌名 %d 个）"
        % (len(parses_raw), len({as_text(p, 'aSong') for p in parses_raw if as_text(p, 'aSong')})))
    add("  已关联解析的卡片：%d 首（%.1f%%）"
        % (sum(1 for c in cards if c["noteCount"]), 100.0 * sum(1 for c in cards if c["noteCount"]) / max(1, len(cards))))
    add("")
    add("【年份 / 编年段】")
    eras = Counter(c["era"] for c in cards)
    for i, (label, lo, hi) in enumerate(ERAS):
        add("  %d %s（%d-%d）：%3d 首" % (i, label, lo, hi, eras.get(i, 0)))
    add("")
    add("【类型】")
    for k, v in Counter(c["type"] for c in cards).most_common():
        add("  %-12s %3d" % (k or "(空)", v))
    add("")
    add("【类型大类】")
    for k, v in Counter(c["typeGroup"] for c in cards).most_common():
        add("  %-8s %3d" % (k, v))
    add("")
    add("【属性】")
    add("  特别篇：%d 首 | 中V：%d 首 | 有历史主体：%d 首"
        % (sum(1 for c in cards if c["isSpecial"]),
           sum(1 for c in cards if c["isVirtual"]),
           sum(1 for c in cards if c["subjects"])))
    add("  有作词：%d | 有作曲：%d | 有编曲：%d | 有演唱：%d | 有调校：%d"
        % tuple(sum(1 for c in cards if c[k]) for k in ("lyricist", "composer", "arranger", "singer", "tuner")))
    add("")
    add("【创作者集中度 Top12 — 作词】")
    for k, v in Counter(x for c in cards for x in c["lyricist"]).most_common(12):
        add("  %-14s %3d" % (k, v))
    add("【创作者集中度 Top12 — 作曲】")
    for k, v in Counter(x for c in cards for x in c["composer"]).most_common(12):
        add("  %-14s %3d" % (k, v))
    add("【演唱 Top10】")
    for k, v in Counter(x for c in cards for x in c["singer"]).most_common(10):
        add("  %-14s %3d" % (k, v))
    add("")
    add("【可凑双璧的历史主体（≥2 首）】")
    sub = Counter(x for c in cards for x in c["subjects"])
    multi = [(k, v) for k, v in sub.most_common() if v >= 2]
    add("  共 %d 个：" % len(multi))
    for k, v in multi[:20]:
        add("  %-14s %d" % (k, v))
    add("")
    add("【批次】")
    for k, v in Counter(c["batch"] for c in cards).most_common():
        add("  %-6s %3d" % (k or "(空)", v))
    add("")
    add("【平台覆盖】")
    pc = Counter(len(c["available"]) for c in cards)
    for k in sorted(pc):
        add("  %d 个平台可听：%d 首" % (k, pc[k]))
    add("")
    add("【数据完整度】")
    for f in ("date", "type", "batch", "dateSource"):
        miss = sum(1 for c in cards if not c[f])
        add("  %-12s 缺失 %d" % (f, miss))
    add("")
    return "\n".join(L)


def find_lark_cli():
    """找 lark-cli：项目内配置 → PATH → WorkBuddy 自带位置。

    WorkBuddy 把 lark-cli 装在自己的 binaries 目录，不在系统 PATH 里；
    直接双击 .bat 时 PATH 与开发终端不同，所以必须多找几处。
    """
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = os.path.join(root, "lark-cli.txt")
    if os.path.exists(cfg):
        with open(cfg, encoding="utf-8") as f:
            p = f.read().strip().strip('"')
        if p and os.path.exists(p):
            return p

    names = ["lark-cli.cmd", "lark-cli.exe", "lark-cli"] if os.name == "nt" else ["lark-cli"]
    for name in names:
        p = shutil.which(name)
        if p:
            return p

    home = os.path.expanduser("~")
    cands = [
        os.path.join(home, ".workbuddy", "binaries", "node", "cli-connector-packages", "lark-cli.cmd"),
        os.path.join(home, ".workbuddy", "binaries", "node", "cli-connector-packages", "lark-cli"),
        os.path.join(home, "AppData", "Roaming", "npm", "lark-cli.cmd"),
    ]
    for p in cands:
        if os.path.exists(p):
            return p
    return None


def find_node_dir():
    """lark-cli.cmd 内部会调用 node；WorkBuddy 的 node 不在系统 PATH，得自己补上。"""
    home = os.path.expanduser("~")
    base = os.path.join(home, ".workbuddy", "binaries", "node")
    cands = [os.path.join(base, "current")]
    vers = os.path.join(base, "versions")
    if os.path.isdir(vers):
        cands += [os.path.join(vers, v) for v in sorted(os.listdir(vers), reverse=True)]
    for d in cands:
        if os.path.exists(os.path.join(d, "node.exe")) or os.path.exists(os.path.join(d, "node")):
            return d
    return None


def fetch_from_feishu(tmpdir):
    """调用 lark-cli 现拉两张表。返回 (songs_path, parses_path)。

    Windows 上 lark-cli 是 .CMD 包装脚本，subprocess 直接执行会报 WinError 2，
    所以走 shell=True 并把可执行文件路径整体加引号。
    """
    exe = find_lark_cli()
    if not exe:
        raise RuntimeError(
            "找不到 lark-cli。三条出路：\n"
            "  1) 把 lark-cli 的完整路径写进「三百首游\\lark-cli.txt」（一行即可）\n"
            "  2) 让 lark-cli 进入系统 PATH\n"
            "  3) 手动导出两张表为 NDJSON，再跑 --songs / --parses\n"
            "本机常见位置：%USERPROFILE%\\.workbuddy\\binaries\\node\\cli-connector-packages\\lark-cli.cmd"
        )
    base, t_songs, t_parses = load_feishu_config()
    if not (base and t_songs and t_parses):
        raise RuntimeError(
            "缺少飞书表配置。两种办法：\n"
            "  1) 复制 feishu.example.json 为 feishu.json，填好 baseToken 与两张表的 tableId\n"
            "  2) 设置环境变量 SB_BASE_TOKEN / SB_TABLE_SONGS / SB_TABLE_PARSES\n"
            "（feishu.json 已在 .gitignore 里，不会被提交）"
        )
    print("  使用 lark-cli：%s" % exe)
    pairs = [("raw_songs.ndjson", t_songs), ("raw_parses.ndjson", t_parses)]
    for fname, tid in pairs:
        out = os.path.join(tmpdir, fname)
        cmd = '"%s" base +record-list --base-token %s --table-id %s --format ndjson --output "%s" --as user' % (
            exe, base, tid, out)
        print("  拉取 %s ..." % tid)
        env = os.environ.copy()
        nd = find_node_dir()
        if nd:
            env["PATH"] = nd + os.pathsep + env.get("PATH", "")
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=env)
        if r.returncode != 0 or not os.path.exists(out):
            raise RuntimeError("拉取失败：%s\n%s\n%s" % (tid, (r.stdout or "")[-800:], (r.stderr or "")[-800:]))
        rows = sum(1 for _ in open(out, encoding="utf-8"))
        print("    -> %d 条" % rows)
    return os.path.join(tmpdir, "raw_songs.ndjson"), os.path.join(tmpdir, "raw_parses.ndjson")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(os.path.dirname(here), "data")
    ap = argparse.ArgumentParser()
    ap.add_argument("--songs")
    ap.add_argument("--parses")
    ap.add_argument("--dir")
    ap.add_argument("--from-feishu", action="store_true")
    ap.add_argument("--out", default=data_dir)
    args = ap.parse_args()

    tmp_holder = None
    if args.from_feishu:
        tmp_holder = tempfile.mkdtemp(prefix="sanbaishou_")
        songs_path, parses_path = fetch_from_feishu(tmp_holder)
    elif args.songs and args.parses:
        songs_path, parses_path = args.songs, args.parses
    elif args.dir:
        songs_path = os.path.join(args.dir, "raw_songs.ndjson")
        parses_path = os.path.join(args.dir, "raw_parses.ndjson")
    else:
        # 默认在脚本目录、data 目录、上一级找
        cands = [here, data_dir, os.path.dirname(here)]
        songs_path = parses_path = None
        for d in cands:
            s = os.path.join(d, "raw_songs.ndjson")
            p = os.path.join(d, "raw_parses.ndjson")
            if os.path.exists(s) and os.path.exists(p):
                songs_path, parses_path = s, p
                break
        if not songs_path:
            print("找不到 raw_songs.ndjson / raw_parses.ndjson。")
            print("请用 --from-feishu 现拉，或 --songs/--parses 指定文件。")
            return 1

    print("读取：%s" % songs_path)
    print("读取：%s" % parses_path)
    songs = load_ndjson(songs_path)
    parses = load_ndjson(parses_path)
    cards, issues = build(songs, parses)

    os.makedirs(args.out, exist_ok=True)
    payload = {
        "meta": {
            "schemaVersion": 1,
            "title": "三百首·词宗",
            "source": "飞书多维表格「三百首」+「解析」",
            "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "songsCount": len(cards),
            "annotationsCount": len(parses),
            "eras": [{"label": l, "from": lo, "to": hi} for l, lo, hi in ERAS],
        },
        "cards": cards,
    }

    jpath = os.path.join(args.out, "cards.json")
    jspath = os.path.join(args.out, "cards.js")
    for p in (jpath, jspath):
        if os.path.exists(p):
            shutil.copy2(p, p + ".bak")

    with open(jpath, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1, sort_keys=False)
        f.write("\n")
    with open(jspath, "w", encoding="utf-8") as f:
        f.write("/* 自动生成，请勿手改。更新方法见 tools/build_cards.py */\n")
        f.write("window.GAME_DATA = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    rep = report(cards, parses)
    if issues:
        rep += "\n【待核对】\n" + "\n".join("  - " + x for x in issues[:40])
        if len(issues) > 40:
            rep += "\n  ... 另有 %d 条" % (len(issues) - 40)
    rep += "\n"
    with open(os.path.join(args.out, "build_report.txt"), "w", encoding="utf-8") as f:
        f.write(rep)
    print(rep)
    print("已写出：%s" % jpath)
    print("已写出：%s" % jspath)

    if tmp_holder:
        shutil.rmtree(tmp_holder, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
