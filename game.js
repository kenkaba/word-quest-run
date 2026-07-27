/* ==========================================================================
   WORD QUEST RUN — Ver3.0 engine
   幻想ランニングRPG。英単語は「勉強」ではなく、道を選ぶための魔法の記号として扱う。

   設計の柱
   1. 背景が主役。空を大きく取り、視差レイヤーで巨大な幻想世界を見せる
   2. 主人公は魔法使いの少女。常に画面奥（未来）へ走る。髪・マント・裾が揺れる
   3. 視線は縦一直線: 問題(上) → 3本の道(中) → 主人公(下)
   4. UIは距離とコンボだけ。ガラス/クリスタル調で世界に馴染ませる
   5. 演出はSNSで撮りたくなる瞬間を作る（神回避スロー、100コンボ虹、巨大ボス、宝箱）

   パフォーマンス方針
   - shadowBlur はホットループで使わない。発光は事前描画スプライトを drawImage
   - パーティクルはプール＋上限。DPRは2で頭打ち
   - 遠景は低頻度更新のオフスクリーンへ描いて使い回す
   ========================================================================== */
(function () {
  'use strict';

  var WORDS = Array.isArray(window.WORDS) ? window.WORDS.slice() : [];

  /* ── helpers ───────────────────────────────────────────────────────── */
  function $(s, r) { return (r || document).querySelector(s); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function rf(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[rnd(a.length)]; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  // roundRect polyfill（古いSafari対策）
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
      this.beginPath();
      this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r); this.closePath(); return this;
    };
  }

  /* ── Store ─────────────────────────────────────────────────────────── */
  var Store = {
    best: function () { var v = +localStorage.getItem('wqr3_best'); return isFinite(v) ? v : 0; },
    setBest: function (v) { try { localStorage.setItem('wqr3_best', String(Math.round(v))); } catch (e) {} },
    bestCombo: function () { var v = +localStorage.getItem('wqr3_combo'); return isFinite(v) ? v : 0; },
    setBestCombo: function (v) { try { localStorage.setItem('wqr3_combo', String(v)); } catch (e) {} },
    sound: function () { return localStorage.getItem('wqr3_snd') !== '0'; },
    setSound: function (on) { try { localStorage.setItem('wqr3_snd', on ? '1' : '0'); } catch (e) {} },
    seen: function () { return localStorage.getItem('wqr3_seen') === '1'; },
    setSeen: function () { try { localStorage.setItem('wqr3_seen', '1'); } catch (e) {} }
  };

  /* ── Sfx ───────────────────────────────────────────────────────────── */
  var Sfx = {
    ctx: null, on: Store.sound(),
    ensure: function () {
      if (!this.on) return null;
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone: function (f, dur, type, vol, glideTo) {
      var c = this.ensure(); if (!c) return;
      var o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.13, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
    },
    noise: function (dur, vol) {
      var c = this.ensure(); if (!c) return;
      var n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 900;
      g.gain.value = vol || 0.08;
      s.buffer = b; s.connect(f); f.connect(g); g.connect(c.destination); s.start();
    },
    good: function (combo) {
      var base = 560 + Math.min(combo, 20) * 18, s = this;
      this.tone(base, 0.11, 'triangle', 0.13);
      setTimeout(function () { s.tone(base * 1.5, 0.12, 'triangle', 0.11); }, 60);
      this.noise(0.14, 0.05);
    },
    bad: function () { this.tone(220, 0.32, 'sawtooth', 0.13, 70); this.noise(0.3, 0.1); },
    whoosh: function () { this.noise(0.22, 0.07); },
    chime: function () { var s = this; [784, 988, 1319].forEach(function (f, i) { setTimeout(function () { s.tone(f, 0.18, 'sine', 0.1); }, i * 60); }); },
    boss: function () { this.tone(70, 0.7, 'square', 0.11, 45); this.noise(0.5, 0.09); },
    fanfare: function () { var s = this; [523, 659, 784, 1046, 1319].forEach(function (f, i) { setTimeout(function () { s.tone(f, 0.2, 'triangle', 0.13); }, i * 95); }); },
    slowmo: function () { this.tone(400, 0.5, 'sine', 0.09, 180); }
  };

  /* ── 世界（ステージ）: 背景が主役 ──────────────────────────────────── */
  var STAGES = [
    { name: '暁の浮遊遺跡', min: 0,
      sky: ['#f7c98b', '#e8859b', '#6b4a8f', '#2a1f4d'], sun: '#fff3c4', sunY: 0.30, sunGlow: '#ffcf8a',
      ground: '#3b2f52', road: '#6c5a92', edge: '#ffd9a0', rune: '#ffe9b8',
      far: '#5b4478', mid: '#43305c', near: '#2e2043',
      scen: 'ruin', fog: 'rgba(255,190,150,0.18)', part: '#ffd9a0', aurora: null },
    { name: '翡翠の魔法森', min: 300,
      sky: ['#bff0d8', '#6fd6b0', '#2b8f7a', '#0e3d3a'], sun: '#f6ffd9', sunY: 0.22, sunGlow: '#c9ffb0',
      ground: '#123a2f', road: '#2f6b52', edge: '#a8ffcf', rune: '#dcffe8',
      far: '#2d7a63', mid: '#1c5546', near: '#12352e',
      scen: 'tree', fog: 'rgba(160,255,200,0.16)', part: '#b6ffcf', aurora: null },
    { name: '星霜の大滝', min: 600,
      sky: ['#cfe8ff', '#7fb6f5', '#3a5fb0', '#141c3f'], sun: '#ffffff', sunY: 0.26, sunGlow: '#bcd8ff',
      ground: '#1b2a4a', road: '#3d5a8c', edge: '#bfe4ff', rune: '#e6f5ff',
      far: '#4a6ba8', mid: '#31497a', near: '#1e2c50',
      scen: 'fall', fog: 'rgba(200,230,255,0.22)', part: '#dff0ff', aurora: null },
    { name: 'オーロラ雪嶺', min: 1000,
      sky: ['#0e1b3a', '#173156', '#0c1830', '#050a18'], sun: '#eaf6ff', sunY: 0.18, sunGlow: '#9fd8ff',
      ground: '#26364f', road: '#4a648a', edge: '#eaf6ff', rune: '#ffffff',
      far: '#33506f', mid: '#22364f', near: '#16233a',
      scen: 'crystal', fog: 'rgba(190,225,255,0.18)', part: '#ffffff', aurora: ['#7dffc8', '#7db9ff', '#c98aff'] },
    { name: '天空神殿', min: 1500,
      sky: ['#ffe6a8', '#ffb277', '#a35fa0', '#2b1740'], sun: '#fffbe6', sunY: 0.24, sunGlow: '#ffd98a',
      ground: '#4a3550', road: '#8a6a9c', edge: '#ffe9a8', rune: '#fff6d0',
      far: '#7a5a8f', mid: '#5c4370', near: '#3d2b50',
      scen: 'temple', fog: 'rgba(255,220,170,0.2)', part: '#ffe9b0', aurora: null }
  ];
  function stageFor(d) { var s = STAGES[0]; for (var i = 0; i < STAGES.length; i++) if (d >= STAGES[i].min) s = STAGES[i]; return s; }
  function stageIndex(d) { var k = 0; for (var i = 0; i < STAGES.length; i++) if (d >= STAGES[i].min) k = i; return k; }

  var WINMOVES = ['bridge', 'jump', 'wallrun', 'rope', 'slide', 'strike'];
  var WIN_LABEL = { bridge: '光の橋が架かった', jump: '大跳躍！', wallrun: '壁走りで抜けた', rope: '光の綱で渡った', slide: 'スライドで通過', strike: '魔法で突破！' };
  var FAILMOVES = ['fall', 'crash', 'spike', 'beast'];
  var FAIL_LABEL = { fall: '足場が崩れた…', crash: '壁に激突…', spike: 'トゲに阻まれた…', beast: '魔獣に阻まれた…' };

  var BOSS_AT = [300, 600, 1000, 1500, 2200];
  var BOSS_HITS = 3;

  /* ── Canvas ────────────────────────────────────────────────────────── */
  var cv = $('#stage'), ctx = cv.getContext('2d', { alpha: false });
  var W = 0, H = 0, DPR = 1, horizonY = 0, roadHalfBottom = 0;
  var DEPTH = 6.2;      // 遠近の強さ
  var OVERSCAN = 34;    // 画面揺れ時に端が欠けないための余白

  var el = {};
  function cacheDom() {
    el = {
      dist: $('#hudDist'), combo: $('#hudCombo'), comboWrap: $('#comboWrap'),
      lives: $('#hudLives'), stage: $('#hudStage'),
      word: $('#qword'), live: $('#liveRegion'),
      title: $('#title'), over: $('#over'), howto: $('#howto'),
      titleBest: $('#titleBest'), sound: $('#soundBtn'),
      ovDist: $('#ovDist'), ovBest: $('#ovBest'), ovCombo: $('#ovCombo'),
      ovNew: $('#ovNew'), ovMissed: $('#ovMissed'), ovStage: $('#ovStage'),
      hintRow: $('#hints'),
      hintScroll: $('#hintScroll'), hintSand: $('#hintSand'), hintEye: $('#hintEye'),
      hintScrollN: $('#hintScrollN'), hintSandN: $('#hintSandN'), hintEyeN: $('#hintEyeN'),
      flash: $('#flash'), cine: $('#cine'), coach: $('#coach')
    };
  }

  // 背景タブ・起動直後・回転直後は viewport が 0 になり得る。
  // 0のまま進むと道幅も地平線も0になり世界が消えるため、必ず有効な寸法へ落とす。
  function measure() {
    var w = cv.clientWidth || window.innerWidth || (screen && screen.width) || 390;
    var h = cv.clientHeight || window.innerHeight || (screen && screen.height) || 780;
    return { w: Math.max(240, Math.round(w)), h: Math.max(360, Math.round(h)) };
  }
  function resize() {
    var m = measure();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = m.w; H = m.h;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    horizonY = H * 0.46;          // ローアングル: 空を大きく取る
    roadHalfBottom = W * 0.60;
    Sprites.clear();
    Sky.invalidate();
  }
  // 実サイズが確定した瞬間に貼り直す（0x0で起動した場合の復帰）
  function watchSize() {
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        var m = measure();
        if (m.w !== W || m.h !== H) resize();
      });
      try { ro.observe(cv); } catch (e) {}
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) resize(); });
  }

  /* ── 発光スプライト（shadowBlurを使わないための事前描画） ───────────── */
  var Sprites = {
    map: {},
    clear: function () { this.map = {}; },
    glow: function (color, size) {
      var key = color + '|' + size, s = this.map[key];
      if (s) return s;
      var c = document.createElement('canvas');
      c.width = c.height = size * 2;
      var g = c.getContext('2d');
      var grd = g.createRadialGradient(size, size, 0, size, size, size);
      grd.addColorStop(0, color);
      grd.addColorStop(0.35, this.fade(color, 0.45));
      grd.addColorStop(1, this.fade(color, 0));
      g.fillStyle = grd; g.fillRect(0, 0, size * 2, size * 2);
      this.map[key] = c; return c;
    },
    fade: function (hex, a) {
      if (hex[0] !== '#') return hex;
      var h = hex.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    },
    drawGlow: function (x, y, r, color, alpha) {
      var size = Math.max(8, Math.round(r));
      var s = this.glow(color, size);
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.drawImage(s, x - size, y - size);
      ctx.globalAlpha = 1;
    }
  };

  /* ── 空（低頻度更新のオフスクリーン） ──────────────────────────────── */
  var Sky = {
    cv: null, key: '', t: 0,
    invalidate: function () { this.key = ''; },
    get: function (st, tint) {
      var k = st.name + '|' + W + 'x' + H + '|' + tint;
      if (this.key === k && this.cv) return this.cv;
      var c = this.cv && this.cv.width === Math.round(W * DPR) ? this.cv : document.createElement('canvas');
      c.width = Math.round(W * DPR); c.height = Math.round(horizonY * DPR + 4);
      var g = c.getContext('2d');
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      var hh = horizonY + 2;
      var grd = g.createLinearGradient(0, 0, 0, hh);
      grd.addColorStop(0, st.sky[3]); grd.addColorStop(0.42, st.sky[2]);
      grd.addColorStop(0.74, st.sky[1]); grd.addColorStop(1, st.sky[0]);
      g.fillStyle = grd; g.fillRect(0, 0, W, hh);
      // 星
      if (st.sky[3] === '#050a18' || st.sky[3] === '#2a1f4d' || st.sky[3] === '#141c3f' || st.sky[3] === '#2b1740') {
        g.fillStyle = '#fff';
        for (var i = 0; i < 90; i++) {
          var sx = (i * 97.13) % W, sy = (i * 53.7) % (hh * 0.62);
          g.globalAlpha = 0.15 + ((i * 37) % 60) / 100;
          g.fillRect(sx, sy, 1.6, 1.6);
        }
        g.globalAlpha = 1;
      }
      this.cv = c; this.key = k; return c;
    }
  };

  /* ── パーティクル（プール） ────────────────────────────────────────── */
  var MAX_P = 240;
  var P = [];
  function spawn(type, x, y, o) {
    if (P.length >= MAX_P) P.shift();
    o = o || {};
    P.push({
      t: type, x: x, y: y,
      vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0,
      life: o.life || 0.7, age: 0,
      r: o.r || 3, c: o.c || '#fff', a: o.a == null ? 1 : o.a,
      rot: o.rot || 0, vr: o.vr || 0, z: o.z || 0
    });
  }
  function burst(x, y, color, n, power) {
    power = power || 1;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = rf(50, 300) * power;
      spawn('spark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70, g: 420,
        life: rf(0.5, 1.1), r: rf(2, 5), c: color });
    }
  }

  /* ── ゲーム状態 ────────────────────────────────────────────────────── */
  var G = null;
  function newGame() {
    G = {
      mode: 'play', phase: 'ask',
      dist: 0, lives: 3, combo: 0, bestCombo: 0, level: 1, qCount: 0,
      q: null, chosen: null, correctLane: 1, blocked: {},
      tQ: 3.4, tLeft: 3.4,
      charLane: 1, charX: 0, run: 0, speed: 1, bob: 0,
      scroll: 0, worldZ: 0, bend: 0, bendT: 0,
      shake: 0, timeScale: 1, slowT: 0,
      resolveT: 0, kind: '', move: '',
      missed: [], recent: [], correct: 0, answered: 0,
      hints: { scroll: 3, sand: 3, eye: 3 }, sandT: 0,
      flashT: 0, flashColor: '', rainbow: 0, cineT: 0, cineText: '',
      boss: null, bossCleared: [], chest: null, chestIn: 7,
      banner: '', bannerT: 0, godRay: 0, stageIdx: 0, stageFlash: 0,
      trail: [], newBest: false, coachT: Store.seen() ? 0 : 4.5
    };
    P.length = 0;
    G.charX = W / 2;
    updateHints(); updateHud();
    nextQuestion();
  }

  function timeForLevel(lv) { return clamp(3.6 - (lv - 1) * 0.17, 1.5, 3.6); }
  function updateLevel() {
    var byDist = 1 + Math.floor(G.dist / 220);
    var acc = G.answered ? G.correct / G.answered : 1;
    G.level = clamp(byDist + (acc > 0.85 ? 1 : acc < 0.5 ? -1 : 0), 1, 14);
  }
  function maxDifficulty() { return G.level <= 2 ? 1 : G.level <= 5 ? 2 : G.level <= 8 ? 3 : 4; }

  function pickWord() {
    var maxD = maxDifficulty();
    var due = G.missed.filter(function (w) { return G.recent.indexOf(w.w) < 0; });
    if (due.length && Math.random() < 0.4) return pick(due);
    var pool = WORDS.filter(function (w) { return w.d <= maxD && G.recent.indexOf(w.w) < 0; });
    if (!pool.length) pool = WORDS.filter(function (w) { return w.d <= maxD; });
    if (!pool.length) pool = WORDS.slice();
    var top = pool.filter(function (w) { return w.d >= maxD - 1; });
    return pick(top.length ? top : pool);
  }

  function nextQuestion() {
    G.phase = 'ask'; G.chosen = null; G.blocked = {};
    updateLevel();
    var word = pickWord();
    G.recent.push(word.w); if (G.recent.length > 6) G.recent.shift();
    var wrongs = shuffle(word.x).slice(0, 2);
    var choices = shuffle([word.a, wrongs[0], wrongs[1]]);
    G.correctLane = choices.indexOf(word.a);
    G.q = { word: word, choices: choices };
    G.qCount++;
    G.tQ = G.boss ? timeForLevel(G.level + 2) : timeForLevel(G.level);
    G.tLeft = G.tQ;
    el.word.textContent = word.w;
    el.word.className = 'qword show';
    if (el.live) el.live.textContent = word.w + '。左:' + choices[0] + '、中央:' + choices[1] + '、右:' + choices[2];
    // 宝箱の予約
    if (!G.boss && G.chestIn-- <= 0) { G.chest = { lane: rnd(3), got: false }; G.chestIn = 6 + rnd(5); }
    else if (!G.boss) G.chest = null;
  }

  /* ── 回答 ──────────────────────────────────────────────────────────── */
  function choose(lane) {
    if (!G || G.mode !== 'play' || G.phase !== 'ask') return;
    if (G.blocked[lane]) return;
    G.chosen = lane; G.charLane = lane;
    resolve();
  }

  function resolve() {
    G.phase = 'resolve'; G.answered++;
    var ok = (G.chosen === G.correctLane);
    var st = stageFor(G.dist);
    el.word.className = 'qword ' + (ok ? 'ok' : 'ng');

    if (ok) {
      G.kind = 'good';
      G.move = WINMOVES[G.qCount % WINMOVES.length];
      G.correct++; G.combo++; G.bestCombo = Math.max(G.bestCombo, G.combo);
      var gain = 20 + Math.min(G.combo, 15);
      G.dist += gain;
      G.speed = clamp(1 + G.combo * 0.05, 1, 2.4);
      Sfx.good(G.combo); Sfx.whoosh();
      burst(G.charX, H * 0.78, st.part, 26, 1);
      G.banner = WIN_LABEL[G.move]; G.bannerT = 0.9;

      // 神回避（残り時間わずかで正解）→ スロー演出
      if (G.tLeft < G.tQ * 0.16) {
        G.slowT = 0.55; G.timeScale = 0.32; Sfx.slowmo();
        cine('神回避！', '#ffe9a8');
      }
      // 宝箱
      if (G.chest && !G.chest.got && G.chest.lane === G.chosen) {
        G.chest.got = true; G.dist += 60;
        burst(G.charX, H * 0.70, '#ffd76a', 44, 1.3);
        Sfx.chime(); cine('宝箱 +60m', '#ffd76a');
      }
      // コンボの節目
      if (G.combo === 5) { G.flashT = 0.3; G.flashColor = st.part; }
      if (G.combo === 10) { Sfx.fanfare(); cine('10 COMBO', st.edge); G.godRay = 1; }
      if (G.combo === 25) { Sfx.fanfare(); cine('25 COMBO 覚醒', '#ffd76a'); G.godRay = 1; }
      if (G.combo === 50) { Sfx.fanfare(); cine('50 COMBO 伝説', '#ff9ad5'); G.rainbow = Math.max(G.rainbow, 1); }
      if (G.combo >= 100 && G.combo % 100 === 0) {
        Sfx.fanfare(); cine(G.combo + ' COMBO 虹の軌跡', '#fff'); G.rainbow = 1; G.slowT = 0.5; G.timeScale = 0.35;
      }
      if (G.boss) { G.boss.hits++; if (G.boss.hits >= BOSS_HITS) defeatBoss(); }
      G.resolveT = 0.6;
    } else {
      G.kind = 'bad';
      G.move = FAILMOVES[G.qCount % FAILMOVES.length];
      G.combo = 0; G.speed = 1; G.shake = 0.8; G.lives--;
      Sfx.bad();
      addMissed(G.q.word);
      G.banner = (G.chosen == null ? '時間切れ…' : FAIL_LABEL[G.move]) + '  正解: ' + G.q.word.a;
      G.bannerT = 1.3;
      G.flashT = 0.25; G.flashColor = '#ff5a6a';
      for (var i = 0; i < 18; i++) spawn('dust', G.charX + rf(-30, 30), H * 0.80, { vx: rf(-120, 120), vy: rf(-160, -40), g: 380, life: rf(0.4, 0.9), r: rf(3, 7), c: '#c9b8a8' });
      G.resolveT = 0.95;
    }
    updateHud();
  }

  function addMissed(w) { for (var i = 0; i < G.missed.length; i++) if (G.missed[i].w === w.w) return; G.missed.push(w); }

  function afterResolve() {
    if (G.lives <= 0) return gameOver();
    var before = G.stageIdx;
    G.stageIdx = stageIndex(G.dist);
    if (G.stageIdx !== before) { G.stageFlash = 1.2; Sfx.chime(); cine(stageFor(G.dist).name, stageFor(G.dist).edge); Sky.invalidate(); }
    if (!G.boss) {
      for (var b = 0; b < BOSS_AT.length; b++) {
        if (G.dist >= BOSS_AT[b] && G.bossCleared.indexOf(BOSS_AT[b]) < 0) { startBoss(BOSS_AT[b]); break; }
      }
    }
    nextQuestion();
  }

  function startBoss(at) {
    G.boss = { at: at, hits: 0, sway: 0, intro: 1 };
    Sfx.boss(); cine('魔獣あらわる', '#ff7a8a'); G.shake = 0.5;
  }
  function defeatBoss() {
    G.bossCleared.push(G.boss.at);
    burst(W / 2, horizonY + 40, '#ffd76a', 70, 1.6);
    Sfx.fanfare(); cine('魔獣 撃破！', '#ffd76a');
    G.rainbow = Math.max(G.rainbow, 0.8); G.boss = null; G.dist += 40;
  }

  function cine(text, color) { G.cineText = text; G.cineT = 1.25; el.cine.textContent = text; el.cine.style.color = color || '#fff'; el.cine.className = 'cine show'; }

  /* ── ヒント ────────────────────────────────────────────────────────── */
  function useScroll() {
    if (!G || G.phase !== 'ask' || G.hints.scroll <= 0) return;
    var wrong = [0, 1, 2].filter(function (i) { return i !== G.correctLane && !G.blocked[i]; });
    if (!wrong.length) return;
    G.blocked[pick(wrong)] = true; G.hints.scroll--; Sfx.chime(); updateHints();
  }
  function useSand() {
    if (!G || G.phase !== 'ask' || G.hints.sand <= 0) return;
    G.sandT = 2.4; G.hints.sand--; Sfx.chime(); updateHints();
  }
  function useEye() {
    if (!G || G.phase !== 'ask' || G.hints.eye <= 0) return;
    G.eyeT = 0.8; G.hints.eye--; Sfx.chime(); updateHints();
  }
  function updateHints() {
    if (!el.hintScrollN) return;
    el.hintScrollN.textContent = G.hints.scroll;
    el.hintSandN.textContent = G.hints.sand;
    el.hintEyeN.textContent = G.hints.eye;
    el.hintScroll.classList.toggle('off', G.hints.scroll <= 0);
    el.hintSand.classList.toggle('off', G.hints.sand <= 0);
    el.hintEye.classList.toggle('off', G.hints.eye <= 0);
  }

  function updateHud() {
    el.dist.textContent = Math.round(G.dist);
    el.stage.textContent = stageFor(G.dist).name;
    if (G.combo >= 2) { el.comboWrap.classList.add('on'); el.combo.textContent = G.combo; }
    else el.comboWrap.classList.remove('on');
    el.comboWrap.classList.toggle('hot', G.combo >= 10);
    el.comboWrap.classList.toggle('rainbow', G.combo >= 50);
    var h = '';
    for (var i = 0; i < 3; i++) h += '<i class="' + (i < G.lives ? 'on' : '') + '"></i>';
    el.lives.innerHTML = h;
  }

  /* ── 道の形状（うねる一本道） ──────────────────────────────────────── */
  function scaleAt(z) { return 1 / (1 + z * DEPTH); }
  function roadY(z) { return horizonY + (H - horizonY) * scaleAt(z); }
  function roadHW(z) { return roadHalfBottom * scaleAt(z); }
  function bendAt(z) {
    var s = scaleAt(z);
    return G.bend * (1 - s) * (1 - s) * W * 0.55;
  }
  function laneX(lane, z) { return W / 2 + bendAt(z) + (lane - 1) * roadHW(z) * 0.62; }

  /* ── ループ ────────────────────────────────────────────────────────── */
  var raf = 0, last = 0;
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016;
    last = ts;
    if (!G || G.mode !== 'play') return;
    update(dt);
    render();
  }

  function update(dt) {
    // スロー演出
    if (G.slowT > 0) { G.slowT -= dt; if (G.slowT <= 0) G.timeScale = 1; }
    else G.timeScale = lerp(G.timeScale, 1, clamp(dt * 6, 0, 1));
    var d = dt * G.timeScale;

    var sand = G.sandT > 0 ? 0.45 : 1;
    if (G.sandT > 0) G.sandT -= d;

    var run = (G.phase === 'ask' ? 1 : 0.72) * G.speed;
    G.scroll = (G.scroll + d * (2.2 + G.combo * 0.1) * run) % 1;
    G.worldZ += d * (26 + G.combo * 1.2) * run;
    G.run += d * (9 + G.combo * 0.35) * run;
    G.bob = Math.sin(G.run * 2) * 3.2;

    // 道のうねり
    G.bendT += d * 0.32 * run;
    G.bend = Math.sin(G.bendT) * 0.55 + Math.sin(G.bendT * 0.47 + 1.3) * 0.35;

    // 主人公の横移動
    var tx = laneX(G.charLane, 0.05);
    G.charX = lerp(G.charX, tx, clamp(d * 11, 0, 1));

    // 残像トレイル
    G.trail.push({ x: G.charX, y: charY(), a: 1 });
    if (G.trail.length > 8) G.trail.shift();
    for (var i = 0; i < G.trail.length; i++) G.trail[i].a *= 0.86;

    // 走行パーティクル（足元と杖）
    if (Math.random() < 0.65) {
      var st = stageFor(G.dist);
      spawn('magic', G.charX + rf(-14, 14), H * 0.80 + rf(-4, 4),
        { vx: rf(-30, 30), vy: rf(-70, -20), g: -30, life: rf(0.5, 1.0), r: rf(1.5, 3.5), c: st.part });
    }
    if (Math.random() < 0.35) {
      spawn('dust', G.charX + rf(-16, 16), H * 0.82, { vx: rf(-70, 70), vy: rf(-40, -8), g: 120, life: rf(0.3, 0.6), r: rf(2, 5), c: 'rgba(255,255,255,0.5)' });
    }
    // 環境（葉・光の粒）
    if (Math.random() < 0.5) {
      var s2 = stageFor(G.dist);
      spawn('amb', rf(0, W), rf(horizonY, H), { vx: rf(-25, 25), vy: rf(-30, -6), life: rf(1.2, 2.4), r: rf(1.5, 3), c: s2.part, a: 0.7 });
    }
    // スピードライン
    if (G.combo >= 5 && Math.random() < 0.6) {
      spawn('line', rf(0, W), rf(horizonY, H), { vy: rf(500, 1000), life: 0.28, r: rf(20, 60), c: 'rgba(255,255,255,0.35)' });
    }

    // 問題タイマー
    if (G.phase === 'ask') {
      G.tLeft -= d * sand;
      if (G.tLeft <= 0) { G.chosen = null; resolve(); }
    } else {
      G.resolveT -= d;
      if (G.resolveT <= 0) { G.phase = 'ask'; afterResolve(); }
    }

    // 各種タイマー
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 2.2);
    if (G.flashT > 0) G.flashT -= dt;
    if (G.bannerT > 0) G.bannerT -= dt;
    if (G.cineT > 0) { G.cineT -= dt; if (G.cineT <= 0) el.cine.className = 'cine'; }
    if (G.godRay > 0) G.godRay -= dt * 0.8;
    if (G.rainbow > 0) G.rainbow -= dt * 0.35;
    if (G.stageFlash > 0) G.stageFlash -= dt;
    if (G.eyeT > 0) G.eyeT -= dt;
    if (G.coachT > 0) { G.coachT -= dt; if (G.coachT <= 0 && el.coach) el.coach.className = 'coach'; }
    if (G.boss) { G.boss.sway += d * 2; if (G.boss.intro > 0) G.boss.intro -= dt; }

    // パーティクル更新
    for (var k = P.length - 1; k >= 0; k--) {
      var p = P[k];
      p.age += dt;
      if (p.age >= p.life) { P.splice(k, 1); continue; }
      p.x += p.vx * d; p.y += p.vy * d; p.vy += p.g * d;
      if (p.t === 'line') p.y += p.vy * d;
    }

    // HUD
    el.dist.textContent = Math.round(G.dist);
    var frac = clamp(G.tLeft / G.tQ, 0, 1);
    el.word.style.setProperty('--t', frac);
    if (frac < 0.28) el.word.classList.add('urgent'); else el.word.classList.remove('urgent');
  }

  function charY() { return H * 0.78 + G.bob; }

  /* ── 描画 ──────────────────────────────────────────────────────────── */
  function render() {
    var st = stageFor(G.dist);
    ctx.save();
    var sx = 0, sy = G.bob * 0.5;
    if (G.shake > 0) { sx += rf(-1, 1) * 16 * G.shake; sy += rf(-1, 1) * 16 * G.shake; }
    ctx.translate(sx, sy);

    drawSky(st);
    drawCelestial(st);
    drawFarLayer(st);
    drawMidLayer(st);
    drawGround(st);
    drawRoad(st);
    drawScenery(st);
    if (G.godRay > 0 || st.scen === 'tree') drawGodRays(st);
    if (G.boss) drawBoss(st);      // 答えより先に描く（選択肢を絶対に隠さない）
    drawAnswers(st);
    drawChest(st);
    drawTrail(st);
    drawHero(st);
    drawParticles();
    drawFog(st);
    ctx.restore();
    drawOverlays(st);
  }

  function drawSky(st) {
    var s = Sky.get(st, 0);
    // 画面揺れで端に未描画の隙間が出ないよう、少し外側まで広げて描く
    ctx.drawImage(s, -OVERSCAN, -OVERSCAN, W + OVERSCAN * 2, horizonY + 2 + OVERSCAN);
    // オーロラ
    if (st.aurora) {
      for (var a = 0; a < st.aurora.length; a++) {
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = st.aurora[a]; ctx.lineWidth = 26;
        ctx.beginPath();
        for (var x = 0; x <= W; x += 24) {
          var y = horizonY * (0.22 + a * 0.1) + Math.sin(x * 0.012 + G.worldZ * 0.02 + a * 1.7) * 26;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawCelestial(st) {
    var cx = W * 0.72 + G.bend * -40, cy = horizonY * st.sunY;
    Sprites.drawGlow(cx, cy, W * 0.42, st.sunGlow, 0.5);
    ctx.fillStyle = st.sun;
    ctx.beginPath(); ctx.arc(cx, cy, W * 0.075, 0, 7); ctx.fill();
  }

  // 遠景シルエット（浮遊島・山・神殿）
  function drawFarLayer(st) {
    var off = (G.worldZ * 0.6) % 300;
    ctx.fillStyle = st.far; ctx.globalAlpha = 0.85;
    for (var i = -1; i < W / 300 + 2; i++) {
      var bx = i * 300 - off + G.bend * -60;
      ctx.beginPath();
      ctx.moveTo(bx, horizonY);
      ctx.lineTo(bx + 70, horizonY - 120);
      ctx.lineTo(bx + 140, horizonY - 46);
      ctx.lineTo(bx + 210, horizonY - 150);
      ctx.lineTo(bx + 300, horizonY);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 浮遊島
    var fo = (G.worldZ * 0.9) % 420;
    for (var j = -1; j < W / 420 + 2; j++) {
      var ix = j * 420 - fo + 60 + G.bend * -90;
      var iy = horizonY - 150 - ((j * 37) % 60);
      ctx.globalAlpha = 0.7; ctx.fillStyle = st.mid;
      ctx.beginPath();
      ctx.ellipse(ix, iy, 66, 16, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(ix - 52, iy + 6); ctx.lineTo(ix, iy + 62); ctx.lineTo(ix + 52, iy + 6); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.fillStyle = st.edge;
      ctx.fillRect(ix - 26, iy - 30, 5, 30); ctx.fillRect(ix + 20, iy - 30, 5, 30);
      ctx.fillRect(ix - 30, iy - 34, 60, 5);
      ctx.globalAlpha = 1;
    }
  }

  function drawMidLayer(st) {
    var off = (G.worldZ * 1.6) % 260;
    ctx.fillStyle = st.mid; ctx.globalAlpha = 0.9;
    for (var i = -1; i < W / 260 + 2; i++) {
      var bx = i * 260 - off + G.bend * -120;
      ctx.beginPath();
      ctx.moveTo(bx, horizonY + 2);
      ctx.lineTo(bx + 55, horizonY - 62);
      ctx.lineTo(bx + 120, horizonY - 20);
      ctx.lineTo(bx + 190, horizonY - 78);
      ctx.lineTo(bx + 260, horizonY + 2);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 大滝ステージは滝を描く
    if (st.scen === 'fall') {
      var fx = W * 0.5 + G.bend * -150;
      ctx.globalAlpha = 0.30; ctx.fillStyle = '#dff0ff';
      ctx.fillRect(fx - 76, horizonY - 128, 152, 130);
      ctx.globalAlpha = 0.22;
      for (var s = 0; s < 8; s++) {
        var sxx = fx - 68 + s * 18;
        ctx.fillRect(sxx, horizonY - 128 + ((G.worldZ * 40 + s * 30) % 128) - 128, 4, 128);
      }
      ctx.globalAlpha = 1;
      Sprites.drawGlow(fx, horizonY, 110, '#dff0ff', 0.18);
    }
  }

  function drawGround(st) {
    ctx.fillStyle = st.ground;
    ctx.fillRect(-OVERSCAN, horizonY, W + OVERSCAN * 2, H - horizonY + OVERSCAN);
    // 地面の横縞（流れる）
    ctx.fillStyle = st.near; ctx.globalAlpha = 0.5;
    for (var i = 0; i < 16; i++) {
      var z = ((i + (G.scroll)) / 16);
      var y0 = roadY(z), y1 = roadY(Math.min(z + 0.03, 1));
      if (i % 2 === 0) ctx.fillRect(-OVERSCAN, y1, W + OVERSCAN * 2, Math.max(1, y0 - y1));
    }
    ctx.globalAlpha = 1;
  }

  function drawRoad(st) {
    // 台形をセグメント分割して曲げる
    var segs = 26;
    ctx.beginPath();
    var i, z, y, hw, bx;
    for (i = 0; i <= segs; i++) { z = i / segs; y = roadY(z); hw = roadHW(z); bx = W / 2 + bendAt(z); (i === 0) ? ctx.moveTo(bx - hw, y) : ctx.lineTo(bx - hw, y); }
    for (i = segs; i >= 0; i--) { z = i / segs; y = roadY(z); hw = roadHW(z); bx = W / 2 + bendAt(z); ctx.lineTo(bx + hw, y); }
    ctx.closePath();
    var grd = ctx.createLinearGradient(0, horizonY, 0, H);
    grd.addColorStop(0, st.mid); grd.addColorStop(1, st.road);
    ctx.fillStyle = grd; ctx.fill();

    // 道の縁の発光ライン
    ctx.strokeStyle = st.edge; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.65;
    for (var side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      for (i = 0; i <= segs; i++) { z = i / segs; y = roadY(z); hw = roadHW(z); bx = W / 2 + bendAt(z); (i === 0) ? ctx.moveTo(bx + side * hw, y) : ctx.lineTo(bx + side * hw, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // レーン境界のルーン（流れる）
    ctx.globalAlpha = 0.5; ctx.strokeStyle = st.rune; ctx.lineWidth = 2;
    for (var b = -1; b <= 1; b += 2) {
      for (var s = 0; s < 12; s++) {
        var z0 = ((s + G.scroll) / 12) % 1, z1 = z0 + 0.028;
        if (z1 > 0.98) continue;
        var x0 = W / 2 + bendAt(z0) + b * roadHW(z0) * 0.32;
        var x1 = W / 2 + bendAt(z1) + b * roadHW(z1) * 0.32;
        ctx.beginPath(); ctx.moveTo(x0, roadY(z0)); ctx.lineTo(x1, roadY(z1)); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* 道の脇を流れる景色（速度感の主役） */
  function drawScenery(st) {
    var count = 12;
    for (var i = 0; i < count; i++) {
      // 手前へ流れてくるように z を進行方向と逆に送る
      var z = ((i / count) - (G.worldZ * 0.05)) % 1; if (z < 0) z += 1;
      if (z > 0.97) continue;
      var s = scaleAt(z), y = roadY(z), hw = roadHW(z);
      for (var side = -1; side <= 1; side += 2) {
        var x = W / 2 + bendAt(z) + side * hw * (1.25 + ((i * 13) % 5) * 0.08);
        var h = (110 + ((i * 29) % 70)) * s * 3.2;
        drawProp(st, x, y, h, s, i + side);
      }
    }
  }

  function drawProp(st, x, y, h, s, seed) {
    var w = h * 0.26;
    ctx.globalAlpha = clamp(s * 3.2, 0, 1);
    if (st.scen === 'tree') {
      ctx.fillStyle = '#20402f';
      ctx.fillRect(x - w * 0.13, y - h * 0.55, w * 0.26, h * 0.55);
      ctx.fillStyle = '#2f7a52';
      ctx.beginPath(); ctx.ellipse(x, y - h * 0.66, w * 0.9, h * 0.34, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#49a86e';
      ctx.beginPath(); ctx.ellipse(x - w * 0.2, y - h * 0.78, w * 0.55, h * 0.22, 0, 0, 7); ctx.fill();
      if (s > 0.14) Sprites.drawGlow(x, y - h * 0.66, h * 0.22, '#b6ffcf', 0.16);
    } else if (st.scen === 'crystal') {
      ctx.fillStyle = '#8fd6ff';
      ctx.beginPath(); ctx.moveTo(x, y - h * 0.9); ctx.lineTo(x + w * 0.4, y - h * 0.2); ctx.lineTo(x, y); ctx.lineTo(x - w * 0.4, y - h * 0.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#dff2ff';
      ctx.beginPath(); ctx.moveTo(x, y - h * 0.9); ctx.lineTo(x + w * 0.18, y - h * 0.25); ctx.lineTo(x, y - h * 0.05); ctx.closePath(); ctx.fill();
      if (s > 0.14) Sprites.drawGlow(x, y - h * 0.5, h * 0.3, '#bfe4ff', 0.2);
    } else if (st.scen === 'temple') {
      ctx.fillStyle = st.near;
      ctx.fillRect(x - w * 0.32, y - h * 0.85, w * 0.64, h * 0.85);
      ctx.fillStyle = st.edge; ctx.globalAlpha *= 0.75;
      ctx.fillRect(x - w * 0.42, y - h * 0.92, w * 0.84, h * 0.08);
      ctx.globalAlpha = clamp(s * 3.2, 0, 1);
      if (s > 0.14) Sprites.drawGlow(x, y - h * 0.5, h * 0.26, st.edge, 0.16);
    } else if (st.scen === 'fall') {
      ctx.fillStyle = st.near;
      ctx.beginPath(); ctx.moveTo(x - w * 0.5, y); ctx.lineTo(x - w * 0.2, y - h * 0.8); ctx.lineTo(x + w * 0.3, y - h * 0.55); ctx.lineTo(x + w * 0.5, y); ctx.closePath(); ctx.fill();
      if (s > 0.14) Sprites.drawGlow(x, y - h * 0.4, h * 0.24, '#dff0ff', 0.14);
    } else { // ruin
      ctx.fillStyle = st.near;
      ctx.fillRect(x - w * 0.3, y - h * 0.75, w * 0.6, h * 0.75);
      ctx.fillStyle = st.mid;
      ctx.fillRect(x - w * 0.44, y - h * 0.82, w * 0.88, h * 0.09);
      if (s > 0.14) Sprites.drawGlow(x, y - h * 0.45, h * 0.22, st.edge, 0.14);
    }
    ctx.globalAlpha = 1;
  }

  function drawGodRays(st) {
    // 強すぎると画面全体が白飛びして文字が読めなくなるため控えめに
    var a = 0.035 + Math.max(0, G.godRay) * 0.055;
    ctx.globalAlpha = a;
    ctx.fillStyle = st.sunGlow;
    for (var i = 0; i < 5; i++) {
      var x = W * (0.18 + i * 0.17) + Math.sin(G.worldZ * 0.01 + i) * 20;
      ctx.beginPath();
      ctx.moveTo(x, horizonY - 40);
      ctx.lineTo(x + 60, horizonY - 40);
      ctx.lineTo(x + 150, H);
      ctx.lineTo(x - 30, H);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* 3つの答え = 道の上に浮かぶクリスタル板（ボタンではない）
     板は読みやすさを最優先に画面幅で等間隔に置き、光の柱で「その板がどの道か」を示す。
     遠近そのままだと道幅が狭く3枚が重なって読めなくなるため、板だけ画面座標で配置する。 */
  function answerLayout(i, txt) {
    var fs = Math.round(clamp(W * 0.048, 14, 23));
    var slot = W * 0.313;                       // 板の中心間隔
    var maxW = slot - 8;
    ctx.font = '800 ' + fs + 'px -apple-system,"Hiragino Sans",system-ui,sans-serif';
    var tw = ctx.measureText(txt).width;
    while (tw > maxW - 20 && fs > 11) {         // 長い日本語は縮めて必ず収める
      fs -= 1;
      ctx.font = '800 ' + fs + 'px -apple-system,"Hiragino Sans",system-ui,sans-serif';
      tw = ctx.measureText(txt).width;
    }
    var pw = clamp(tw + 22, 72, maxW), ph = 46;
    var x = W / 2 + (i - 1) * slot;
    x = clamp(x, pw / 2 + 5, W - pw / 2 - 5);   // 画面外へ出さない
    return { x: x, pw: pw, ph: ph, fs: fs };
  }

  function drawAnswers(st) {
    if (!G.q) return;
    var pz = 0.30;                               // 光の柱が着地する道の深さ
    var landY = roadY(pz);
    var baseY = H * ANSWER_Y;

    for (var i = 0; i < 3; i++) {
      var txt = G.q.choices[i];
      var L = answerLayout(i, txt);
      var x = L.x, pw = L.pw, ph = L.ph;
      var py = baseY - Math.sin(G.run * 0.6 + i * 1.3) * 4;   // ふわりと浮遊
      var lx = laneX(i, pz);                     // 対応する道の位置

      var isC = (i === G.correctLane), chosen = (G.phase !== 'ask' && G.chosen === i);
      var blocked = !!G.blocked[i], hint = (G.eyeT > 0 && isC);
      var col = st.rune, glow = st.edge, alpha = 1;
      if (G.phase !== 'ask') {
        if (isC) { col = '#c9ffd8'; glow = '#7dffa8'; }
        else if (chosen) { col = '#ffc3c3'; glow = '#ff6a6a'; }
        else alpha = 0.32;
      }
      if (blocked) alpha = 0.18;
      if (hint) glow = '#7dffa8';

      // 光の柱: 板の下から、その道の着地点へ向かって細くなる（下ほど淡く溶ける）
      ctx.globalAlpha = alpha * (hint || (G.phase !== 'ask' && isC) ? 0.34 : 0.16);
      var beam = ctx.createLinearGradient(0, py + ph * 0.5, 0, landY);
      beam.addColorStop(0, glow);
      beam.addColorStop(1, Sprites.fade(glow, 0));
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(x - pw * 0.30, py + ph * 0.5);
      ctx.lineTo(x + pw * 0.30, py + ph * 0.5);
      ctx.lineTo(lx + 9, landY);
      ctx.lineTo(lx - 9, landY);
      ctx.closePath(); ctx.fill();
      // 着地点の光
      ctx.globalAlpha = alpha * 0.5;
      Sprites.drawGlow(lx, landY, 26, glow, alpha * 0.5);
      ctx.globalAlpha = alpha;

      if (hint || (G.phase !== 'ask' && isC)) Sprites.drawGlow(x, py, pw * 0.8, glow, 0.45 * alpha);

      // ガラス板
      ctx.fillStyle = 'rgba(10,14,30,0.52)';
      ctx.roundRect(x - pw / 2, py - ph / 2, pw, ph, 16); ctx.fill();
      ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = glow; ctx.lineWidth = 1.6;
      ctx.roundRect(x - pw / 2, py - ph / 2, pw, ph, 16); ctx.stroke();
      ctx.globalAlpha = alpha * 0.16; ctx.fillStyle = '#fff';
      ctx.roundRect(x - pw / 2 + 4, py - ph / 2 + 3, pw - 8, ph * 0.34, 12); ctx.fill();

      ctx.globalAlpha = alpha;
      ctx.font = '800 ' + L.fs + 'px -apple-system,"Hiragino Sans",system-ui,sans-serif';
      ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, x, py + 1);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function drawChest(st) {
    if (!G.chest || G.chest.got) return;
    var z = 0.20, x = laneX(G.chest.lane, z), y = roadY(z), s = scaleAt(z);
    var w = 46 * s * 3.4, h = 34 * s * 3.4;
    Sprites.drawGlow(x, y - h * 0.6, w * 1.1, '#ffd76a', 0.4);
    ctx.fillStyle = '#8a5a2a'; ctx.roundRect(x - w / 2, y - h, w, h, 6); ctx.fill();
    ctx.fillStyle = '#ffd76a'; ctx.fillRect(x - w / 2, y - h * 0.62, w, h * 0.16);
    ctx.fillStyle = '#5a3a18'; ctx.fillRect(x - w * 0.07, y - h * 0.72, w * 0.14, h * 0.34);
  }

  // 魔獣は「空にそびえる」位置に置く。
  // 上は問題の文字、下は答えの板。その間の空きから大きさと位置を決め、どちらも絶対に覆わない。
  var ANSWER_Y = 0.55;                                      // 答えの板の中心（画面高さ比）
  function bossCeil() { return H * 0.30; }                   // 問題の文字より下
  function bossFloor() { return H * ANSWER_Y - 46 / 2 - 10; } // 答えの板の上端 - 余白
  function bossGeom() {
    var s = 1 + (G.boss && G.boss.intro > 0 ? G.boss.intro * 0.25 : 0);
    var maxSize = Math.max(24, (bossFloor() - bossCeil()) / 1.10);
    var size = Math.min(W * 0.26 * s, maxSize);
    var half = size * 0.55;
    var y = clamp(horizonY - size * 0.50, bossCeil() + half, bossFloor() - half);
    return { size: size, y: y, top: y - half, bottom: y + half };
  }

  function drawBoss(st) {
    var b = G.boss;
    var gm = bossGeom();
    var size = gm.size, y = gm.y;
    // うねりに合わせて揺れるが、必ず画面内に収める
    var x = clamp(W / 2 + Math.sin(b.sway) * 18 + bendAt(0.85) * 0.45,
                  size * 0.64, W - size * 0.64);
    Sprites.drawGlow(x, y - size * 0.2, size * 1.5, '#ff7a8a', 0.35);
    // 体
    ctx.fillStyle = '#241a33';
    ctx.beginPath(); ctx.ellipse(x, y - size * 0.15, size * 0.62, size * 0.55, 0, 0, 7); ctx.fill();
    // 角
    ctx.strokeStyle = '#ff9ab0'; ctx.lineWidth = size * 0.07; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - size * 0.4, y - size * 0.5); ctx.lineTo(x - size * 0.62, y - size * 0.92); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + size * 0.4, y - size * 0.5); ctx.lineTo(x + size * 0.62, y - size * 0.92); ctx.stroke();
    // 目
    ctx.fillStyle = '#ffe066';
    ctx.beginPath(); ctx.ellipse(x - size * 0.22, y - size * 0.22, size * 0.1, size * 0.06, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + size * 0.22, y - size * 0.22, size * 0.1, size * 0.06, 0, 0, 7); ctx.fill();
    // HP（魔獣の直下、答えの板より上）
    var bw = W * 0.42, bx = (W - bw) / 2, by = gm.bottom + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.roundRect(bx, by, bw, 7, 4); ctx.fill();
    ctx.fillStyle = '#ff6a8a'; ctx.roundRect(bx, by, bw * (1 - b.hits / BOSS_HITS), 7, 4); ctx.fill();
  }

  function drawTrail(st) {
    for (var i = 0; i < G.trail.length; i++) {
      var t = G.trail[i];
      if (t.a < 0.06) continue;
      ctx.globalAlpha = t.a * 0.22;
      ctx.fillStyle = st.part;
      ctx.beginPath(); ctx.ellipse(t.x, t.y - 26, 13, 22, 0, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ── 主人公: 魔法使いの少女（後ろ姿・常に奥へ走る） ─────────────────── */
  function drawHero(st) {
    var x = G.charX, y = charY();
    var t = G.run;
    var jump = 0, tilt = 0, squash = 1, fallY = 0;

    if (G.phase === 'resolve') {
      var pr = 1 - clamp(G.resolveT / (G.kind === 'good' ? 0.6 : 0.95), 0, 1);
      if (G.kind === 'good') {
        if (G.move === 'jump' || G.move === 'bridge' || G.move === 'rope') jump = Math.sin(pr * Math.PI) * 92;
        else if (G.move === 'slide') { squash = 0.62; y += 16; }
        else if (G.move === 'wallrun') { tilt = -0.28; x += Math.sin(pr * Math.PI) * 34; }
        else if (G.move === 'strike') tilt = Math.sin(pr * Math.PI * 3) * 0.14;
      } else {
        if (G.move === 'fall') { fallY = pr * pr * 150; tilt = pr * 1.1; }
        else if (G.move === 'crash') { tilt = Math.sin(pr * 26) * 0.2 * (1 - pr); squash = 1 - pr * 0.22; }
        else if (G.move === 'spike') { tilt = -pr * 0.5; y -= pr * 12; }
        else { tilt = pr * 0.8; y += pr * 18; }
      }
    }
    y += fallY;
    var scale = clamp(W / 330, 0.95, 1.5);   // 主人公の存在感を確保

    ctx.save();
    ctx.translate(x, y - jump);
    ctx.rotate(tilt);
    ctx.scale(scale, scale * squash);

    // 影
    ctx.globalAlpha = clamp(0.34 - jump / 400, 0.06, 0.34);
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 34 + jump * 0.35, 22, 6.5, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;

    var legA = Math.sin(t) * 10, legB = Math.sin(t + Math.PI) * 10;
    var sway = Math.sin(t * 0.9) * 3.6;          // 走りに合わせた横揺れ
    var wind = Math.sin(t * 1.7) * 2.6;          // 風のうねり
    var wind2 = Math.sin(t * 1.7 + 0.9) * 3.2;

    // ── マント（いちばん外側。左右に大きく広がってなびく）
    var capeG = ctx.createLinearGradient(0, -22, 0, 34);
    capeG.addColorStop(0, '#7b52c4'); capeG.addColorStop(1, '#4a2d84');
    ctx.fillStyle = capeG;
    ctx.beginPath();
    ctx.moveTo(-11, -20);
    ctx.quadraticCurveTo(-30 + sway * 1.8, 2, -24 + sway * 2.6, 30 + wind);
    ctx.quadraticCurveTo(-12 + sway * 2.2, 36 + wind2, 0, 33 + wind);
    ctx.quadraticCurveTo(12 + sway * 2.2, 36 + wind2, 24 + sway * 2.6, 30 + wind);
    ctx.quadraticCurveTo(30 + sway * 1.8, 2, 11, -20);
    ctx.closePath(); ctx.fill();
    // マントの裏地の陰影
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#2f1c5c';
    ctx.beginPath();
    ctx.moveTo(-8, -18);
    ctx.quadraticCurveTo(-16 + sway * 2, 6, -12 + sway * 2.4, 28 + wind);
    ctx.lineTo(12 + sway * 2.4, 28 + wind);
    ctx.quadraticCurveTo(16 + sway * 2, 6, 8, -18);
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;

    // ── 脚（走行サイクル）
    ctx.strokeStyle = '#f0cfa4'; ctx.lineWidth = 5.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5, 16); ctx.lineTo(-6, 30 + legA); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, 16); ctx.lineTo(6, 30 + legB); ctx.stroke();
    // ブーツ
    ctx.strokeStyle = '#3a2a5e'; ctx.lineWidth = 7.2;
    ctx.beginPath(); ctx.moveTo(-6, 27 + legA); ctx.lineTo(-6.5, 34 + legA); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 27 + legB); ctx.lineTo(6.5, 34 + legB); ctx.stroke();

    // ── スカート（揺れる）
    var skirtG = ctx.createLinearGradient(0, 0, 0, 22);
    skirtG.addColorStop(0, '#5a3f9c'); skirtG.addColorStop(1, '#3a2668');
    ctx.fillStyle = skirtG;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.quadraticCurveTo(-16 + sway * 1.2, 14, -13 + sway * 1.6, 19 + wind * 0.6);
    ctx.lineTo(13 + sway * 1.6, 19 + wind * 0.6);
    ctx.quadraticCurveTo(16 + sway * 1.2, 14, 10, 0);
    ctx.closePath(); ctx.fill();

    // ── 上体（白いローブ）
    var body = ctx.createLinearGradient(0, -20, 0, 4);
    body.addColorStop(0, '#fdf6ff'); body.addColorStop(1, '#d9c8f5');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.roundRect(-9.5, -19, 19, 22, 8); ctx.fill();
    // 腕（走りに合わせて前後）
    ctx.strokeStyle = '#efe3ff'; ctx.lineWidth = 4.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8.5, -13); ctx.lineTo(-10.5 - legA * 0.2, -4 + legA * 0.26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8.5, -13); ctx.lineTo(10.5 - legB * 0.2, -4 + legB * 0.26); ctx.stroke();

    // ── 長い髪（細めの毛束が3つ、風になびく）
    var hairG = ctx.createLinearGradient(0, -32, 0, 22);
    hairG.addColorStop(0, '#ffeec4'); hairG.addColorStop(0.45, '#ffd98f'); hairG.addColorStop(1, '#e8a95f');
    ctx.fillStyle = hairG;
    ctx.beginPath();
    ctx.moveTo(-9.5, -30);
    ctx.quadraticCurveTo(-14 + sway * 1.5, -8, -10 + sway * 2.5, 14 + wind);
    ctx.quadraticCurveTo(-5 + sway * 2.8, 21 + wind2, 0 + sway * 2.6, 19 + wind);
    ctx.quadraticCurveTo(5 + sway * 2.8, 21 + wind2, 10 + sway * 2.5, 14 + wind);
    ctx.quadraticCurveTo(14 + sway * 1.5, -8, 9.5, -30);
    ctx.closePath(); ctx.fill();
    // 毛先が風で分かれる
    ctx.strokeStyle = hairG; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8 + sway * 2, 8); ctx.quadraticCurveTo(-15 + sway * 3, 16 + wind, -17 + sway * 3.4, 23 + wind2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8 + sway * 2, 8); ctx.quadraticCurveTo(15 + sway * 3, 16 + wind, 17 + sway * 3.4, 23 + wind2); ctx.stroke();
    // 毛束のハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.42)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-4, -25); ctx.quadraticCurveTo(-7 + sway * 2.2, -2, -4 + sway * 2.6, 15 + wind); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -25); ctx.quadraticCurveTo(7 + sway * 2.2, -2, 4 + sway * 2.6, 15 + wind); ctx.stroke();

    // ── 頭（後頭部・髪で覆う）
    ctx.fillStyle = hairG;
    ctx.beginPath(); ctx.arc(0, -30, 11.2, 0, 7); ctx.fill();
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(-3.5, -33, 5, 3.4, -0.5, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;

    // ── とんがり帽子（揺れる）
    var hatSway = Math.sin(t * 0.9 + 0.6) * 5.5;
    var hatG = ctx.createLinearGradient(0, -66, 0, -34);
    hatG.addColorStop(0, '#6f4bb0'); hatG.addColorStop(1, '#3f2670');
    ctx.fillStyle = hatG;
    ctx.beginPath();
    ctx.moveTo(-14, -36);
    ctx.quadraticCurveTo(-7 + hatSway * 0.4, -52, hatSway, -73);   // 先が長くしなる
    ctx.quadraticCurveTo(7 + hatSway * 0.7, -50, 14, -36);
    ctx.closePath(); ctx.fill();
    // ハットバンド（つばの付け根に細く）
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.ellipse(0, -39.5, 12.4, 3.1, 0, 0, 7); ctx.fill();
    // つば
    ctx.fillStyle = '#7b52c4';
    ctx.beginPath(); ctx.ellipse(0, -36, 19.5, 5.4, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 0.28; ctx.fillStyle = '#2f1c5c';
    ctx.beginPath(); ctx.ellipse(0, -34.6, 19.5, 4.4, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
    // 先端の星
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(hatSway, -73, 2.8, 0, 7); ctx.fill();

    // ── 杖（右手・光る先端）
    ctx.strokeStyle = '#8a5a3a'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(15, 14); ctx.lineTo(19, -30); ctx.stroke();
    ctx.restore();

    // 杖の光（スケール外の実座標で）
    var tipX = x + 19 * scale, tipY = (y - jump) - 33 * scale;
    Sprites.drawGlow(tipX, tipY, 26 * scale, st.part, 0.85);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(tipX, tipY, 3.4 * scale, 0, 7); ctx.fill();
    if (Math.random() < 0.5) {
      spawn('magic', tipX, tipY, { vx: rf(-24, 24), vy: rf(-46, -12), g: -20, life: rf(0.5, 1.0), r: rf(1.4, 3), c: st.part });
    }

    // コンボのオーラ
    if (G.combo >= 10) {
      var aur = G.combo >= 50 ? hueColor(G.worldZ * 3) : st.edge;
      Sprites.drawGlow(x, y - jump - 16, 74 * scale, aur, 0.30 + Math.min(G.combo, 60) / 300);
    }
  }

  function hueColor(h) { return 'hsl(' + Math.round(h % 360) + ',95%,68%)'; }

  function drawParticles() {
    for (var i = 0; i < P.length; i++) {
      var p = P[i], k = 1 - p.age / p.life;
      if (p.t === 'line') {
        ctx.globalAlpha = k * 0.5; ctx.strokeStyle = p.c; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + p.r); ctx.stroke();
      } else if (p.t === 'magic') {
        Sprites.drawGlow(p.x, p.y, p.r * 4, p.c, k * 0.8);
      } else {
        ctx.globalAlpha = k * (p.a == null ? 1 : p.a);
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + k * 0.6), 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFog(st) {
    var g = ctx.createLinearGradient(0, horizonY - 30, 0, horizonY + 90);
    g.addColorStop(0, st.fog); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, horizonY - 30, W, 130);
  }

  function drawOverlays(st) {
    // ビネット
    var vg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.32, W / 2, H * 0.55, H * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // 虹（100コンボ等）
    if (G.rainbow > 0) {
      ctx.globalAlpha = G.rainbow * 0.20;
      for (var i = 0; i < 7; i++) {
        ctx.fillStyle = hueColor(i * 51 + G.worldZ * 4);
        ctx.fillRect(0, H * 0.1 + i * (H * 0.03), W, H * 0.03);
      }
      ctx.globalAlpha = 1;
    }
    // フラッシュ
    if (G.flashT > 0) {
      ctx.globalAlpha = clamp(G.flashT * 1.6, 0, 0.5);
      ctx.fillStyle = G.flashColor || '#fff';
      ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
    // ステージ切替の白光
    if (G.stageFlash > 0) {
      ctx.globalAlpha = clamp(G.stageFlash * 0.35, 0, 0.4);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
    // バナー（世界に馴染む細い文字）
    if (G.bannerT > 0 && G.banner) {
      ctx.globalAlpha = clamp(G.bannerT * 1.4, 0, 1);
      ctx.font = '800 ' + Math.round(clamp(W * 0.045, 14, 20)) + 'px -apple-system,"Hiragino Sans",system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      var bw = ctx.measureText(G.banner).width + 28;
      ctx.roundRect(W / 2 - bw / 2, H * 0.62, bw, 34, 17); ctx.fill();
      ctx.fillStyle = G.kind === 'good' ? '#c9ffd8' : '#ffc9c9';
      ctx.fillText(G.banner, W / 2, H * 0.62 + 22);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  }

  /* ── 結果 ──────────────────────────────────────────────────────────── */
  function gameOver() {
    G.mode = 'over';
    G.newBest = G.dist > Store.best();
    if (G.newBest) Store.setBest(G.dist);
    if (G.bestCombo > Store.bestCombo()) Store.setBestCombo(G.bestCombo);
    el.ovDist.textContent = Math.round(G.dist);
    el.ovBest.textContent = Store.best();
    el.ovCombo.textContent = G.bestCombo;
    el.ovStage.textContent = stageFor(G.dist).name;
    el.ovNew.style.display = G.newBest ? '' : 'none';
    el.ovMissed.innerHTML = '';
    if (!G.missed.length) el.ovMissed.innerHTML = '<div class="perfect">ノーミス走破！</div>';
    else G.missed.slice(0, 14).forEach(function (w) {
      var d = document.createElement('div'); d.className = 'mw';
      d.innerHTML = '<b>' + w.w + '</b><span>' + w.a + '</span>';
      el.ovMissed.appendChild(d);
    });
    show('over');
  }

  function shareText() {
    return 'WORD QUEST RUN で ' + Math.round(G.dist) + 'm 走破！ 最大 ' + G.bestCombo + ' コンボ / 到達: ' + stageFor(G.dist).name;
  }
  function doShare() {
    var t = shareText();
    if (navigator.share) { navigator.share({ title: 'WORD QUEST RUN', text: t, url: location.href }).catch(function () {}); }
    else if (navigator.clipboard) {
      navigator.clipboard.writeText(t + ' ' + location.href).then(function () {
        var b = $('#shareBtn'); if (b) { var o = b.textContent; b.textContent = 'コピーしました'; setTimeout(function () { b.textContent = o; }, 1600); }
      }).catch(function () {});
    }
  }

  /* ── 画面遷移 ──────────────────────────────────────────────────────── */
  function show(which) {
    el.title.classList.toggle('hidden', which !== 'title');
    el.over.classList.toggle('hidden', which !== 'over');
    el.howto.classList.add('hidden');
    document.body.classList.toggle('playing', which === 'play');
  }
  function startPlay() {
    Sfx.ensure(); resize(); show('play'); newGame();
    if (!Store.seen() && el.coach) { el.coach.className = 'coach show'; Store.setSeen(); }
    if (!raf) raf = requestAnimationFrame(loop);
  }

  /* ── 入力 ──────────────────────────────────────────────────────────── */
  function bindInput() {
    var field = $('#field');
    var sx = 0, sy = 0;
    field.addEventListener('touchstart', function (e) { var t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    field.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      var ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax > 38 || ay > 38) { if (ax > ay) choose(dx < 0 ? 0 : 2); else if (dy < 0) choose(1); }
      else { var f = t.clientX / window.innerWidth; choose(f < 0.34 ? 0 : f > 0.66 ? 2 : 1); }
    }, { passive: true });
    field.addEventListener('click', function (e) {
      if ('ontouchstart' in window) return;
      var f = e.clientX / window.innerWidth; choose(f < 0.34 ? 0 : f > 0.66 ? 2 : 1);
    });
    window.addEventListener('keydown', function (e) {
      if (!G || G.mode !== 'play') return;
      if (e.key === 'ArrowLeft') { choose(0); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { choose(1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { choose(2); e.preventDefault(); }
      else if (e.key === '1') choose(0); else if (e.key === '2') choose(1); else if (e.key === '3') choose(2);
    });
    el.hintScroll.addEventListener('click', function (e) { e.stopPropagation(); useScroll(); });
    el.hintSand.addEventListener('click', function (e) { e.stopPropagation(); useSand(); });
    el.hintEye.addEventListener('click', function (e) { e.stopPropagation(); useEye(); });
    $('#startBtn').addEventListener('click', startPlay);
    $('#retryBtn').addEventListener('click', startPlay);
    $('#shareBtn').addEventListener('click', doShare);
    $('#howtoBtn').addEventListener('click', function () { el.howto.classList.toggle('hidden'); });
    $('#howtoClose').addEventListener('click', function () { el.howto.classList.add('hidden'); });
    $('#homeBtn').addEventListener('click', function () { if (G) G.mode = 'title'; show('title'); el.titleBest.textContent = Store.best(); });
    el.sound.addEventListener('click', function () {
      Sfx.on = !Sfx.on; Store.setSound(Sfx.on);
      el.sound.textContent = Sfx.on ? '🔊' : '🔈';
      el.sound.setAttribute('aria-label', Sfx.on ? '音を消す' : '音を出す');
      if (Sfx.on) Sfx.ensure();
    });
    window.addEventListener('resize', function () { resize(); });
    window.addEventListener('orientationchange', function () { setTimeout(resize, 250); });
  }

  /* ── タイトル/結果の背景: 実際の世界を走り続けるデモ ────────────────── */
  // 起動した瞬間に「綺麗」と思わせるため、静止画ではなく本編と同じ描画を回す。
  function demoState() {
    newGame();
    G.mode = 'demo';
    G.q = null;                 // 問題は出さない（答えの板を描かない）
    G.chest = null;
    el.word.textContent = '';
    return G;
  }
  function updateDemo(dt) {
    var d = dt;
    G.scroll = (G.scroll + d * 2.0) % 1;
    G.worldZ += d * 26;
    G.run += d * 8.4;
    G.bob = Math.sin(G.run * 2) * 3.2;
    G.bendT += d * 0.3;
    G.bend = Math.sin(G.bendT) * 0.55 + Math.sin(G.bendT * 0.47 + 1.3) * 0.35;
    G.charX = lerp(G.charX, laneX(1, 0.05), clamp(d * 4, 0, 1));
    G.trail.push({ x: G.charX, y: charY(), a: 1 });
    if (G.trail.length > 8) G.trail.shift();
    for (var i = 0; i < G.trail.length; i++) G.trail[i].a *= 0.86;
    var st = stageFor(0);
    if (Math.random() < 0.5) spawn('magic', G.charX + rf(-14, 14), H * 0.80, { vx: rf(-30, 30), vy: rf(-70, -20), g: -30, life: rf(0.5, 1), r: rf(1.5, 3.5), c: st.part });
    if (Math.random() < 0.45) spawn('amb', rf(0, W), rf(horizonY, H), { vx: rf(-25, 25), vy: rf(-30, -6), life: rf(1.2, 2.4), r: rf(1.5, 3), c: st.part, a: 0.7 });
    for (var k = P.length - 1; k >= 0; k--) {
      var p = P[k]; p.age += dt;
      if (p.age >= p.life) { P.splice(k, 1); continue; }
      p.x += p.vx * d; p.y += p.vy * d; p.vy += p.g * d;
    }
  }
  var demoLast = 0;
  function titleLoop(ts) {
    requestAnimationFrame(titleLoop);
    if (G && G.mode === 'play') { demoLast = 0; return; }
    var dt = demoLast ? Math.min((ts - demoLast) / 1000, 0.05) : 0.016;
    demoLast = ts;
    if (!G || (G.mode !== 'demo')) demoState();
    updateDemo(dt);
    render();
  }

  /* ── 起動 ──────────────────────────────────────────────────────────── */
  function boot() {
    cacheDom();
    el.titleBest.textContent = Store.best();
    el.sound.textContent = Sfx.on ? '🔊' : '🔈';
    bindInput(); resize(); watchSize(); show('title');
    requestAnimationFrame(titleLoop);
    if (/[?&]selftest=1/.test(location.search)) SelfTest();
  }

  /* ── 自己テスト ────────────────────────────────────────────────────── */
  function SelfTest() {
    var ok = 0, ng = 0, log = [];
    function t(name, cond) { if (cond) { ok++; log.push('PASS ' + name); } else { ng++; log.push('FAIL ' + name); } }

    t('WORDS loaded (>=60)', WORDS.length >= 60);
    t('all words have 3 distractors', WORDS.every(function (w) { return w.x && w.x.length >= 3; }));
    t('difficulty range 1..4', WORDS.every(function (w) { return w.d >= 1 && w.d <= 4; }));

    t('stage 0m', stageFor(0).name === '暁の浮遊遺跡');
    t('stage 300m', stageFor(300).name === '翡翠の魔法森');
    t('stage 600m', stageFor(600).name === '星霜の大滝');
    t('stage 1000m', stageFor(1000).name === 'オーロラ雪嶺');
    t('stage 1500m', stageFor(1500).name === '天空神殿');
    t('all stages have scenery+palette', STAGES.every(function (s) { return s.scen && s.sky.length === 4 && s.part && s.edge; }));

    // 低いカメラ = 空が大きい / 0x0 起動でも世界が壊れない
    resize();
    t('viewport never degenerates to zero', W >= 240 && H >= 360 && roadHalfBottom > 0);
    t('camera is low (sky >= 40% of screen)', horizonY / H >= 0.40);

    newGame();
    var seen = { 0: 0, 1: 0, 2: 0 }, valid = true;
    for (var i = 0; i < 200; i++) {
      nextQuestion();
      var c = G.q.choices;
      if (c.length !== 3 || new Set(c).size !== 3) valid = false;
      if (c[G.correctLane] !== G.q.word.a) valid = false;
      seen[G.correctLane]++;
    }
    t('choices unique & correct mapped (x200)', valid);
    t('correct lane randomized', seen[0] > 10 && seen[1] > 10 && seen[2] > 10);
    t('timeForLevel decreases', timeForLevel(1) > timeForLevel(6));
    t('timeForLevel bounded', timeForLevel(50) >= 1.5);

    // 道の形状: レーンは常に左<中央<右、道幅内に収まる
    var geomOK = true;
    for (var b = 0; b < 30; b++) {
      G.bend = -1 + (b / 15);
      for (var zi = 0; zi <= 10; zi++) {
        var z = zi / 10;
        var l = laneX(0, z), m = laneX(1, z), r = laneX(2, z);
        if (!(l < m && m < r)) geomOK = false;
        var hw = roadHW(z), cx = W / 2 + bendAt(z);
        if (Math.abs(l - cx) > hw || Math.abs(r - cx) > hw) geomOK = false;
      }
    }
    G.bend = 0;
    t('lanes ordered L<C<R and inside road (any bend)', geomOK);
    t('road recedes toward horizon', roadY(0) > roadY(0.5) && roadY(0.5) > roadY(1) && roadY(1) >= horizonY - 0.01);
    t('road narrows with distance', roadHW(0) > roadHW(0.5) && roadHW(0.5) > roadHW(1));

    // 答えの板は絶対に重ならない・画面外へ出ない（最長の日本語訳で検証）
    var longest = '', all = [];
    WORDS.forEach(function (w) { all.push(w.a); w.x.forEach(function (v) { all.push(v); }); });
    all.forEach(function (s) { if (s.length > longest.length) longest = s; });
    var overlapOK = true, insideOK = true;
    [[320, 700], [375, 812], [390, 844], [430, 932], [768, 1024]].forEach(function (vp) {
      var sw = W, sh = H;
      W = vp[0]; H = vp[1]; roadHalfBottom = W * 0.60; horizonY = H * 0.46;
      var boxes = [0, 1, 2].map(function (i) { return answerLayout(i, longest); });
      for (var i = 0; i < 3; i++) {
        var b = boxes[i];
        if (b.x - b.pw / 2 < 0 || b.x + b.pw / 2 > W) insideOK = false;
        if (i > 0) {
          var p = boxes[i - 1];
          if (p.x + p.pw / 2 > b.x - b.pw / 2) overlapOK = false;   // 隣と重なっていないか
        }
      }
      W = sw; H = sh; roadHalfBottom = W * 0.60; horizonY = H * 0.46;
    });
    t('answer plates never overlap (longest word, 5 viewports)', overlapOK);
    t('answer plates stay on screen (5 viewports)', insideOK);

    newGame();
    var d0 = G.dist; G.chosen = G.correctLane; resolve();
    t('correct increases distance', G.dist > d0);
    t('correct increases combo', G.combo === 1);
    newGame();
    var lv = G.lives; G.chosen = (G.correctLane + 1) % 3; resolve();
    t('wrong loses a life', G.lives === lv - 1);
    t('wrong resets combo', G.combo === 0);
    t('wrong records missed word', G.missed.length === 1);

    // 神回避スロー
    newGame(); G.tLeft = G.tQ * 0.05; G.chosen = G.correctLane; resolve();
    t('near-miss triggers slow motion', G.timeScale < 1 && G.slowT > 0);

    // ボス
    newGame(); startBoss(300);
    t('boss starts with 0 hits', G.boss && G.boss.hits === 0);
    // 魔獣が選択肢を覆わない（覆うと操作不能になる）
    var bossClear = true;
    [[320, 700], [375, 812], [430, 932], [768, 1024]].forEach(function (vp) {
      var sw = W, sh = H;
      W = vp[0]; H = vp[1]; roadHalfBottom = W * 0.60; horizonY = H * 0.46;
      [1, 0].forEach(function (intro) {
        G.boss.intro = intro;
        var gm = bossGeom();
        if (gm.bottom > bossFloor() + 0.5) bossClear = false;   // 選択肢を覆わない
        if (gm.top < bossCeil() - 0.5) bossClear = false;       // 問題の文字を覆わない
        if (gm.size < 24) bossClear = false;                    // 小さすぎて見えない
      });
      W = sw; H = sh; roadHalfBottom = W * 0.60; horizonY = H * 0.46;
    });
    t('boss never covers the answer plates', bossClear);
    for (var h = 0; h < BOSS_HITS; h++) { G.chosen = G.correctLane; resolve(); if (G.boss) nextQuestion(); }
    t('boss defeated after ' + BOSS_HITS + ' correct', G.boss === null && G.bossCleared.indexOf(300) >= 0);

    // ヒント
    newGame(); var hs = G.hints.scroll; useScroll();
    t('scroll hint blocks only a wrong lane', G.hints.scroll === hs - 1 && !G.blocked[G.correctLane]);

    // パーティクル上限
    newGame();
    for (var s = 0; s < 900; s++) spawn('spark', 10, 10, {});
    t('particle pool capped (perf guard)', P.length <= MAX_P);

    // ゲームオーバー
    newGame();
    for (var g2 = 0; g2 < 6 && G.mode === 'play'; g2++) { G.chosen = (G.correctLane + 1) % 3; resolve(); if (G.mode === 'play') afterResolve(); }
    t('game over after lives drained', G.mode === 'over');
    t('result screen visible', !el.over.classList.contains('hidden'));

    P.length = 0;
    if (G) G.mode = 'title';
    show('title');

    var sum = 'SELFTEST: ' + ok + ' passed, ' + ng + ' failed';
    (ng ? console.error : console.log)(sum + '\n' + log.join('\n'));
    var b2 = document.createElement('div');
    b2.id = 'selftest-badge';
    b2.style.cssText = 'position:fixed;z-index:9999;left:8px;bottom:8px;padding:6px 10px;border-radius:8px;font:600 12px system-ui;color:#fff;background:' + (ng ? '#b03030' : '#207a3a');
    b2.textContent = sum;
    document.body.appendChild(b2);
    return { ok: ok, ng: ng };
  }

  window.__WQR = {
    stageFor: stageFor, timeForLevel: timeForLevel, STAGES: STAGES,
    get state() { return G; },
    answer: function (l) { if (G) { G.chosen = l; G.charLane = l; resolve(); } },
    advance: function () { if (G) afterResolve(); },
    // 検証用: 一過性の演出（フラッシュ/粒子/揺れ）を消して素の画面を見る
    calm: function () {
      if (G) { G.flashT = 0; G.godRay = 0; G.rainbow = 0; G.stageFlash = 0; G.bannerT = 0; G.shake = 0; G.cineT = 0; }
      P.length = 0;
      if (el.cine) el.cine.className = 'cine';
    },
    geom: function () { return { horizonY: horizonY, H: H, W: W, laneX: laneX, roadY: roadY, roadHW: roadHW }; },
    // 検証用: 1フレームの描画コストを測る（スマホ性能の目安）
    bench: function (n) {
      n = n || 120;
      if (!G) demoState();
      for (var w = 0; w < 10; w++) render();          // ウォームアップ
      var t0 = performance.now();
      for (var i = 0; i < n; i++) { updateDemo(0.016); render(); }
      var ms = (performance.now() - t0) / n;
      return { msPerFrame: +ms.toFixed(2), estFps: Math.round(1000 / ms), particles: P.length };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
