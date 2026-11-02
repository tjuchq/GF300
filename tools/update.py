# -*- coding: utf-8 -*-
"""ASCII-path launcher for tools/build_cards.py.

Windows 的 .bat 用 GBK 解析，中文路径与中文提示会被拆成乱码指令，
所以把真正的调用放在这个纯 ASCII 路径的脚本里，.bat 只负责 chcp + 调用。
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "tools", "build_cards.py")

if not os.path.exists(BUILD):
    print("[FAIL] 找不到构建脚本：%s" % BUILD)
    sys.exit(2)

args = [sys.executable, BUILD] + (sys.argv[1:] or ["--from-feishu"])
sys.exit(subprocess.call(args))
