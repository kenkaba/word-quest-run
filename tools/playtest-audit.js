#!/usr/bin/env node
/* WORD QUEST RUN — 実プレイ監査
   使い方: node tools/playtest-audit.js
   「人間が実際に遊んだときの意味品質」を、指定シナリオで機械的に検証する。 */

global.localStorage = { _d: {}, getItem: function (k) { return this._d[k] || null; }, setItem: function (k, v) { this._d[k] = v; } };
global.window = {};
require('../vocab.js');
require('../vocab-ext.js');
require('../vocab-quality.js');
require('../vocab-engine.js');

var RAW = window.VOCAB_RAW;
var fail = 0;
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : (detail ? '\n        ' + detail : '')));
  if (!ok) fail++;
}

/* 実ゲームと同じ難易度開放カーブ */
function maxLvlFor(playerLevel) {
  return playerLevel <= 2 ? 1 : playerLevel <= 4 ? 2 : playerLevel <= 6 ? 3 : playerLevel <= 9 ? 4 : playerLevel <= 12 ? 5 : 6;
}
/* 実ゲームと同じ制限時間モデル */
var BASE_TIME = [0, 6.6, 5.6, 4.8, 4.2, 3.8, 3.4];
function timeForWord(lvl, playerLevel, accuracy, combo) {
  var b = BASE_TIME[lvl];
  b -= Math.min(1.2, Math.max(0, playerLevel - 1) * 0.09);
  b -= Math.min(0.9, combo * 0.045);
  if (accuracy < 0.5) b += 1.2; else if (accuracy < 0.7) b += 0.5;
  return Math.max(2.6, Math.min(8, b));
}

var E = window.VocabEngine.create(RAW);

console.log('=== 0. 監査オーバーレイの適用 ===');
console.log('  収録: ' + RAW.length + ' / 承認(出題対象): ' + E.words.length + ' / 隔離: ' + E.issues.quarantined);
check('隔離語が出題対象に含まれない', E.words.length === RAW.length - E.issues.quarantined);
var qNames = Object.keys(window.VOCAB_QUALITY.quarantine);
check('隔離語をエンジンが保持していない', qNames.every(function (w) { return !E.byId[w]; }),
  qNames.filter(function (w) { return E.byId[w]; }).slice(0, 5).join(', '));
check('全出題語が qualityStatus=approved', E.words.every(function (w) { return w.qualityStatus === 'approved'; }));
check('全出題語が senseId を持つ', E.words.every(function (w) { return !!w.senseId; }));
var grouped = E.words.filter(function (w) { return w.confusableGroup; }).length;
console.log('  混同グループ所属語: ' + grouped);

console.log('\n=== 1. 3,000問シミュレーション ===');
E.startSession();
var N = 3000, lanes = [0, 0, 0], dup = 0, posBad = 0, groupClash = 0, sameJa = 0;
var seenIds = {}, jaPos = {}, byLvl = {}, catRun = 0, maxCatRun = 0, lastCat = '';
E.words.forEach(function (w) { if (!(w.ja in jaPos)) jaPos[w.ja] = w.pos; });
var jaToGroup = {};
E.words.forEach(function (w) { jaToGroup[w.ja] = w.confusableGroup; });

for (var i = 0; i < N; i++) {
  var pl = 1 + Math.floor(i / 40);
  var Q = E.nextQuestion(maxLvlFor(pl));
  if (!Q) { console.log('  null question at ' + i); break; }
  if (seenIds[Q.word.id]) dup++;
  seenIds[Q.word.id] = 1;
  lanes[Q.correctLane]++;
  byLvl[Q.word.lvl] = (byLvl[Q.word.lvl] || 0) + 1;

  // 同じカテゴリが連続しすぎないか
  if (Q.word.cat === lastCat) { catRun++; maxCatRun = Math.max(maxCatRun, catRun); } else catRun = 1;
  lastCat = Q.word.cat;

  // 選択肢の検査
  var groupsSeen = {}, jaSeen = {};
  for (var c = 0; c < 3; c++) {
    var ja = Q.choices[c];
    if (jaSeen[ja]) sameJa++;
    jaSeen[ja] = 1;
    if (c !== Q.correctLane && jaPos[ja] && jaPos[ja] !== Q.word.pos) posBad++;
    var g = jaToGroup[ja];
    if (g) { if (groupsSeen[g]) groupClash++; groupsSeen[g] = 1; }
  }
  if (Q.choices[Q.correctLane] !== Q.word.ja) posBad++;
  E.record(Q.word, Math.random() < 0.7, 1500, false);
}
var uniqueGot = Object.keys(seenIds).length;
// 復習枠で苦手語へ枠を割くため、数語は3,000問内に登場しないことがある（正常）
check('3,000問でプールの99%以上をユニーク出題', uniqueGot >= E.words.length * 0.99,
  uniqueGot + ' unique / pool ' + E.words.length + ' / 再出題 ' + dup);
check('品詞不一致の誤答 0', posBad === 0, String(posBad));
check('同一の選択肢が並ばない', sameJa === 0, String(sameJa));
check('複数正解リスク 0（同じ混同グループが同時に出ない）', groupClash === 0, String(groupClash));
var pct = lanes.map(function (n) { return (n / N * 100).toFixed(1); });
console.log('  正解位置: 左 ' + pct[0] + '% / 中央 ' + pct[1] + '% / 右 ' + pct[2] + '%');
check('正解位置の偏り 3%以内', Math.max.apply(null, lanes.map(function (n) { return Math.abs(n / N * 100 - 33.33); })) <= 3);
console.log('  難易度別出題: ' + JSON.stringify(byLvl));
check('同じカテゴリの連続が4問以下', maxCatRun <= 4, 'max ' + maxCatRun);

