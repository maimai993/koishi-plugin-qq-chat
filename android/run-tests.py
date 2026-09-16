#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""跑通知规则单测（纯 JDK，不需要 Android 设备）：python run-tests.py"""
import os
import shutil
import subprocess
import sys
import glob

PROJ = os.path.dirname(os.path.abspath(__file__))
JDK = os.environ.get('JDK', r'C:\Program Files\Java\jdk-21.0.12')
JAVAC = os.path.join(JDK, 'bin', 'javac.exe')
JAVA = os.path.join(JDK, 'bin', 'java.exe')
OUT = os.path.join(PROJ, 'build', 'test')

shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)

sources = glob.glob(os.path.join(PROJ, 'java', 'com', 'maimai', 'qqchat', 'NotifyLogic.java'))
sources += glob.glob(os.path.join(PROJ, 'test', '*.java'))
subprocess.run([JAVAC, '-encoding', 'UTF-8', '-d', OUT] + sources, check=True)
sys.exit(subprocess.run([JAVA, '-Dfile.encoding=UTF-8', '-cp', OUT, 'NotifyLogicTest']).returncode)
