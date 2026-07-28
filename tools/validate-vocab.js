#!/usr/bin/env node
/* WORD QUEST RUN — 語彙データ 大量検証ツール
   使い方: node tools/validate-vocab.js
   ゲーム外（CI/手元）で全語を機械検査する。ゲーム内の ?selftest=1 と同じ基準。 */

global.localStorage = { _d: {}, getItem: function (k) { return this._d[k] || null; }, setItem: function (k, v) { this._d[k] = v; } };
global.window = {};
require('../vocab.js');
require('../vocab-ext.js');
require('../vocab-engine.js');

var RAW = window.VOCAB_RAW;
var E = window.VocabEngine.create(RAW);
var fail = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  PASS  ' + name); }
  else { console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); fail++; }
}

console.log('\n=== 1. データ健全性 ===');
var seen = {}, dupWords = [], caseDup = [], missingJa = [], missingPos = [], missingLvl = [];
RAW.forEach(function (e) {
  var w = String(e[0]);
  var lower = w.toLowerCase();
  if (seen[lower]) { (seen[lower] === w ? dupWords : caseDup).push(w); }
  seen[lower] = w;
  if (!e[1]) missingJa.push(w);
  if (!e[2]) missingPos.push(w);
  if (!e[3]) missingLvl.push(w);
});
check('英単語の重複 0', dupWords.length === 0, dupWords.slice(0, 10).join(', '));
check('大文字小文字違いの重複 0', caseDup.length === 0, caseDup.slice(0, 10).join(', '));
check('日本語訳の欠損 0', missingJa.length === 0, missingJa.slice(0, 10).join(', '));
check('品詞の欠損 0', missingPos.length === 0, missingPos.slice(0, 10).join(', '));
check('難易度の欠損 0', missingLvl.length === 0, missingLvl.slice(0, 10).join(', '));

var v = E.validate();
check('正規化で弾かれた行 0', v.issues.missing === 0 && v.issues.duplicate === 0 && v.issues.badPos === 0 && v.issues.badLevel === 0,
  JSON.stringify(v.issues));
check('選択肢生成不能 0', v.noDistractor === 0, String(v.noDistractor) + ' words');

console.log('\n=== 2. 同義語の衝突（複数正解に見える問題） ===');
var byJa = {};
E.words.forEach(function (w) { (byJa[w.ja] = byJa[w.ja] || []).push(w.w); });
var sameJa = Object.keys(byJa).filter(function (k) { return byJa[k].length > 1; });
check('同一の日本語訳をもつ語 0', sameJa.length === 0,
  sameJa.slice(0, 10).map(function (k) { return k + '=' + byJa[k].join('/'); }).join(', '));

console.log('\n=== 3. 語の適切性 ===');
// 固有名詞（先頭大文字）を一般語として混ぜていないか
var proper = RAW.filter(function (e) { return /^[A-Z]/.test(e[0]); }).map(function (e) { return e[0]; });
check('固有名詞（先頭大文字）0', proper.length === 0, proper.slice(0, 10).join(', '));
// 不適切語の分類（収録しない方針。万一混入したら検出する）
var BLOCK = ['sex', 'porn', 'nude', 'rape', 'whore', 'slut', 'nigger', 'faggot', 'retard',
  'cocaine', 'heroin', 'meth', 'suicide', 'bomb', 'terrorist'];
var blocked = RAW.filter(function (e) { return BLOCK.indexOf(String(e[0]).toLowerCase()) >= 0; }).map(function (e) { return e[0]; });
check('不適切語・危険語 0', blocked.length === 0, blocked.join(', '));

console.log('\n=== 4. 構成 ===');
var lv = {}, pos = {};
E.words.forEach(function (w) { lv[w.lvl] = (lv[w.lvl] || 0) + 1; pos[w.pos] = (pos[w.pos] || 0) + 1; });
var NAMES = ['', 'Starter', 'Basic', 'Intermediate', 'Advanced', 'Expert', 'Master'];
for (var i = 1; i <= 6; i++) console.log('  ' + NAMES[i] + ': ' + (lv[i] || 0));
console.log('  品詞: ' + JSON.stringify(pos));
check('総語数 3,000以上', E.words.length >= 3000, String(E.words.length));
check('全難易度に十分な語数（各50以上）', [1, 2, 3, 4, 5, 6].every(function (i) { return (lv[i] || 0) >= 50; }));

