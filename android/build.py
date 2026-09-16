#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
编译手机 App 的 APK（不依赖 Gradle / AndroidX，只用 SDK 自带的命令行工具）。

  aapt2 compile/link  -> javac -> d8 -> 打包 dex -> zipalign -> apksigner

用法：
  python build.py                # 输出 build/QQChat-1.0.0.apk
  SDK=C:\\android-sdk JDK="C:\\Program Files\\Java\\jdk-21.0.12" python build.py
"""
import glob
import os
import shutil
import subprocess
import sys
import zipfile

PROJ = os.path.dirname(os.path.abspath(__file__))
SDK = os.environ.get('SDK', r'C:\android-sdk')
JDK = os.environ.get('JDK', r'C:\Program Files\Java\jdk-21.0.12')
# build-tools 34 的 d8（R8 8.2.2）在部分类上会内部报错，优先用新版
def pick_build_tools():
    root = os.path.join(SDK, 'build-tools')
    versions = sorted(os.listdir(root), reverse=True) if os.path.isdir(root) else []
    for name in versions:
        if os.path.exists(os.path.join(root, name, 'd8.bat')):
            return os.path.join(root, name)
    return os.path.join(root, '34.0.0')


BT = os.environ.get('BT') or pick_build_tools()
ANDROID_JAR = os.path.join(SDK, 'platforms', 'android-34', 'android.jar')
AAPT2 = os.path.join(BT, 'aapt2.exe')
D8 = os.path.join(BT, 'd8.bat')
ZIPALIGN = os.path.join(BT, 'zipalign.exe')
APKSIGNER = os.path.join(BT, 'apksigner.bat')
JAVAC = os.path.join(JDK, 'bin', 'javac.exe')
KEYTOOL = os.path.join(JDK, 'bin', 'keytool.exe')

VERSION_NAME = '1.0.0'
VERSION_CODE = '1'
MIN_SDK = '24'
TARGET_SDK = '34'
KS_PASS = 'qqchat123'
KS_ALIAS = 'qqchat'

BUILD = os.path.join(PROJ, 'build')


def run(args, **kwargs):
    printable = ' '.join(str(a) for a in args)
    print('>>> ' + printable)
    result = subprocess.run(args, **kwargs)
    if result.returncode != 0:
        print('命令失败，退出码 ' + str(result.returncode))
        sys.exit(result.returncode)


def main():
    for tool in (AAPT2, ANDROID_JAR, JAVAC, D8, ZIPALIGN, APKSIGNER):
        if not os.path.exists(tool):
            print('缺少工具：' + tool)
            sys.exit(1)

    if os.path.exists(BUILD):
        shutil.rmtree(BUILD)
    for sub in ('compiled', 'classes', 'dex', 'gen'):
        os.makedirs(os.path.join(BUILD, sub))

    # 1) 编译资源
    run([AAPT2, 'compile', '--dir', os.path.join(PROJ, 'res'), '-o', os.path.join(BUILD, 'compiled.zip')])

    # 2) 链接资源 + 生成 R.java + 基础 APK
    run([
        AAPT2, 'link',
        '-o', os.path.join(BUILD, 'base.apk'),
        '-I', ANDROID_JAR,
        '--manifest', os.path.join(PROJ, 'AndroidManifest.xml'),
        '-R', os.path.join(BUILD, 'compiled.zip'),
        '--java', os.path.join(BUILD, 'gen'),
        '--min-sdk-version', MIN_SDK,
        '--target-sdk-version', TARGET_SDK,
        '--version-code', VERSION_CODE,
        '--version-name', VERSION_NAME,
        '--auto-add-overlay',
    ])

    # 3) 编译 Java（Java 8 字节码，兼容老设备）
    sources = glob.glob(os.path.join(PROJ, 'java', '**', '*.java'), recursive=True)
    sources += glob.glob(os.path.join(BUILD, 'gen', '**', '*.java'), recursive=True)
    # 用 17 编译（build-tools 34 的 d8 对 8 的某些类会内部报错），d8 再按 minSdk 24 反糖化
    args = [JAVAC, '--release', '17', '-encoding', 'UTF-8', '-nowarn',
            '-classpath', ANDROID_JAR, '-d', os.path.join(BUILD, 'classes')] + sources
    run(args)

    # 4) d8 转 dex
    classes = glob.glob(os.path.join(BUILD, 'classes', '**', '*.class'), recursive=True)
    run([D8, '--lib', ANDROID_JAR, '--min-api', MIN_SDK, '--output', os.path.join(BUILD, 'dex')] + classes)

    # 5) 把 classes.dex 塞进 APK（保持其它条目原样，resources.arsc 必须仍然不压缩）
    unsigned = os.path.join(BUILD, 'unsigned.apk')
    with zipfile.ZipFile(os.path.join(BUILD, 'base.apk'), 'r') as src:
        with zipfile.ZipFile(unsigned, 'w') as dst:
            for item in src.infolist():
                data = src.read(item.filename)
                info = zipfile.ZipInfo(item.filename, date_time=item.date_time)
                info.compress_type = item.compress_type
                info.external_attr = item.external_attr
                dst.writestr(info, data)
            with open(os.path.join(BUILD, 'dex', 'classes.dex'), 'rb') as dex:
                info = zipfile.ZipInfo('classes.dex')
                info.compress_type = zipfile.ZIP_DEFLATED
                dst.writestr(info, dex.read())

    # 6) 对齐
    aligned = os.path.join(BUILD, 'aligned.apk')
    run([ZIPALIGN, '-f', '-p', '4', unsigned, aligned])

    # 7) 签名（首次运行自动生成 keystore）
    keystore = os.path.join(PROJ, 'qqchat-release.jks')
    if not os.path.exists(keystore):
        run([KEYTOOL, '-genkeypair', '-v', '-keystore', keystore, '-alias', KS_ALIAS,
             '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
             '-storepass', KS_PASS, '-keypass', KS_PASS,
             '-dname', 'CN=QQ Chat Android, OU=Dev, O=maimai, L=Beijing, ST=Beijing, C=CN'])
    out_apk = os.path.join(BUILD, 'QQChat-%s.apk' % VERSION_NAME)
    run([APKSIGNER, 'sign', '--ks', keystore, '--ks-key-alias', KS_ALIAS,
         '--ks-pass', 'pass:' + KS_PASS, '--key-pass', 'pass:' + KS_PASS,
         '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
         '--out', out_apk, aligned])

    # 8) 校验
    run([APKSIGNER, 'verify', '--print-certs', out_apk])
    run([AAPT2, 'dump', 'badging', out_apk])

    size = os.path.getsize(out_apk) / 1024.0 / 1024.0
    print('')
    print('APK 已生成：' + out_apk + '（%.2f MB）' % size)


if __name__ == '__main__':
    main()
