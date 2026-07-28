/* ==========================================================================
   WORD QUEST RUN — 語彙エンジン

   責務:
   1. 語彙の正規化と検証（欠損・重複・品詞不一致を起動時に検出）
   2. 重複防止つきの出題選択（直近N問・セッション内・習熟度・苦手度）
   3. 品詞一致かつ意味的に紛らわしい誤答の生成
   4. 正解レーンの偏り補正
   5. 習熟度と学習統計の永続化（localStorage）
   6. 分析指標の記録

   語彙データ本体は vocab.js（差し替え可能）。このファイルは形状を持たない。
   ========================================================================== */
(function () {
  'use strict';

  var LS_STATS = 'wqr_vocab_stats_v1';
  var LS_ANALYTICS = 'wqr_analytics_v1';

  /* ── 正規化 ─────────────────────────────────────────────────────── */
  var FIELDS = ['w', 'ja', 'pos', 'lvl', 'cat', 'ipa', 'ex', 'exJa'];
  var LEVEL_NAMES = ['', 'Starter', 'Basic', 'Intermediate', 'Advanced', 'Expert', 'Master'];

  function normalize(raw) {
    var out = [], seen = {}, issues = { missing: 0, duplicate: 0, badLevel: 0, badPos: 0 };
    var POS_OK = { n: 1, v: 1, adj: 1, adv: 1 };
    for (var i = 0; i < raw.length; i++) {
      var e = raw[i];
      if (!e || e.length < 6 || !e[0] || !e[1] || !e[2]) { issues.missing++; continue; }
      var key = String(e[0]).toLowerCase();
      if (seen[key]) { issues.duplicate++; continue; }
      if (!POS_OK[e[2]]) { issues.badPos++; continue; }
      var lvl = +e[3];
      if (!(lvl >= 1 && lvl <= 6)) { issues.badLevel++; continue; }
      seen[key] = 1;
      out.push({
        id: key, w: e[0], ja: e[1], pos: e[2], lvl: lvl, cat: e[4] || 'general',
        ipa: e[5] || '', ex: e[6] || '', exJa: e[7] || ''
      });
    }
    return { words: out, issues: issues };
  }

  /* ── 学習統計（永続化） ─────────────────────────────────────────── */
  function loadStats() {
    try { return JSON.parse(localStorage.getItem(LS_STATS)) || {}; } catch (e) { return {}; }
  }
  function saveStats(s) {
    try { localStorage.setItem(LS_STATS, JSON.stringify(s)); } catch (e) {}
  }
  function blankStat() { return { seen: 0, correct: 0, wrong: 0, lastAt: 0, mastery: 0 }; }

  /* 習熟度 0..1。連続正解で上がり、誤答で大きく下がる（忘却を反映）。 */
  function updateMastery(st, ok) {
    if (ok) st.mastery = Math.min(1, st.mastery + (1 - st.mastery) * 0.34);
    else st.mastery = Math.max(0, st.mastery * 0.35);
    return st.mastery;
  }

  /* 再出題優先度。高いほど出したい。
     - 未出題は中程度（新規を適度に混ぜる）
     - 苦手（誤答が多い / 習熟度が低い）は高い
     - 覚えた語は低い
     - 直近に出したものは強く下げる（連発防止） */
  function priority(st, now) {
    if (!st || !st.seen) return 1.0;
    var wrongRate = st.wrong / Math.max(1, st.seen);
    var p = 0.35 + wrongRate * 1.5 + (1 - st.mastery) * 0.9;
    var mins = (now - st.lastAt) / 60000;
    if (mins < 1) p *= 0.05;
    else if (mins < 5) p *= 0.4;
    else if (mins < 30) p *= 0.8;
    return p;
  }

  /* ── エンジン本体 ───────────────────────────────────────────────── */
  function Engine(raw) {
    var norm = normalize(raw || []);
    this.words = norm.words;
    this.issues = norm.issues;
    this.stats = loadStats();
    this.byId = {};
    var self = this;
    this.words.forEach(function (w) { self.byId[w.id] = w; });

    // 重複防止の記録
    this.recent = [];                 // 直近に出した id
    this.recentMax = Math.min(100, Math.max(20, Math.floor(this.words.length * 0.4)));
    this.sessionUsed = {};            // このプレイで出した id
    this.laneHist = [0, 0, 0];        // 正解位置の偏り補正
    this.session = this.blankSession();
  }

  Engine.prototype.blankSession = function () {
    return {
      asked: 0, correct: 0, wrong: 0, timeout: 0,
      totalMs: 0, unique: {}, repeats: 0,
      byLevel: {}   // lvl -> {asked, correct, ms}
    };
  };

  Engine.prototype.startSession = function () {
    this.sessionUsed = {};
    this.laneHist = [0, 0, 0];
    this.session = this.blankSession();
  };

  Engine.prototype.count = function () { return this.words.length; };

  /* 出題を1問作る。
     maxLvl: 現在の到達難易度上限 */
  Engine.prototype.nextQuestion = function (maxLvl) {
    if (!this.words.length) return null;
    var now = Date.now(), self = this;
    maxLvl = Math.max(1, Math.min(6, maxLvl || 2));

    /* 出題プールは難易度で絞るが、絞りすぎると語数が足りず重複が起きる。
       重複防止に必要な語数を満たすまで難易度上限を自動で広げる。
       語彙が増えるほど広げる必要がなくなり、難易度進行が自然に効くようになる。 */
    var need = Math.max(120, this.recentMax + 30);
    var lv = maxLvl;
    var pool = this.words.filter(function (w) { return w.lvl <= lv; });
    while (pool.length < need && lv < 6) {
      lv++;
      pool = this.words.filter(function (w) { return w.lvl <= lv; });
    }
    if (pool.length < 6) pool = this.words.slice();

    // 1) 直近N問に出たものを除外
    var recentSet = {};
    this.recent.forEach(function (id) { recentSet[id] = 1; });
    var avail = pool.filter(function (w) { return !recentSet[w.id]; });

    // 2) 語彙が十分ならセッション内の重複も禁止
    var sessionCapable = pool.length > 40;
    if (sessionCapable) {
      var fresh = avail.filter(function (w) { return !self.sessionUsed[w.id]; });
      if (fresh.length >= 4) avail = fresh;
      else this.session.repeats++;    // 使い切ったので已むを得ず再利用
    }
    if (!avail.length) avail = pool.slice();

    // 3) 優先度つき重み抽選（苦手を出しやすく、覚えた語は控えめに）
    var weights = avail.map(function (w) { return priority(self.stats[w.id], now); });
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var pickIdx = 0, r = Math.random() * total, acc = 0;
    for (var i = 0; i < avail.length; i++) { acc += weights[i]; if (r <= acc) { pickIdx = i; break; } }
    var word = avail[pickIdx];

    // 4) 誤答生成: 同じ品詞・近い難易度・意味が重複しないもの
    var distractors = this.makeDistractors(word);
    if (distractors.length < 2) return this.nextQuestion(Math.min(6, maxLvl + 1));

    // 5) 正解レーンの偏り補正: これまで最も少ないレーンを優先的に使う
    var minLane = 0;
    for (var L = 1; L < 3; L++) if (this.laneHist[L] < this.laneHist[minLane]) minLane = L;
    var correctLane = (Math.random() < 0.72) ? minLane : Math.floor(Math.random() * 3);

    var choices = [];
    var d = distractors.slice();
    for (var c = 0; c < 3; c++) choices.push(c === correctLane ? word.ja : d.pop());

    // 記録
    this.recent.push(word.id);
    while (this.recent.length > this.recentMax) this.recent.shift();
    this.sessionUsed[word.id] = 1;
    this.laneHist[correctLane]++;
    this.session.unique[word.id] = 1;

    return { word: word, choices: choices, correctLane: correctLane };
  };

  /* 誤答: 品詞一致が絶対条件。難易度は±1→±2と広げ、
     同じカテゴリを優先して「意味が紛らわしい」候補にする。 */
  Engine.prototype.makeDistractors = function (word) {
    var self = this;
    function candidates(lvlSpan, sameCat) {
      return self.words.filter(function (o) {
        if (o.id === word.id) return false;
        if (o.pos !== word.pos) return false;                 // 品詞不一致は構造的に禁止
        if (o.ja === word.ja) return false;                   // 同義の訳は除外
        if (Math.abs(o.lvl - word.lvl) > lvlSpan) return false;
        if (sameCat && o.cat !== word.cat) return false;
        return true;
      });
    }
    // 同カテゴリ（最も紛らわしい）→ 難易度±1 → ±2 の順に集める
    var picked = [], used = {};
    function take(list, n) {
      list = list.slice();
      for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t; }
      for (var k = 0; k < list.length && picked.length < n; k++) {
        var o = list[k];
        if (used[o.ja]) continue;
        used[o.ja] = 1; picked.push(o.ja);
      }
    }
    take(candidates(1, true), 2);
    if (picked.length < 2) take(candidates(1, false), 2);
    if (picked.length < 2) take(candidates(2, false), 2);
    if (picked.length < 2) take(candidates(5, false), 2);
    return picked;
  };

  /* 回答の記録 */
  Engine.prototype.record = function (word, ok, ms, timedOut) {
    if (!word) return;
    var st = this.stats[word.id] || blankStat();
    st.seen++;
    if (ok) st.correct++; else st.wrong++;
    st.lastAt = Date.now();
    updateMastery(st, ok);
    this.stats[word.id] = st;
    saveStats(this.stats);

    var s = this.session;
    s.asked++;
    if (ok) s.correct++; else s.wrong++;
    if (timedOut) s.timeout++;
    s.totalMs += ms || 0;
    var bl = s.byLevel[word.lvl] || (s.byLevel[word.lvl] = { asked: 0, correct: 0, ms: 0 });
    bl.asked++; if (ok) bl.correct++; bl.ms += ms || 0;
  };

  /* 分析指標 */
  Engine.prototype.report = function () {
    var s = this.session, uniq = Object.keys(s.unique).length;
    var byLevel = {};
    Object.keys(s.byLevel).forEach(function (k) {
      var b = s.byLevel[k];
      byLevel[LEVEL_NAMES[k] || k] = {
        asked: b.asked,
        accuracy: b.asked ? +(b.correct / b.asked).toFixed(3) : null,
        avgMs: b.asked ? Math.round(b.ms / b.asked) : null
      };
    });
    return {
      asked: s.asked,
      accuracy: s.asked ? +(s.correct / s.asked).toFixed(3) : null,
      avgAnswerMs: s.asked ? Math.round(s.totalMs / s.asked) : null,
      timeoutRate: s.asked ? +(s.timeout / s.asked).toFixed(3) : null,
      uniqueWords: uniq,
      repeatRate: s.asked ? +((s.asked - uniq) / s.asked).toFixed(3) : null,
      byLevel: byLevel
    };
  };

  Engine.prototype.persistReport = function () {
    try {
      var all = JSON.parse(localStorage.getItem(LS_ANALYTICS)) || [];
      all.push({ at: Date.now(), r: this.report() });
      while (all.length > 50) all.shift();
      localStorage.setItem(LS_ANALYTICS, JSON.stringify(all));
    } catch (e) {}
  };

  /* 苦手な単語（結果画面の復習用） */
  Engine.prototype.weakWords = function (limit) {
    var self = this, list = [];
    Object.keys(this.stats).forEach(function (id) {
      var st = self.stats[id], w = self.byId[id];
      if (!w || !st.wrong) return;
      list.push({ word: w, wrong: st.wrong, mastery: st.mastery });
    });
    list.sort(function (a, b) { return (a.mastery - b.mastery) || (b.wrong - a.wrong); });
    return list.slice(0, limit || 12);
  };

  /* 起動時の品質検証（品質ゲート） */
  Engine.prototype.validate = function () {
    var self = this, r = { total: this.words.length, issues: this.issues, posMismatch: 0, noDistractor: 0, missingExample: 0 };
    this.words.forEach(function (w) {
      var d = self.makeDistractors(w);
      if (d.length < 2) r.noDistractor++;
      if (!w.ex || !w.exJa) r.missingExample++;
    });
    return r;
  };

  window.VocabEngine = {
    create: function (raw) { return new Engine(raw); },
    LEVEL_NAMES: LEVEL_NAMES
  };
})();
