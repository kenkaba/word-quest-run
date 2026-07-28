#!/usr/bin/env node
/* WORD QUEST RUN — 複数正解リスクの候補検出
   文字列が違えば安全、とは判断しない。意味が近い訳語の組を機械で洗い出す。
   出力は「候補」であり、採否は人（またはキュレーション表）が決める。 */

global.window = {};
require('../vocab.js');
require('../vocab-ext.js');
var RAW = window.VOCAB_RAW;

var words = RAW.map(function (e) {
  return { w: e[0], ja: e[1], pos: e[2], lvl: e[3], cat: e[4] };
});

/* 日本語訳から「意味の核」を取り出す。
   送り仮名・語尾（する/な/い/に/く/的）を落とし、漢字の並びを核とみなす。 */
function core(ja) {
  var s = ja;
  s = s.replace(/(する|される|させる)$/, '');
  s = s.replace(/(な|の|い|に|く|と|て|り|る|た|だ)$/, '');
  s = s.replace(/[のがをにへとでもは、。・（）()]/g, '');
  return s;
}
function kanji(s) { return (s.match(/[一-鿿]/g) || []).join(''); }

var pairs = [], seenPair = {};
function addPair(a, b, reason, score) {
  var key = [a.w, b.w].sort().join('|');
  if (seenPair[key]) return;
  seenPair[key] = 1;
  pairs.push({ a: a, b: b, reason: reason, score: score });
}

for (var i = 0; i < words.length; i++) {
  for (var j = i + 1; j < words.length; j++) {
    var A = words[i], B = words[j];
    if (A.pos !== B.pos) continue;            // 品詞が違えば同時出題されない
    if (Math.abs(A.lvl - B.lvl) > 2) continue; // 誤答は難易度±2以内からしか選ばれない

    var ca = core(A.ja), cb = core(B.ja);
    var ka = kanji(ca), kb = kanji(cb);

    // 1) 訳の核が完全一致（例: 旅/旅行 の核が一致するケース）
    if (ca && ca === cb) { addPair(A, B, 'core-identical', 100); continue; }

    // 2) 一方が他方を包含（例: 旅 ⊂ 旅行、見る ⊂ 見つめる）
    if (ca.length >= 2 && cb.length >= 2 && (ca.indexOf(cb) >= 0 || cb.indexOf(ca) >= 0)) {
      addPair(A, B, 'substring', 85); continue;
    }
    // 3) 漢字の核が一致（例: 大 vs 巨大 は不一致だが、拡大/拡張 のような並びを拾う）
    if (ka.length >= 2 && ka === kb) { addPair(A, B, 'kanji-identical', 90); continue; }

    // 4) 漢字が1文字以上共有かつ同カテゴリ（意味が寄りやすい）
    if (ka.length >= 1 && kb.length >= 1 && A.cat === B.cat) {
      var shared = 0;
      for (var k = 0; k < ka.length; k++) if (kb.indexOf(ka[k]) >= 0) shared++;
      var ratio = shared / Math.min(ka.length, kb.length);
      if (ratio >= 1 && shared >= 1) addPair(A, B, 'kanji-shared+same-cat', 70);
    }
  }
}

pairs.sort(function (x, y) { return y.score - x.score; });

console.log('候補ペア数: ' + pairs.length + '\n');
var byReason = {};
pairs.forEach(function (p) { byReason[p.reason] = (byReason[p.reason] || 0) + 1; });
console.log('理由別: ' + JSON.stringify(byReason) + '\n');

var limit = +(process.argv[2] || 200);
pairs.slice(0, limit).forEach(function (p) {
  console.log([p.score, p.reason, p.a.w + '=' + p.a.ja + '(' + p.a.pos + p.a.lvl + '/' + p.a.cat + ')',
    'VS', p.b.w + '=' + p.b.ja + '(' + p.b.pos + p.b.lvl + '/' + p.b.cat + ')'].join('  '));
});
if (pairs.length > limit) console.log('... 他 ' + (pairs.length - limit) + ' 件');