console.log('\n=== 2. 実プレイ監査（シナリオ別） ===');
function scenario(name, questions, maxLvl, expectLevels) {
  var e = window.VocabEngine.create(RAW);
  e.startSession();
  var seen = {}, dupN = 0, clash = 0, lvlSeen = {}, times = [];
  for (var k = 0; k < questions; k++) {
    var Q = e.nextQuestion(maxLvl);
    if (!Q) break;
    if (seen[Q.word.id]) dupN++;
    seen[Q.word.id] = 1;
    lvlSeen[Q.word.lvl] = (lvlSeen[Q.word.lvl] || 0) + 1;
    var gs = {};
    for (var c = 0; c < 3; c++) {
      var g = jaToGroup[Q.choices[c]];
      if (g) { if (gs[g]) clash++; gs[g] = 1; }
    }
    times.push(timeForWord(Q.word.lvl, 1 + Math.floor(k / 40), 0.75, Math.min(k, 15)));
    e.record(Q.word, Math.random() < 0.75, 1500, false);
  }
  var avgT = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
  console.log('  [' + name + '] 出題' + questions + ' / 重複' + dupN + ' / 複数正解リスク' + clash +
    ' / 難易度' + JSON.stringify(lvlSeen) + ' / 平均制限時間 ' + avgT.toFixed(2) + '秒');
  check(name + ': 重複0', dupN === 0, String(dupN));
  check(name + ': 複数正解リスク0', clash === 0, String(clash));
  if (expectLevels) {
    var over = Object.keys(lvlSeen).filter(function (L) { return +L > expectLevels; });
    check(name + ': 想定を超える難易度が出ない', over.length === 0, 'lvl ' + over.join(','));
  }
  return { avgT: avgT, lvlSeen: lvlSeen };
}
var s1 = scenario('Starterのみ100問', 100, 1, 1);
var s2 = scenario('Basicまで200問', 200, 2, 2);
var s3 = scenario('Intermediateまで300問', 300, 3, 3);
var s4 = scenario('全難易度500問', 500, 6, 6);

console.log('\n=== 3. 時間ゲージと難易度の釣り合い ===');
check('やさしいほど時間が長い', s1.avgT > s4.avgT, s1.avgT.toFixed(2) + ' vs ' + s4.avgT.toFixed(2));
check('Starterの平均が5秒以上', s1.avgT >= 5.0, s1.avgT.toFixed(2));
check('全難易度でも平均3秒以上', s4.avgT >= 3.0, s4.avgT.toFixed(2));
console.log('  Starter平均 ' + s1.avgT.toFixed(2) + '秒 / Basic ' + s2.avgT.toFixed(2) +
  '秒 / Intermediate ' + s3.avgT.toFixed(2) + '秒 / 全難易度 ' + s4.avgT.toFixed(2) + '秒');

console.log('\n=== 4. 苦手語の再出題 ===');
localStorage._d = {};                     // 先行シナリオの統計を持ち込まない
var e5 = window.VocabEngine.create(RAW);
e5.startSession();
var weak = [];
for (var m = 0; m < 120; m++) {
  var Qm = e5.nextQuestion(3);
  var wrong = m < 10;
  if (wrong) weak.push(Qm.word.id);
  e5.record(Qm.word, !wrong, 1500, false);
}
Object.keys(e5.stats).forEach(function (id) { e5.stats[id].lastAt -= 10 * 60 * 1000; });
e5.startSession();
var back = -1, ws = {};
weak.forEach(function (id) { ws[id] = 1; });
for (var n2 = 0; n2 < 120; n2++) {
  var Qn = e5.nextQuestion(3);
  if (ws[Qn.word.id] && back < 0) back = n2;
  e5.record(Qn.word, true, 1500, false);
}
check('苦手語が次のプレイの前半で戻る', back >= 0 && back < 60, String(back));

console.log('\n=== 5. Starter / Basic の重点確認 ===');
var lowLevel = E.words.filter(function (w) { return w.lvl <= 2; });
// 訳が説明的すぎないか（ゲーム中に瞬時に読めるか）
var tooLong = lowLevel.filter(function (w) { return w.ja.length > 7; });
check('Starter/Basic に長すぎる訳がない（7文字以内）', tooLong.length === 0,
  tooLong.slice(0, 8).map(function (w) { return w.w + '=' + w.ja; }).join(', '));
// 品詞と語尾の整合
var posMismatch = lowLevel.filter(function (w) {
  if (w.pos === 'v') return !/(る|う|く|ぐ|す|つ|ぬ|ぶ|む|い|ず|し)$/.test(w.ja);
  if (w.pos === 'adj') return !/(な|い|の|た|だ|て|つ|る|き)$/.test(w.ja);
  return false;
});
check('Starter/Basic の品詞と訳の語尾が整合', posMismatch.length === 0,
  posMismatch.slice(0, 10).map(function (w) { return w.w + '=' + w.ja + '(' + w.pos + ')'; }).join(', '));

console.log('\n' + (fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED'));
process.exit(fail === 0 ? 0 : 1);