console.log('\n=== 5. 1000問シミュレーション ===');
E.startSession();
var N = 1000, lanes = [0, 0, 0], dupInRun = 0, posBad = 0, jaPos = {}, byLvlAsked = {};
E.words.forEach(function (w) { if (!(w.ja in jaPos)) jaPos[w.ja] = w.pos; });
var seenIds = {}, advancedEarly = 0;
for (var q = 0; q < N; q++) {
  // 実ゲームの難易度開放に合わせる: 序盤は Starter のみ
  var playerLevel = 1 + Math.floor(q / 40);
  var maxLvl = playerLevel <= 2 ? 1 : playerLevel <= 4 ? 2 : playerLevel <= 6 ? 3 : playerLevel <= 9 ? 4 : playerLevel <= 12 ? 5 : 6;
  var Q = E.nextQuestion(maxLvl);
  if (!Q) { console.log('  question generation returned null at ' + q); break; }
  if (seenIds[Q.word.id]) dupInRun++;
  seenIds[Q.word.id] = 1;
  lanes[Q.correctLane]++;
  byLvlAsked[Q.word.lvl] = (byLvlAsked[Q.word.lvl] || 0) + 1;
  if (q < 20 && Q.word.lvl >= 4) advancedEarly++;
  for (var c = 0; c < 3; c++) {
    if (c === Q.correctLane) continue;
    if (jaPos[Q.choices[c]] && jaPos[Q.choices[c]] !== Q.word.pos) posBad++;
  }
  if (Q.choices[Q.correctLane] !== Q.word.ja) posBad++;
  E.record(Q.word, Math.random() < 0.7, 1500, false);
}
check('意図しない重複 0（1000問）', dupInRun === 0, String(dupInRun));
check('品詞不一致の誤答 0（1000問）', posBad === 0, String(posBad));
var pct = lanes.map(function (n) { return (n / N * 100).toFixed(1) + '%'; });
console.log('  正解位置の分布: 左 ' + pct[0] + ' / 中央 ' + pct[1] + ' / 右 ' + pct[2]);
var maxDev = Math.max.apply(null, lanes.map(function (n) { return Math.abs(n / N * 100 - 33.33); }));
check('正解位置の偏り 5%以内', maxDev <= 5, maxDev.toFixed(1) + '%');
console.log('  難易度別の出題数: ' + JSON.stringify(byLvlAsked));
check('ゲーム開始直後(20問)にAdvanced以上が出ない', advancedEarly === 0, String(advancedEarly));
check('1プレイのユニーク語数 = 出題数', Object.keys(seenIds).length === N, Object.keys(seenIds).length + '/' + N);

console.log('\n=== 6. 苦手語の再出題 ===');
/* 仕様: 語彙が十分あるとき「同一プレイ中の重複は禁止」。
   したがって苦手語は同じプレイ内では戻らず、次のプレイで優先的に戻るのが正しい挙動。
   ここでは (a) 同一プレイ内で連発しないこと (b) 次のプレイで優先度が上がること を検証する。 */
var E2 = window.VocabEngine.create(RAW);
E2.startSession();
var weak = [], firstRun = {};
for (var k = 0; k < 120; k++) {
  var Q2 = E2.nextQuestion(3);
  firstRun[Q2.word.id] = 1;
  var wrong = k < 10;                       // 最初の10語をわざと間違える
  if (wrong) weak.push(Q2.word.id);
  E2.record(Q2.word, !wrong, 1500, false);
}
var repeatsInRun = 0, seenRun = {};
Object.keys(firstRun).forEach(function () {});
check('同一プレイ内で苦手語が連発しない', Object.keys(firstRun).length === 120, Object.keys(firstRun).length + '/120');

// 次のプレイ: 苦手語が早い段階で戻ってくるか
// 直近1分以内の語は意図的に強く抑制されるため、10分経過を模擬してから検証する
Object.keys(E2.stats).forEach(function (id) { E2.stats[id].lastAt -= 10 * 60 * 1000; });
E2.startSession();
var comeback = -1, weakSet = {};
weak.forEach(function (id) { weakSet[id] = 1; });
for (var k2 = 0; k2 < 120; k2++) {
  var Q3 = E2.nextQuestion(3);
  if (weakSet[Q3.word.id] && comeback < 0) comeback = k2;
  E2.record(Q3.word, true, 1500, false);
}
console.log('  次のプレイで苦手語が戻った位置: ' + (comeback < 0 ? '戻らず' : comeback + '問目'));
check('次のプレイで苦手語が再出題される', comeback >= 0, String(comeback));
check('苦手語は次のプレイの前半で戻る', comeback >= 0 && comeback < 60, String(comeback));

console.log('\n=== 7. 例文カバー率 ===');
var withEx = E.words.filter(function (w) { return w.ex && w.exJa; }).length;
console.log('  例文つき: ' + withEx + ' / ' + E.words.length + ' (' + (withEx / E.words.length * 100).toFixed(1) + '%)');
console.log('  ※ 例文は段階的拡充。ゲーム本編の必須項目ではない。');

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);
