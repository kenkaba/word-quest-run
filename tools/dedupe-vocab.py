#!/usr/bin/env python3
"""WORD QUEST RUN — 語彙ファイルの重複除去ツール

vocab.js / vocab-ext.js の中から、同じ英単語（大文字小文字を無視）の2件目以降を削除する。
先に現れたものを残す（vocab.js の8項目リッチなエントリが優先される）。

使い方:  python3 tools/dedupe-vocab.py vocab.js vocab-ext.js
"""
import re
import sys

ENTRY = re.compile(r'\["((?:[^"\\]|\\.)*)","(?:[^"\\]|\\.)*","(?:n|v|adj|adv)",\d,"[^"]*"(?:,"(?:[^"\\]|\\.)*"){0,3}\],?')


def main(paths):
    seen = set()
    removed = []
    for path in paths:
        with open(path, encoding='utf-8') as f:
            src = f.read()

        out = []
        pos = 0
        for m in ENTRY.finditer(src):
            word = m.group(1).lower()
            if word in seen:
                out.append(src[pos:m.start()])
                removed.append((path, word))
                pos = m.end()
            else:
                seen.add(word)
        out.append(src[pos:])
        new = ''.join(out)

        if new != src:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new)

    print('unique words kept: %d' % len(seen))
    print('removed duplicates: %d' % len(removed))
    for path, w in removed:
        print('  - %s (%s)' % (w, path))


if __name__ == '__main__':
    main(sys.argv[1:] or ['vocab.js', 'vocab-ext.js'])
