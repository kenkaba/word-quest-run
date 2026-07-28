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

  // 語彙は vocab.js（データ）+ vocab-engine.js（選択・重複防止・誤答生成）が担う。
  // 旧 words.js しか無い環境でも動くよう、無ければ旧データから最小変換する。
  var VOCAB = null;
  (function initVocab() {
    var raw = window.VOCAB_RAW;
    if (!raw && Array.isArray(window.WORDS)) {
      raw = window.WORDS.map(function (o) { return [o.w, o.a, 'n', o.d || 2, 'legacy', o.p || '', o.e || '', '']; });
    }
    if (raw && window.VocabEngine) VOCAB = window.VocabEngine.create(raw);
  })();
  var WORDS = VOCAB ? VOCAB.words : [];

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
      this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r); this.closePath(); return this;
    };
  }
  /* 角丸矩形は必ずこれを使う。
     native の roundRect は現在のパスへ「追加」するだけで beginPath しないため、
     直前に描いた図形と1つのパスとして塗られてしまう（光の柱と答えの板が融合する不具合の原因）。
     polyfill と native で挙動が変わるクロスブラウザ差も、ここで吸収する。 */
  function rrect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); return c; }

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

  /* ── 色ユーティリティ（空気遠近と陰影の土台） ───────────────────────── */
  function hex2rgb(h) {
    if (h[0] !== '#') return [255, 255, 255];
    h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbStr(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a == null ? 1 : a) + ')'; }
  function mixRgb(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function shade(hexOrRgb, amt) {   // amt>0 明るく / amt<0 暗く
    var c = Array.isArray(hexOrRgb) ? hexOrRgb.slice() : hex2rgb(hexOrRgb);
    var t = amt > 0 ? [255, 255, 255] : [0, 0, 0];
    return mixRgb(c, t, Math.abs(amt));
  }
  /* 空気遠近: 奥ほど霞の色へ寄り、彩度とコントラストが落ちる。
     Art Bible 第5節。全描画要素に例外なく適用する（漏れると図形の貼り付けに見える）。*/
  var _haze = [255, 255, 255];
  function setHaze(st) { _haze = hex2rgb(st.haze); }
  function hazeAmt(z) { return 0.85 * Math.pow(clamp(z, 0, 1), 1.35); }
  function depth(hexOrRgb, z, alpha) {
    var c = Array.isArray(hexOrRgb) ? hexOrRgb : hex2rgb(hexOrRgb);
    return rgbStr(mixRgb(c, _haze, hazeAmt(z)), alpha);
  }

  /* ── 世界（ステージ）: 背景が主役 / Art Bible 第6節のパレット ──────── */
  var STAGES = [
    { name: '暁の浮遊遺跡', min: 0, sunX: 0.55, sunY: 0.30,
      sky: ['#2a1f4d', '#5b3f7d', '#c4738f', '#f2a97e'], haze: '#e0a184',
      sun: '#fff3c4', sunGlow: '#ffcf8a',
      ground: '#3c2f5c', road: '#6c5a92', edge: '#ffd9a0', rune: '#ffe9b8',
      far: '#5b4478', mid: '#4a3568', near: '#2e2043', accent: '#7d5fa8',
      scen: 'ruin', part: '#ffd9a0', aurora: null },
    { name: '翡翠の魔法森', min: 300, sunX: -0.5, sunY: 0.22,
      sky: ['#0e3d3a', '#1d6a58', '#4fae8c', '#8fe3c4'], haze: '#9fdcc2',
      sun: '#f6ffd9', sunGlow: '#c9ffb0',
      ground: '#163d33', road: '#2f6b52', edge: '#a8ffcf', rune: '#dcffe8',
      far: '#2d7a63', mid: '#215c4c', near: '#12352e', accent: '#2f7a63',
      scen: 'tree', part: '#b6ffcf', aurora: null },
    { name: '星霜の大滝', min: 600, sunX: 0.4, sunY: 0.26,
      sky: ['#141c3f', '#2b4a86', '#6d9ad8', '#a9d4ff'], haze: '#b9d8f5',
      sun: '#ffffff', sunGlow: '#bcd8ff',
      ground: '#1b2a4a', road: '#3d5a8c', edge: '#bfe4ff', rune: '#e6f5ff',
      far: '#4a6ba8', mid: '#37538a', near: '#1e2c50', accent: '#3d5a8c',
      scen: 'fall', part: '#dff0ff', aurora: null },
    { name: 'オーロラ雪嶺', min: 1000, sunX: -0.6, sunY: 0.18,
      sky: ['#050a18', '#0e1b3a', '#1a3358', '#37588a'], haze: '#3f5f8c',
      sun: '#eaf6ff', sunGlow: '#9fd8ff',
      ground: '#2b3d55', road: '#4a648a', edge: '#eaf6ff', rune: '#ffffff',
      far: '#33506f', mid: '#2a4260', near: '#16233a', accent: '#4a648a',
      scen: 'crystal', part: '#ffffff', aurora: ['#7dffc8', '#7db9ff', '#c98aff'] },
    { name: '天空神殿', min: 1500, sunX: 0.5, sunY: 0.24,
      sky: ['#2b1740', '#6b3b6e', '#c98a7a', '#ffcf95'], haze: '#e8b98f',
      sun: '#fffbe6', sunGlow: '#ffd98a',
      ground: '#4a3550', road: '#8a6a9c', edge: '#ffe9a8', rune: '#fff6d0',
      far: '#7a5a8f', mid: '#66497e', near: '#3d2b50', accent: '#8a6a9c',
      scen: 'temple', part: '#ffe9b0', aurora: null }
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
  // タブ/アプリが非表示のときタイマーを止める。テストから差し替えられるよう関数にする。
  var isHidden = function () { return !!document.hidden; };

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
      hintScroll: $('#hintScroll'), hintSand: $('#hintSand'), hintFreeze: $('#hintFreeze'), hintEye: $('#hintEye'),
      hintScrollN: $('#hintScrollN'), hintSandN: $('#hintSandN'), hintFreezeN: $('#hintFreezeN'), hintEyeN: $('#hintEyeN'),
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
      var hh = horizonY + 2 + OVERSCAN;
      c.width = Math.round(W * DPR); c.height = Math.round(hh * DPR + 4);
      var g = c.getContext('2d');
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      // 4段グラデーション: 天頂 → 上空 → 地平上 → 地平（Art Bible 第8節）
      var grd = g.createLinearGradient(0, 0, 0, hh);
      grd.addColorStop(0, st.sky[0]); grd.addColorStop(0.40, st.sky[1]);
      grd.addColorStop(0.74, st.sky[2]); grd.addColorStop(1, st.sky[3]);
      g.fillStyle = grd; g.fillRect(0, 0, W, hh);

      // 星（夜空側のステージのみ）
      var zen = hex2rgb(st.sky[0]);
      if (zen[0] + zen[1] + zen[2] < 220) {
        for (var i = 0; i < 110; i++) {
          var sx = (i * 97.13) % W, sy = (i * 53.7) % (hh * 0.55);
          var tw = 0.12 + ((i * 37) % 70) / 100;
          g.globalAlpha = tw * (1 - sy / (hh * 0.75));
          g.fillStyle = '#fff';
          var r = ((i * 17) % 10) < 2 ? 1.9 : 1.2;
          g.fillRect(sx, sy, r, r);
        }
        g.globalAlpha = 1;
      }

      // 層状の雲（丸い塊・Art Bible 形言語）
      var cl = hex2rgb(st.sky[2]);
      for (var b = 0; b < 3; b++) {
        var cy = hh * (0.42 + b * 0.14);
        g.globalAlpha = 0.16 - b * 0.03;
        g.fillStyle = rgbStr(shade(cl, 0.35));
        for (var q = 0; q < 5; q++) {
          var cx2 = ((q * 271 + b * 133) % (W + 200)) - 100;
          var rw = 70 + ((q * 53 + b * 29) % 90);
          g.beginPath(); g.ellipse(cx2, cy, rw, rw * 0.20, 0, 0, 7); g.fill();
        }
      }
      g.globalAlpha = 1;

      // 地平の霞の帯（空気遠近の受け皿）
      var hz = g.createLinearGradient(0, hh - hh * 0.26, 0, hh);
      hz.addColorStop(0, rgbStr(hex2rgb(st.haze), 0));
      hz.addColorStop(1, rgbStr(hex2rgb(st.haze), 0.75));
      g.fillStyle = hz; g.fillRect(0, hh - hh * 0.26, W, hh * 0.26);

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
      lagX: 0, lagY: 0, camX: 0, camDip: 0, lastPlant: -1, squash: 1,
      scroll: 0, worldZ: 0, bend: 0, bendT: 0,
      shake: 0, timeScale: 1, slowT: 0,
      resolveT: 0, kind: '', move: '',
      missed: [], recent: [], correct: 0, answered: 0,
      hints: { scroll: 3, sand: 3, freeze: 2, eye: 3 }, sandT: 0, freezeT: 0,
      flashT: 0, flashColor: '', rainbow: 0, cineT: 0, cineText: '',
      boss: null, bossCleared: [], chest: null, chestIn: 7,
      banner: '', bannerT: 0, godRay: 0, stageIdx: 0, stageFlash: 0,
      trail: [], newBest: false, coachT: Store.seen() ? 0 : 4.5
    };
    P.length = 0;
    if (VOCAB) VOCAB.startSession();   // 重複防止とセッション統計をリセット
    G.charX = W / 2;
    G.lagX = G.charX; G.camX = G.charX;   // 起動直後にカメラが飛ばないよう一致させる
    updateHints(); updateHud();
    nextQuestion();
  }

  /* ── 制限時間モデル ──────────────────────────────────────────────
     単語の難易度を基準に、プレイヤーレベル・コンボ・正答率で調整する。
     初心者が即死し続けず、上級者には緊張感が出るようにする。 */
  var BASE_TIME = [0, 6.6, 5.6, 4.8, 4.2, 3.8, 3.4];   // Starter..Master
  function timeForWord(wordLvl, playerLevel, accuracy, combo) {
    var base = BASE_TIME[clamp(wordLvl || 2, 1, 6)];
    base -= Math.min(1.2, Math.max(0, playerLevel - 1) * 0.09);   // 上達で短く
    base -= Math.min(0.9, combo * 0.045);                          // 加速感
    if (accuracy < 0.5) base += 1.2;                               // 苦戦者に猶予
    else if (accuracy < 0.7) base += 0.5;
    return clamp(base, 2.6, 8);
  }
  // 旧API互換（テストとボス時の短縮で使用）
  function timeForLevel(lv) { return clamp(6.6 - (lv - 1) * 0.30, 2.6, 6.6); }
  function updateLevel() {
    var byDist = 1 + Math.floor(G.dist / 220);
    var acc = G.answered ? G.correct / G.answered : 1;
    G.level = clamp(byDist + (acc > 0.85 ? 1 : acc < 0.5 ? -1 : 0), 1, 14);
  }
  function maxDifficulty() {
    // Starter..Master の6段階へ段階的に開放する
    return G.level <= 2 ? 1 : G.level <= 4 ? 2 : G.level <= 6 ? 3 : G.level <= 9 ? 4 : G.level <= 12 ? 5 : 6;
  }

  // 出題選択・重複防止・誤答生成は vocab-engine.js が担う（pickWord は廃止）

  function nextQuestion() {
    G.phase = 'ask'; G.chosen = null; G.blocked = {};
    updateLevel();

    var q = VOCAB ? VOCAB.nextQuestion(maxDifficulty()) : null;
    if (!q) return gameOver();
    G.q = { word: q.word, choices: q.choices };
    G.correctLane = q.correctLane;
    G.qCount++;

    var acc = G.answered ? G.correct / G.answered : 1;
    G.tQ = timeForWord(q.word.lvl, G.level, acc, G.combo);
    if (G.boss) G.tQ *= 0.82;                      // ボス戦は緊張感を上げる
    G.tLeft = G.tQ;
    G.askedAt = Date.now();
    G.warn25 = false; G.warn10 = false;

    el.word.textContent = q.word.w;
    el.word.className = 'qword show';
    if (el.live) el.live.textContent = q.word.w + '。左:' + q.choices[0] + '、中央:' + q.choices[1] + '、右:' + q.choices[2];
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
    var timedOut = (G.chosen == null);
    var st = stageFor(G.dist);
    // 学習統計と分析指標へ記録
    if (VOCAB && G.q) VOCAB.record(G.q.word, ok, Date.now() - (G.askedAt || Date.now()), timedOut);
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
      // 時間切れは専用の失敗演出（魔力が尽きて道が閉じる）
      G.move = timedOut ? 'timeout' : FAILMOVES[G.qCount % FAILMOVES.length];
      G.combo = 0; G.speed = 1; G.shake = 0.8; G.lives--;
      Sfx.bad();
      addMissed(G.q.word);
      G.banner = (timedOut ? '魔力が尽きた…' : FAIL_LABEL[G.move]) + '  正解: ' + G.q.word.ja;
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
  // 時の砂: 残り時間を40%回復（上限は満タン）
  function useSand() {
    if (!G || G.phase !== 'ask' || G.hints.sand <= 0) return;
    G.tLeft = Math.min(G.tQ, G.tLeft + G.tQ * 0.40);
    G.warn25 = G.tLeft / G.tQ > 0.25 ? false : G.warn25;
    G.warn10 = G.tLeft / G.tQ > 0.10 ? false : G.warn10;
    G.hints.sand--; Sfx.chime(); updateHints();
    var gm = gaugeGeom();
    for (var i = 0; i < 14; i++) {
      spawn('magic', W / 2 + rf(-gm.half, gm.half), gm.y,
        { vx: rf(-30, 30), vy: rf(-70, -20), g: -20, life: rf(0.4, 0.8), r: rf(1.6, 3.4), c: '#FFD76A' });
    }
  }
  // 時間停止: 1.6秒だけ完全停止
  function useFreeze() {
    if (!G || G.phase !== 'ask' || G.hints.freeze <= 0) return;
    G.freezeT = 1.6; G.hints.freeze--; Sfx.tone(520, 0.4, 'sine', 0.12, 900); updateHints();
    var gm2 = gaugeGeom();
    for (var j = 0; j < 12; j++) {
      spawn('magic', W / 2 + rf(-gm2.half, gm2.half), gm2.y,
        { vx: rf(-18, 18), vy: rf(-26, -4), g: -8, life: rf(0.5, 1.0), r: rf(1.6, 3.2), c: '#8AD8FF' });
    }
  }
  function useEye() {
    if (!G || G.phase !== 'ask' || G.hints.eye <= 0) return;
    G.eyeT = 0.8; G.hints.eye--; Sfx.chime(); updateHints();
  }
  function updateHints() {
    if (!el.hintScrollN) return;
    el.hintScrollN.textContent = G.hints.scroll;
    el.hintSandN.textContent = G.hints.sand;
    el.hintFreezeN.textContent = G.hints.freeze;
    el.hintEyeN.textContent = G.hints.eye;
    el.hintScroll.classList.toggle('off', G.hints.scroll <= 0);
    el.hintSand.classList.toggle('off', G.hints.sand <= 0);
    el.hintFreeze.classList.toggle('off', G.hints.freeze <= 0);
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
  // 速いほど遠近を強めて加速感を出す（FOV変化の代替 / Benchmark 第2項）
  function updateFov(dt) {
    var target = 6.2 + clamp((G.speed - 1) * 1.1, 0, 1.3);
    DEPTH = lerp(DEPTH, target, clamp(dt * 2.5, 0, 1));
  }
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

    updateFov(dt);

    // 主人公の横移動
    var tx = laneX(G.charLane, 0.05);
    G.charX = lerp(G.charX, tx, clamp(d * 11, 0, 1));
    // フォロースルー用の遅延値（本体より遅く追う）と、カメラの追従遅延
    G.lagX = lerp(G.lagX, G.charX, clamp(d * 5.5, 0, 1));
    G.lagY = lerp(G.lagY, G.bob, clamp(d * 4.5, 0, 1));
    G.camX = lerp(G.camX, G.charX, clamp(d * 3.2, 0, 1));

    // 接地の瞬間: 土煙とカメラの沈み込み（走行の証拠 / Benchmark 第11項）
    var plantPhase = Math.floor(G.run / Math.PI);
    if (plantPhase !== G.lastPlant) {
      G.lastPlant = plantPhase;
      G.camDip = 3.2;
      var fy = charY();
      for (var pi = 0; pi < 3; pi++) {
        spawn('dust', G.charX + rf(-9, 9), fy + 30, {
          vx: rf(-46, 46), vy: rf(-34, -8), g: 150, life: rf(0.28, 0.5),
          r: rf(2.4, 5), c: 'rgba(255,255,255,0.42)'
        });
      }
    }
    G.camDip = lerp(G.camDip, 0, clamp(dt * 9, 0, 1));

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

    // 問題タイマー（背景タブ・アプリ切替中は停止し、残り時間を保持）
    if (G.phase === 'ask') {
      if (!isHidden() && !(G.freezeT > 0)) {
        G.tLeft -= d * sand;
        var frac0 = G.tLeft / G.tQ;
        if (!G.warn25 && frac0 <= 0.25) {          // 残り25%: 脈動・音・軽い振動
          G.warn25 = true; Sfx.tone(660, 0.10, 'triangle', 0.10);
          if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) {} }
        }
        if (!G.warn10 && frac0 <= 0.10) {          // 残り10%: 強い警告
          G.warn10 = true; Sfx.tone(880, 0.16, 'square', 0.13, 520);
          if (navigator.vibrate) { try { navigator.vibrate([26, 40, 26]); } catch (e) {} }
        }
      }
      if (G.freezeT > 0) G.freezeT -= dt;
      if (G.tLeft <= 0) { G.tLeft = 0; G.chosen = null; resolve(); }
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

  // 足元を画面下へ沈めない（character-motion-camera-director の規則: 68〜75%）
  function charY() { return H * 0.72 + G.bob + (G.camDip || 0); }

  /* ── 描画 ──────────────────────────────────────────────────────────── */
  function render() {
    var st = stageFor(G.dist);
    setHaze(st);                                  // 空気遠近の基準色をこのフレームへ適用
    ctx.save();
    // カメラは剛体追従しない。横移動を遅れて追い、世界を逆方向へわずかに流す。
    var sx = -(G.charX - G.camX) * 0.22;
    var sy = G.bob * 0.5 + (G.camDip || 0) * 0.6;
    if (G.shake > 0) { sx += rf(-1, 1) * 16 * G.shake; sy += rf(-1, 1) * 16 * G.shake; }
    // 端に未描画の隙間が出ないよう、移動量はオーバースキャン内に必ず収める
    var lim = OVERSCAN - 4;
    sx = clamp(sx, -lim, lim); sy = clamp(sy, -lim, lim);
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
    drawTimeGauge(st);
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
    ctx.drawImage(s, -OVERSCAN, -OVERSCAN, W + OVERSCAN * 2, horizonY + 2 + OVERSCAN * 2);
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
    var cx = W * (0.5 + st.sunX * 0.34) + G.bend * -40, cy = horizonY * st.sunY;
    Sprites.drawGlow(cx, cy, W * 0.50, st.sunGlow, 0.45);   // ブルーム
    Sprites.drawGlow(cx, cy, W * 0.20, st.sun, 0.55);
    ctx.fillStyle = st.sun;
    ctx.beginPath(); ctx.arc(cx, cy, W * 0.068, 0, 7); ctx.fill();
  }

  // 最遠景の山（空気遠近が最も強い層 = ほぼ霞に溶ける）
  function drawFarLayer(st) {
    var off = (G.worldZ * 0.45) % 340;
    var lit = st.sunX;
    for (var i = -1; i < W / 340 + 2; i++) {
      var bx = i * 340 - off + G.bend * -50;
      var peaks = [[0, 0], [80, -132], [150, -54], [230, -168], [300, -70], [340, 0]];
      // 陰の面
      ctx.fillStyle = depth(shade(st.far, -0.18), 0.92);
      ctx.beginPath(); ctx.moveTo(bx, horizonY);
      for (var p = 1; p < peaks.length; p++) ctx.lineTo(bx + peaks[p][0], horizonY + peaks[p][1]);
      ctx.closePath(); ctx.fill();
      // 光の当たる面（光源側の斜面だけ明るく）
      ctx.fillStyle = depth(shade(st.far, 0.16), 0.90);
      ctx.beginPath();
      ctx.moveTo(bx + 230, horizonY - 168);
      ctx.lineTo(bx + 230 + (lit > 0 ? 70 : -80), horizonY - (lit > 0 ? 70 : 54));
      ctx.lineTo(bx + 230, horizonY);
      ctx.closePath(); ctx.fill();
    }
    // 遠景の浮遊島（上面は平ら・下面は結晶的に尖る / Art Bible 第7節）
    var fo = (G.worldZ * 0.85) % 430;
    for (var j = -1; j < W / 430 + 2; j++) {
      var ix = j * 430 - fo + 70 + G.bend * -80;
      var iy = horizonY - 156 - ((j * 37) % 64);
      var z = 0.78;
      ctx.fillStyle = depth(shade(st.mid, 0.10), z);
      ctx.beginPath(); ctx.ellipse(ix, iy, 68, 15, 0, 0, 7); ctx.fill();
      ctx.fillStyle = depth(shade(st.near, -0.10), z);
      ctx.beginPath(); ctx.moveTo(ix - 54, iy + 5); ctx.lineTo(ix - 8, iy + 70); ctx.lineTo(ix + 54, iy + 5); ctx.closePath(); ctx.fill();
      // 縁の発光
      ctx.strokeStyle = depth(st.edge, z * 0.7, 0.55); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(ix, iy, 68, 15, 0, Math.PI, 0); ctx.stroke();
      // 遺跡の柱（鋭い結晶側・上部が欠けている）
      ctx.fillStyle = depth(st.accent, z);
      ctx.fillRect(ix - 28, iy - 34, 6, 34); ctx.fillRect(ix + 20, iy - 27, 6, 27);
      ctx.fillStyle = depth(shade(st.accent, 0.2), z);
      ctx.fillRect(ix - 33, iy - 38, 62, 5);
    }
  }

  // 遠景の大建築・大滝
  function drawMidLayer(st) {
    var off = (G.worldZ * 1.5) % 280;
    for (var i = -1; i < W / 280 + 2; i++) {
      var bx = i * 280 - off + G.bend * -110;
      ctx.fillStyle = depth(shade(st.mid, -0.10), 0.66);
      ctx.beginPath();
      ctx.moveTo(bx, horizonY + 2);
      ctx.lineTo(bx + 60, horizonY - 70);
      ctx.lineTo(bx + 128, horizonY - 24);
      ctx.lineTo(bx + 200, horizonY - 86);
      ctx.lineTo(bx + 280, horizonY + 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = depth(shade(st.mid, 0.14), 0.66);
      ctx.beginPath();
      ctx.moveTo(bx + 200, horizonY - 86);
      ctx.lineTo(bx + 200 + (st.sunX > 0 ? 80 : -72), horizonY + 2);
      ctx.lineTo(bx + 200, horizonY + 2);
      ctx.closePath(); ctx.fill();
    }
    if (st.scen === 'fall') {
      var fx = W * 0.5 + G.bend * -140, z = 0.6;
      ctx.fillStyle = depth('#dff0ff', z, 0.42);
      ctx.fillRect(fx - 78, horizonY - 132, 156, 134);
      ctx.globalAlpha = 0.22; ctx.fillStyle = '#fff';
      for (var s = 0; s < 9; s++) {
        var sxx = fx - 70 + s * 17;
        ctx.fillRect(sxx, horizonY - 132 + ((G.worldZ * 44 + s * 31) % 132) - 132, 3.5, 132);
      }
      ctx.globalAlpha = 1;
      Sprites.drawGlow(fx, horizonY, 118, '#dff0ff', 0.20);
    }
  }

  function drawGround(st) {
    // 地面も奥ほど霞へ溶ける（縦グラデで空気遠近を表現）
    var g = ctx.createLinearGradient(0, horizonY, 0, H);
    g.addColorStop(0, depth(st.ground, 0.85));
    g.addColorStop(0.35, depth(st.ground, 0.34));
    g.addColorStop(1, depth(shade(st.ground, -0.12), 0));
    ctx.fillStyle = g;
    ctx.fillRect(-OVERSCAN, horizonY, W + OVERSCAN * 2, H - horizonY + OVERSCAN);
    // 質感: 流れる横縞（ベタ塗り回避 / Benchmark 第9項）
    for (var i = 0; i < 22; i++) {
      var z = ((i + G.scroll) / 22);
      var y0 = roadY(z), y1 = roadY(Math.min(z + 0.028, 1));
      if (i % 2) continue;
      ctx.fillStyle = depth(shade(st.near, -0.06), z, 0.34 * (1 - z * 0.7));
      ctx.fillRect(-OVERSCAN, y1, W + OVERSCAN * 2, Math.max(1, y0 - y1));
    }
  }

  function roadPath(segs, inset) {
    var i, z, y, hw, bx;
    ctx.beginPath();
    for (i = 0; i <= segs; i++) { z = i / segs; y = roadY(z); hw = roadHW(z) - (inset || 0) * scaleAt(z); bx = W / 2 + bendAt(z); (i === 0) ? ctx.moveTo(bx - hw, y) : ctx.lineTo(bx - hw, y); }
    for (i = segs; i >= 0; i--) { z = i / segs; y = roadY(z); hw = roadHW(z) - (inset || 0) * scaleAt(z); bx = W / 2 + bendAt(z); ctx.lineTo(bx + hw, y); }
    ctx.closePath();
  }

  function drawRoad(st) {
    var segs = 30, i, z;
    // 路面（奥は霞、手前は素の色）
    roadPath(segs, 0);
    var grd = ctx.createLinearGradient(0, horizonY, 0, H);
    grd.addColorStop(0, depth(st.road, 0.85));
    grd.addColorStop(0.3, depth(st.road, 0.34));
    grd.addColorStop(1, depth(shade(st.road, 0.06), 0));
    ctx.fillStyle = grd; ctx.fill();

    // 路面の質感: 帯状のムラ
    ctx.save(); ctx.clip();
    for (i = 0; i < 26; i++) {
      z = ((i + G.scroll * 1.4) / 26) % 1;
      var yy = roadY(z), hh = Math.max(1, roadY(z) - roadY(Math.min(z + 0.02, 1)));
      ctx.fillStyle = depth(shade(st.road, (i % 3 === 0) ? 0.07 : -0.05), z, 0.30 * (1 - z * 0.6));
      ctx.fillRect(0, yy - hh, W, hh);
    }
    // 光源側がわずかに明るい路面
    var sg = ctx.createLinearGradient(W / 2 - W * 0.5, 0, W / 2 + W * 0.5, 0);
    sg.addColorStop(0, rgbStr(hex2rgb(st.sun), st.sunX < 0 ? 0.10 : 0));
    sg.addColorStop(1, rgbStr(hex2rgb(st.sun), st.sunX > 0 ? 0.10 : 0));
    ctx.fillStyle = sg; ctx.fillRect(0, horizonY, W, H - horizonY);
    ctx.restore();

    // 縁の発光（奥は霞で弱く）
    ctx.lineWidth = 2.6;
    for (var side = -1; side <= 1; side += 2) {
      for (i = 0; i < segs; i++) {
        z = i / segs;
        var z2 = (i + 1) / segs;
        ctx.strokeStyle = depth(st.edge, z * 0.85, 0.72 * (1 - z * 0.55));
        ctx.beginPath();
        ctx.moveTo(W / 2 + bendAt(z) + side * roadHW(z), roadY(z));
        ctx.lineTo(W / 2 + bendAt(z2) + side * roadHW(z2), roadY(z2));
        ctx.stroke();
      }
    }
    // レーン境界のルーン（流れる）
    ctx.lineWidth = 2;
    for (var b = -1; b <= 1; b += 2) {
      for (var s = 0; s < 14; s++) {
        var z0 = ((s + G.scroll) / 14) % 1, z1 = z0 + 0.026;
        if (z1 > 0.97) continue;
        ctx.strokeStyle = depth(st.rune, z0 * 0.9, 0.55 * (1 - z0 * 0.6));
        ctx.beginPath();
        ctx.moveTo(W / 2 + bendAt(z0) + b * roadHW(z0) * 0.32, roadY(z0));
        ctx.lineTo(W / 2 + bendAt(z1) + b * roadHW(z1) * 0.32, roadY(z1));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* 道の脇を流れる景色（速度感の主役）。奥から手前へ、必ず奥→手前の順に描く */
  function drawScenery(st) {
    var count = 16, items = [];
    for (var i = 0; i < count; i++) {
      var z = ((i / count) - (G.worldZ * 0.05)) % 1; if (z < 0) z += 1;
      if (z > 0.97) continue;
      items.push({ z: z, i: i });
    }
    items.sort(function (a, b) { return b.z - a.z; });     // 奥から描く
    for (var k = 0; k < items.length; k++) {
      var z2 = items[k].z, idx = items[k].i;
      var s = scaleAt(z2), y = roadY(z2), hw = roadHW(z2);
      for (var side = -1; side <= 1; side += 2) {
        var x = W / 2 + bendAt(z2) + side * hw * (1.22 + ((idx * 13) % 5) * 0.09);
        var h = (110 + ((idx * 29) % 70)) * s * 3.2;
        drawProp(st, x, y, h, s, idx + side, z2);
      }
    }
  }

  /* 脇の props。光源方向に従って明暗を分け、逆光側にリムライトを置き、
     接地影を落とし、深度で霞へ溶かす（Art Bible 第4・5節）。 */
  function drawProp(st, x, y, h, s, seed, z) {
    var w = h * 0.26;
    var lit = st.sunX >= 0 ? 1 : -1;          // 明るい面の向き
    var a = clamp(s * 3.4, 0, 1);
    ctx.globalAlpha = a;

    // 接地影
    ctx.fillStyle = rgbStr([0, 0, 0], 0.26 * a * (1 - z * 0.7));
    ctx.beginPath(); ctx.ellipse(x, y, w * 0.72, w * 0.20, 0, 0, 7); ctx.fill();

    function body(darkC, litC, drawShape) {
      ctx.fillStyle = depth(darkC, z); drawShape(0);
      ctx.save();
      drawShape(1); ctx.clip();
      ctx.fillStyle = depth(litC, z);
      ctx.fillRect(lit > 0 ? x : x - w, y - h, w, h);   // 光源側の半分だけ明るく
      ctx.restore();
    }

    if (st.scen === 'tree') {
      ctx.fillStyle = depth(shade(st.near, -0.10), z);
      ctx.fillRect(x - w * 0.11, y - h * 0.55, w * 0.22, h * 0.55);
      body(shade(st.accent, -0.22), shade(st.accent, 0.22), function () {
        ctx.beginPath(); ctx.ellipse(x, y - h * 0.66, w * 0.92, h * 0.34, 0, 0, 7);
        if (arguments[0] !== 1) ctx.fill();
      });
      // 上の樹冠（丸い塊を重ねる）
      ctx.fillStyle = depth(shade(st.accent, 0.30), z);
      ctx.beginPath(); ctx.ellipse(x + lit * w * 0.22, y - h * 0.80, w * 0.52, h * 0.20, 0, 0, 7); ctx.fill();
      // リムライト（逆光側の縁）
      ctx.strokeStyle = depth(st.edge, z, 0.55 * a); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(x, y - h * 0.66, w * 0.92, h * 0.34, 0, Math.PI * (lit > 0 ? 0.35 : 0.15), Math.PI * (lit > 0 ? 1.15 : 0.95)); ctx.stroke();
    } else if (st.scen === 'crystal') {
      ctx.fillStyle = depth(shade(st.accent, -0.18), z);
      ctx.beginPath(); ctx.moveTo(x, y - h * 0.92); ctx.lineTo(x + w * 0.42, y - h * 0.2); ctx.lineTo(x, y); ctx.lineTo(x - w * 0.42, y - h * 0.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = depth(shade(st.edge, -0.05), z);
      ctx.beginPath(); ctx.moveTo(x, y - h * 0.92); ctx.lineTo(x + lit * w * 0.20, y - h * 0.26); ctx.lineTo(x, y - h * 0.04); ctx.closePath(); ctx.fill();
      if (s > 0.12) Sprites.drawGlow(x, y - h * 0.5, h * 0.26, st.edge, 0.22 * a);
    } else if (st.scen === 'temple') {
      ctx.fillStyle = depth(shade(st.near, -0.12), z);
      ctx.fillRect(x - w * 0.32, y - h * 0.85, w * 0.64, h * 0.85);
      ctx.fillStyle = depth(shade(st.near, 0.18), z);
      ctx.fillRect(lit > 0 ? x : x - w * 0.32, y - h * 0.85, w * 0.32, h * 0.85);
      ctx.fillStyle = depth(shade(st.accent, 0.14), z);
      ctx.fillRect(x - w * 0.44, y - h * 0.93, w * 0.88, h * 0.08);
      ctx.strokeStyle = depth(st.edge, z, 0.5 * a); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x - lit * w * 0.32, y - h * 0.85); ctx.lineTo(x - lit * w * 0.32, y); ctx.stroke();
    } else if (st.scen === 'fall') {
      ctx.fillStyle = depth(shade(st.near, -0.12), z);
      ctx.beginPath(); ctx.moveTo(x - w * 0.5, y); ctx.lineTo(x - w * 0.18, y - h * 0.82); ctx.lineTo(x + w * 0.32, y - h * 0.56); ctx.lineTo(x + w * 0.5, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = depth(shade(st.near, 0.16), z);
      ctx.beginPath(); ctx.moveTo(x + w * 0.32, y - h * 0.56); ctx.lineTo(x + w * 0.5, y); ctx.lineTo(x + w * 0.05, y); ctx.closePath(); ctx.fill();
      if (s > 0.12) Sprites.drawGlow(x, y - h * 0.4, h * 0.2, st.edge, 0.14 * a);
    } else { // ruin: 上部が欠けた柱（鋭い結晶側）
      ctx.fillStyle = depth(shade(st.near, -0.14), z);
      ctx.beginPath();
      ctx.moveTo(x - w * 0.30, y); ctx.lineTo(x - w * 0.26, y - h * 0.72);
      ctx.lineTo(x + w * 0.10, y - h * 0.82); ctx.lineTo(x + w * 0.30, y - h * 0.66);
      ctx.lineTo(x + w * 0.30, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = depth(shade(st.near, 0.20), z);
      ctx.fillRect(lit > 0 ? x : x - w * 0.30, y - h * 0.70, w * 0.30, h * 0.70);
      ctx.fillStyle = depth(shade(st.accent, 0.10), z);
      ctx.fillRect(x - w * 0.42, y - h * 0.88, w * 0.84, h * 0.08);
      ctx.strokeStyle = depth(st.edge, z, 0.45 * a); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x - lit * w * 0.28, y - h * 0.74); ctx.lineTo(x - lit * w * 0.30, y); ctx.stroke();
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

  /* ── 時間ゲージ ────────────────────────────────────────────────────
     問題の直下・3本の道の上に置き、視線を端へ動かさない。
     四角いバーではなく「魔力の結晶列」。中央から外へ灯が消えていく。 */
  var GAUGE_Y = 0.295;      // 画面高比（問題文と答えの板の間）
  function gaugeGeom() {
    return { y: H * GAUGE_Y, half: Math.min(W * 0.34, 160) };
  }
  function drawTimeGauge(st) {
    if (!G.q || G.mode !== 'play') return;
    var frac = clamp(G.tLeft / G.tQ, 0, 1);
    var gm = gaugeGeom(), cy = gm.y, half = gm.half;
    var N = 15;                                   // 結晶の数（奇数＝中央が残る）
    var lit = frac;
    var frozen = G.freezeT > 0;

    // 色: 50%で変化、25%で警告、10%で強い警告
    var col = st.edge, glowA = 0.5;
    if (frac <= 0.10) { col = '#FF5A6A'; glowA = 0.95; }
    else if (frac <= 0.25) { col = '#FF9A4A'; glowA = 0.8; }
    else if (frac <= 0.50) { col = '#FFD76A'; glowA = 0.62; }
    if (frozen) col = '#8AD8FF';

    // 脈動（25%以下）
    var pulse = 1;
    if (frac <= 0.25 && !frozen) pulse = 1 + Math.sin(G.run * (frac <= 0.10 ? 7 : 4)) * (frac <= 0.10 ? 0.28 : 0.16);

    // 中央の魔力核
    Sprites.drawGlow(W / 2, cy, 34 * pulse, col, glowA * 0.55);

    for (var i = 0; i < N; i++) {
      var t01 = (i - (N - 1) / 2) / ((N - 1) / 2);        // -1..1（中央=0）
      var x = W / 2 + t01 * half;
      var dist01 = Math.abs(t01);                          // 中央からの距離
      var on = dist01 <= lit;                              // 外側から消える
      var h = (11 - dist01 * 3.4) * (on ? pulse : 1);
      var w = 4.2 - dist01 * 1.0;
      var yy = cy + Math.pow(dist01, 2) * 5;               // ゆるい弧

      if (on) {
        Sprites.drawGlow(x, yy, 13 * pulse, col, glowA * (1 - dist01 * 0.35));
        ctx.fillStyle = col;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
      }
      // 結晶（菱形）
      ctx.beginPath();
      ctx.moveTo(x, yy - h); ctx.lineTo(x + w, yy); ctx.lineTo(x, yy + h); ctx.lineTo(x - w, yy);
      ctx.closePath(); ctx.fill();
    }

    // 消えた瞬間の粒子（魔力が散る）
    if (G.lastLit == null) G.lastLit = lit;
    if (lit < G.lastLit - (1 / N)) {
      var ex = W / 2 + (Math.random() < 0.5 ? -1 : 1) * lit * half;
      for (var p = 0; p < 3; p++) {
        spawn('magic', ex, cy, { vx: rf(-40, 40), vy: rf(-50, -10), g: 60, life: rf(0.3, 0.6), r: rf(1.5, 3), c: col });
      }
      G.lastLit = lit;
    }
    if (lit > G.lastLit) G.lastLit = lit;   // 回復時

    // 時間停止中の表示
    if (frozen) {
      ctx.font = '800 11px -apple-system,"Hiragino Sans",system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.fillStyle = '#8AD8FF';
      ctx.fillText('時間停止', W / 2, cy + 26);
      ctx.textAlign = 'left';
    }
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
      ctx.globalAlpha = alpha * (hint || (G.phase !== 'ask' && isC) ? 0.46 : 0.26);
      var beam = ctx.createLinearGradient(0, py + ph * 0.5, 0, landY);
      beam.addColorStop(0, glow);
      beam.addColorStop(0.65, Sprites.fade(glow, 0.45));
      beam.addColorStop(1, Sprites.fade(glow, 0.12));
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
      rrect(ctx, x - pw / 2, py - ph / 2, pw, ph, 16); ctx.fill();
      ctx.globalAlpha = alpha * 0.9; ctx.strokeStyle = glow; ctx.lineWidth = 1.6;
      rrect(ctx, x - pw / 2, py - ph / 2, pw, ph, 16); ctx.stroke();
      ctx.globalAlpha = alpha * 0.16; ctx.fillStyle = '#fff';
      rrect(ctx, x - pw / 2 + 4, py - ph / 2 + 3, pw - 8, ph * 0.34, 12); ctx.fill();

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
    ctx.fillStyle = '#8a5a2a'; rrect(ctx, x - w / 2, y - h, w, h, 6); ctx.fill();
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
    /* 魔獣 = 丸い塊 + 鋭い結晶の角（Art Bible 第10節）。
       色はステージの影色、発光する目だけが差し色。血や破壊は描かない。 */
    var breathe = 1 + Math.sin(b.sway * 1.4) * 0.03;
    var bodyC = hex2rgb(st.near), horn = hex2rgb(st.accent);

    // まとわりつく瘴気
    Sprites.drawGlow(x, y - size * 0.1, size * 1.7, st.accent, 0.22);
    for (var w = 0; w < 5; w++) {
      var wa = b.sway * 0.7 + w * 1.25;
      Sprites.drawGlow(x + Math.cos(wa) * size * 0.75, y - size * 0.1 + Math.sin(wa * 1.3) * size * 0.4,
        size * 0.30, st.accent, 0.13);
    }

    // 角（結晶: 太い根元から鋭く尖る。左右非対称で生物感）
    function hornAt(hx, hy, tx, ty, wdt) {
      ctx.beginPath();
      ctx.moveTo(hx - wdt, hy); ctx.lineTo(tx, ty); ctx.lineTo(hx + wdt, hy);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = rgbStr(shade(horn, -0.10));
    hornAt(x - size * 0.42, y - size * 0.42, x - size * 0.80, y - size * 1.02, size * 0.10);
    hornAt(x + size * 0.42, y - size * 0.42, x + size * 0.86, y - size * 0.94, size * 0.10);
    ctx.fillStyle = rgbStr(shade(horn, 0.18));
    hornAt(x - size * 0.20, y - size * 0.52, x - size * 0.34, y - size * 0.90, size * 0.055);
    hornAt(x + size * 0.22, y - size * 0.52, x + size * 0.38, y - size * 0.86, size * 0.055);

    // 体（丸い塊。肩を張らせて威圧感）
    ctx.save();
    ctx.translate(x, y - size * 0.15); ctx.scale(1, breathe);
    var bg = ctx.createRadialGradient(0, -size * 0.25, size * 0.1, 0, 0, size * 0.75);
    bg.addColorStop(0, rgbStr(shade(bodyC, 0.12)));
    bg.addColorStop(1, rgbStr(shade(bodyC, -0.55)));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(-size * 0.66, size * 0.30);
    ctx.quadraticCurveTo(-size * 0.74, -size * 0.30, -size * 0.34, -size * 0.52);
    ctx.quadraticCurveTo(0, -size * 0.66, size * 0.34, -size * 0.52);
    ctx.quadraticCurveTo(size * 0.74, -size * 0.30, size * 0.66, size * 0.30);
    ctx.quadraticCurveTo(0, size * 0.56, -size * 0.66, size * 0.30);
    ctx.closePath(); ctx.fill();
    // リムライト（光源側の縁）
    ctx.strokeStyle = rgbStr(hex2rgb(st.sunGlow), 0.42); ctx.lineWidth = size * 0.022;
    ctx.beginPath();
    var rr = st.sunX >= 0 ? 1 : -1;
    ctx.moveTo(rr * size * 0.34, -size * 0.52);
    ctx.quadraticCurveTo(rr * size * 0.74, -size * 0.30, rr * size * 0.66, size * 0.30);
    ctx.stroke();
    ctx.restore();

    // 目（発光する差し色。この魔獣で唯一の明るい色）
    var ey = y - size * 0.26, ex = size * 0.24, er = size * 0.115;
    Sprites.drawGlow(x - ex, ey, size * 0.30, '#ffe066', 0.75);
    Sprites.drawGlow(x + ex, ey, size * 0.30, '#ffe066', 0.75);
    ctx.fillStyle = '#fff6c8';
    ctx.beginPath(); ctx.ellipse(x - ex, ey, er, er * 0.52, -0.12, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + ex, ey, er, er * 0.52, 0.12, 0, 7); ctx.fill();
    ctx.fillStyle = '#3a2400';
    ctx.beginPath(); ctx.ellipse(x - ex, ey, er * 0.30, er * 0.42, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + ex, ey, er * 0.30, er * 0.42, 0, 0, 7); ctx.fill();
    // HP（魔獣の直下、答えの板より上）
    var bw = W * 0.42, bx = (W - bw) / 2, by = gm.bottom + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; rrect(ctx, bx, by, bw, 7, 4); ctx.fill();
    ctx.fillStyle = '#ff6a8a'; rrect(ctx, bx, by, bw * (1 - b.hits / BOSS_HITS), 7, 4); ctx.fill();
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

    // ── 正式アセット（assets/lumi.svg）が読めていればリグで描く。
    //    未読込・失敗時は下の手続き描画へフォールバックし、ゲームは止めない。
    if (window.LumiRig && LumiRig.isReady()) {
      ctx.save();
      ctx.translate(x, y - jump);
      ctx.rotate(tilt);
      ctx.scale(scale * 0.92, scale * 0.92 * squash);
      // 接地影
      var shA2 = clamp(0.40 - jump / 320, 0.07, 0.40), shW2 = clamp(23 - jump * 0.10, 12, 23);
      ctx.globalAlpha = shA2; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(0, 38 + jump * 0.30, shW2, shW2 * 0.28, 0, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
      LumiRig.draw(ctx, {
        t: t, unit: 1, sway: sway, wind: wind, wind2: wind2,
        squash: squash, sunX: st.sunX, jump: jump, combo: G.combo
      });
      ctx.restore();
      // 杖先の光と魔法粒子（実座標）
      var tipX2 = x + 12.6 * scale, tipY2 = (y - jump) - 33 * scale;
      Sprites.drawGlow(tipX2, tipY2, 26 * scale, st.part, 0.85);
      if (Math.random() < 0.5) {
        spawn('magic', tipX2, tipY2, { vx: rf(-24, 24), vy: rf(-46, -12), g: -20, life: rf(0.5, 1.0), r: rf(1.4, 3), c: st.part });
      }
      if (G.combo >= 10) {
        var aur2 = G.combo >= 50 ? hueColor(G.worldZ * 3) : st.edge;
        Sprites.drawGlow(x, y - jump - 16, 74 * scale, aur2, 0.30 + Math.min(G.combo, 60) / 300);
      }
      return;
    }

    ctx.save();
    ctx.translate(x, y - jump);
    ctx.rotate(tilt);
    ctx.scale(scale, scale * squash);

    // 接地影（跳ぶほど薄く小さく＝高さが読める）
    var shA = clamp(0.40 - jump / 320, 0.07, 0.40);
    var shW = clamp(23 - jump * 0.10, 12, 23);
    ctx.globalAlpha = shA;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 35 + jump * 0.30, shW, shW * 0.28, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = shA * 0.7;
    ctx.beginPath(); ctx.ellipse(0, 35 + jump * 0.30, shW * 0.5, shW * 0.16, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;

    // ── フォロースルー（追従遅れ）: 髪・マント・裾は本体を「遅れて」追う。
    //    本体と同位相にすると布に見えず機械的になる（Benchmark 第11項）。
    var lagX = (G.lagX - G.charX);                       // 右へ動くと負 = 布は左へ流れる
    var lagY = (G.lagY - G.bob);
    var sway = clamp(lagX * 0.55, -9, 9) + Math.sin(t * 0.9) * 1.6;
    var wind = Math.sin(t * 1.7) * 2.2 + lagY * 0.5;
    var wind2 = Math.sin(t * 1.7 + 0.9) * 2.8 + lagY * 0.7;

    // ── マント（いちばん外側。左右に大きく広がってなびく）
    var capeG = ctx.createLinearGradient(0, -22, 0, 34);
    capeG.addColorStop(0, '#7b52c4'); capeG.addColorStop(1, '#4a2d84');
    ctx.fillStyle = capeG;
    // 裾を短くして脚を見せる（脚が隠れると走行が読めない）
    ctx.beginPath();
    ctx.moveTo(-10, -19);
    ctx.quadraticCurveTo(-21 + sway * 1.6, 0, -17 + sway * 2.4, 19 + wind);
    ctx.quadraticCurveTo(-8 + sway * 2.0, 24 + wind2, 0, 22 + wind);
    ctx.quadraticCurveTo(8 + sway * 2.0, 24 + wind2, 17 + sway * 2.4, 19 + wind);
    ctx.quadraticCurveTo(21 + sway * 1.6, 0, 10, -19);
    ctx.closePath(); ctx.fill();
    // 光源の逆側に落ちる陰（立体感）
    ctx.globalAlpha = 0.38; ctx.fillStyle = '#2f1c5c';
    ctx.beginPath();
    var sh = st.sunX >= 0 ? -1 : 1;
    ctx.moveTo(0, -19);
    ctx.quadraticCurveTo(sh * 21 + sway * 1.6, 0, sh * 17 + sway * 2.4, 19 + wind);
    ctx.quadraticCurveTo(sh * 8 + sway * 2.0, 24 + wind2, 0, 22 + wind);
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;

    // ── 脚（膝のある2節。直線2本にしない = 記号化の回避）
    //    後ろ姿では「膝が上がり、靴底が見え、片脚が地面を蹴る」ことで走りが読める。
    drawLeg(-5.5, t, -1);
    drawLeg(5.5, t + Math.PI, 1);

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
    // 裾の金の縁取り
    ctx.strokeStyle = 'rgba(255,215,106,0.62)'; ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-13 + sway * 1.6, 19 + wind * 0.6);
    ctx.lineTo(13 + sway * 1.6, 19 + wind * 0.6);
    ctx.stroke();

    // ── 上体（白いローブ）＋ ベルトと裾の縁取り（細部が「作り込み」を出す）
    var body = ctx.createLinearGradient(-9, -20, 9, 4);
    body.addColorStop(0, st.sunX >= 0 ? '#d9c8f5' : '#fdf6ff');
    body.addColorStop(1, st.sunX >= 0 ? '#fdf6ff' : '#d9c8f5');
    ctx.fillStyle = body;
    rrect(ctx, -9.5, -19, 19, 22, 8); ctx.fill();
    // ベルト（くびれを作りシルエットを人体化する）
    ctx.fillStyle = '#6f4bb0';
    rrect(ctx, -9.5, -1.5, 19, 4.4, 2); ctx.fill();
    ctx.fillStyle = '#ffd76a';
    ctx.beginPath(); ctx.arc(0, 0.7, 1.9, 0, 7); ctx.fill();
    // 肩の縁取り
    ctx.strokeStyle = 'rgba(255,215,106,0.55)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(-9, -15.5); ctx.lineTo(9, -15.5); ctx.stroke();
    // 腕（走りに合わせて前後）
    ctx.strokeStyle = '#efe3ff'; ctx.lineWidth = 4.6; ctx.lineCap = 'round';
    // 腕は脚と逆位相（体幹の逆回転）
    var armA = Math.sin(t + Math.PI) * 9, armB = Math.sin(t) * 9;
    ctx.beginPath(); ctx.moveTo(-8.5, -13); ctx.lineTo(-10.5 - armA * 0.2, -4 + armA * 0.26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8.5, -13); ctx.lineTo(10.5 - armB * 0.2, -4 + armB * 0.26); ctx.stroke();

    // ── 長い髪（細めの毛束が3つ、風になびく）
    var hairG = ctx.createLinearGradient(0, -32, 0, 22);
    hairG.addColorStop(0, '#ffeec4'); hairG.addColorStop(0.45, '#ffd98f'); hairG.addColorStop(1, '#e8a95f');
    // 髪は細く。広いと体を覆い「髪の塊」に見えてシルエットが死ぬ。
    ctx.fillStyle = hairG;
    ctx.beginPath();
    ctx.moveTo(-7, -30);
    ctx.quadraticCurveTo(-10 + sway * 1.4, -10, -7.5 + sway * 2.3, 8 + wind);
    ctx.quadraticCurveTo(-3.5 + sway * 2.6, 14 + wind2, 0 + sway * 2.4, 12 + wind);
    ctx.quadraticCurveTo(3.5 + sway * 2.6, 14 + wind2, 7.5 + sway * 2.3, 8 + wind);
    ctx.quadraticCurveTo(10 + sway * 1.4, -10, 7, -30);
    ctx.closePath(); ctx.fill();
    // 3本の毛束が別位相で流れる（Art Bible 第9節）
    ctx.strokeStyle = hairG; ctx.lineWidth = 3.0; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6 + sway * 1.8, 2); ctx.quadraticCurveTo(-11 + sway * 3, 10 + wind, -12 + sway * 3.6, 17 + wind2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6 + sway * 1.8, 2); ctx.quadraticCurveTo(11 + sway * 3, 10 + wind2, 12 + sway * 3.6, 17 + wind); ctx.stroke();
    // 毛束のハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-3, -25); ctx.quadraticCurveTo(-5 + sway * 2, -4, -3 + sway * 2.4, 9 + wind); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(3, -25); ctx.quadraticCurveTo(5 + sway * 2, -4, 3 + sway * 2.4, 9 + wind); ctx.stroke();

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

    // ── リムライト（逆光側の縁を光らせ、暗い背景でシルエットを立てる）
    ctx.save();
    ctx.translate(x, y - jump); ctx.rotate(tilt); ctx.scale(scale, scale * squash);
    var rim = st.sunX >= 0 ? 1 : -1;
    ctx.strokeStyle = rgbStr(hex2rgb(st.sunGlow), 0.5); ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -30, 11.4, rim > 0 ? -1.5 : 1.5, rim > 0 ? 0.5 : 2.9); ctx.stroke();   // 頭
    ctx.beginPath();
    ctx.moveTo(rim * 11, -19); ctx.quadraticCurveTo(rim * 15, -4, rim * 12, 3);                        // 胴
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rim * 14 + sway * 1.4, 2); ctx.quadraticCurveTo(rim * 20 + sway * 2, 16, rim * 15 + sway * 2.4, 22 + wind);
    ctx.stroke();                                                                                       // マント縁
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

  /* 膝のある脚。phase 0..2π。lift>0 で遊脚（膝を上げる）、lift≈0 で接地。
     hip(腰) → knee(膝) → foot(足) の2節を実際に計算して描く。 */
  function drawLeg(hipX, phase, side) {
    var s = Math.sin(phase);
    var lift = Math.max(0, s);                 // 遊脚のとき正
    var thighLen = 11, shinLen = 11;
    var hipY = 14;
    // 遊脚は膝が前(上)に上がり、支持脚は伸びて後ろへ蹴り抜く
    // 遊脚は腿を上げ、膝を深く畳んで踵を尻へ引きつける（＝足が上がる）
    var thighAng = -0.35 + lift * 1.10 - Math.max(0, -s) * 0.45;
    var kneeBend = 0.30 + lift * 2.00;
    var kx = hipX + Math.sin(thighAng) * thighLen * side * 0.35;
    var ky = hipY + Math.cos(thighAng) * thighLen;
    var shinAng = thighAng - kneeBend;
    var fx = kx + Math.sin(shinAng) * shinLen * side * 0.35;
    var fy = ky + Math.cos(shinAng) * shinLen;

    // 太腿・脛
    ctx.strokeStyle = '#f0cfa4'; ctx.lineWidth = 5.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    // ブーツ（遊脚は靴底が見える＝踏み込みの証拠）
    ctx.save();
    ctx.translate(fx, fy); ctx.rotate(lift * 0.5 * side);
    ctx.fillStyle = '#3a2a5e';
    rrect(ctx, -3.4, -1.5, 6.8, 8, 2.6); ctx.fill();
    ctx.fillStyle = '#6f4bb0';                       // ブーツの折り返し
    rrect(ctx, -3.7, -2.4, 7.4, 2.6, 1.3); ctx.fill();
    if (lift > 0.45) { ctx.fillStyle = '#8a72b8'; rrect(ctx, -3.4, 4.6, 6.8, 2.4, 1.2); ctx.fill(); }
    ctx.restore();
    return { fx: fx, fy: fy, planted: lift < 0.08 };
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
    // 地平線に溜まる霞。世界と空の継ぎ目を消す。
    var hz = hex2rgb(st.haze);
    // 上端を硬い線にしない（硬いとボスや遠景を「切った」ように見える）
    var g = ctx.createLinearGradient(0, horizonY - 70, 0, horizonY + 120);
    g.addColorStop(0, rgbStr(hz, 0));
    g.addColorStop(0.30, rgbStr(hz, 0.34));
    g.addColorStop(0.46, rgbStr(hz, 0.50));
    g.addColorStop(0.72, rgbStr(hz, 0.20));
    g.addColorStop(1, rgbStr(hz, 0));
    ctx.fillStyle = g; ctx.fillRect(-OVERSCAN, horizonY - 70, W + OVERSCAN * 2, 190);
  }

  /* フィルムグレイン: 一度だけ作って敷き詰める。
     わずかな粒状感がベタ塗り感を消し、「描いた画」に見せる（商用品質の底上げ）。*/
  var grainTile = null;
  function getGrain() {
    if (grainTile) return grainTile;
    var n = 96, c = document.createElement('canvas');
    c.width = c.height = n;
    var g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = 128 + (Math.random() - 0.5) * 90;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainTile = c; return c;
  }

  function drawOverlays(st) {
    // カラーグレーディング: ハイライトを暖色へ、シャドウを寒色へ寄せる split-tone。
    // 写真的な色の分離が入ると一気に「作品」に見える。
    ctx.globalCompositeOperation = 'overlay';
    var tg = ctx.createLinearGradient(0, 0, 0, H);
    tg.addColorStop(0, rgbStr(hex2rgb(st.sunGlow), 0.16));
    tg.addColorStop(0.55, 'rgba(0,0,0,0)');
    tg.addColorStop(1, rgbStr(hex2rgb(st.sky[0]), 0.22));
    ctx.fillStyle = tg; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    // 粒状感
    ctx.globalAlpha = 0.035;
    ctx.globalCompositeOperation = 'overlay';
    var gt = getGrain(), ox = (G.worldZ * 7) % 96, oy = (G.worldZ * 11) % 96;
    for (var gx = -96; gx < W + 96; gx += 96)
      for (var gy = -96; gy < H + 96; gy += 96)
        ctx.drawImage(gt, gx - ox, gy - oy);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // ビネット（周辺を落として中央へ視線を集める）
    var vg = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.30, W / 2, H * 0.55, H * 0.88);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(0.65, 'rgba(0,0,0,0.16)');
    vg.addColorStop(1, 'rgba(0,0,0,0.52)');
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
      rrect(ctx, W / 2 - bw / 2, H * 0.62, bw, 34, 17); ctx.fill();
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
      d.innerHTML = '<b>' + w.w + '</b><span>' + w.ja + '</span>';
      el.ovMissed.appendChild(d);
    });
    if (VOCAB) VOCAB.persistReport();
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
    el.hintFreeze.addEventListener('click', function (e) { e.stopPropagation(); useFreeze(); });
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
    // 正式アートの読み込み（失敗しても手続き描画で動き続ける）
    if (window.LumiRig) LumiRig.load(clamp(W / 330, 0.95, 1.5));
    requestAnimationFrame(titleLoop);
    if (/[?&]selftest=1/.test(location.search)) SelfTest();
  }

  /* ── 自己テスト ────────────────────────────────────────────────────── */
  function SelfTest() {
    var ok = 0, ng = 0, log = [];
    function t(name, cond) { if (cond) { ok++; log.push('PASS ' + name); } else { ng++; log.push('FAIL ' + name); } }

    t('vocabulary loaded (>=200)', WORDS.length >= 200);
    t('every word can produce 2 POS-matched distractors', VOCAB.validate().noDistractor === 0);
    t('difficulty range 1..6 (Starter..Master)', WORDS.every(function (w) { return w.lvl >= 1 && w.lvl <= 6; }));

    t('stage 0m', stageFor(0).name === '暁の浮遊遺跡');
    t('stage 300m', stageFor(300).name === '翡翠の魔法森');
    t('stage 600m', stageFor(600).name === '星霜の大滝');
    t('stage 1000m', stageFor(1000).name === 'オーロラ雪嶺');
    t('stage 1500m', stageFor(1500).name === '天空神殿');
    t('all stages have scenery+palette', STAGES.every(function (s) { return s.scen && s.sky.length === 4 && s.part && s.edge; }));
    // Art Bible: 各ステージに光源方向と霞色（空気遠近の基準）がある
    t('every stage defines a light direction', STAGES.every(function (s) { return typeof s.sunX === 'number' && Math.abs(s.sunX) >= 0.3; }));
    t('every stage defines a haze color', STAGES.every(function (s) { return /^#[0-9a-f]{6}$/i.test(s.haze); }));
    // 空気遠近: 奥ほど霞へ寄る（単調増加）。これが無いと「図形の貼り付け」に見える
    setHaze(STAGES[0]);
    var near = depth('#000000', 0), mid = depth('#000000', 0.5), farC = depth('#000000', 1);
    function lum(rgbs) { var m = rgbs.match(/[\d.]+/g); return (+m[0] + +m[1] + +m[2]) / 3; }
    t('atmospheric perspective increases with depth', lum(near) < lum(mid) && lum(mid) < lum(farC));
    t('haze reaches 85% at horizon', Math.abs(hazeAmt(1) - 0.85) < 0.001 && hazeAmt(0) === 0);

    // 低いカメラ = 空が大きい / 0x0 起動でも世界が壊れない
    resize();
    t('viewport never degenerates to zero', W >= 240 && H >= 360 && roadHalfBottom > 0);
    t('camera is low (sky >= 40% of screen)', horizonY / H >= 0.40);
    // 主人公を画面下へ沈めない（足元は画面高の68〜75%）
    newGame();
    var footRatio = charY() / H;
    t('hero is not sunk to the bottom (foot 68-75%)', footRatio >= 0.68 && footRatio <= 0.75);
    // 速度で遠近が強まる（加速感）
    var d0f = DEPTH; G.speed = 2.2; for (var f = 0; f < 60; f++) updateFov(0.05);
    t('perspective deepens with speed (FOV)', DEPTH > d0f);
    G.speed = 1; for (var f2 = 0; f2 < 90; f2++) updateFov(0.05);
    t('perspective returns at base speed', Math.abs(DEPTH - 6.2) < 0.2);

    newGame();
    var seen = { 0: 0, 1: 0, 2: 0 }, valid = true;
    for (var i = 0; i < 200; i++) {
      nextQuestion();
      var c = G.q.choices;
      if (c.length !== 3 || new Set(c).size !== 3) valid = false;
      if (c[G.correctLane] !== G.q.word.ja) valid = false;
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
    WORDS.forEach(function (w) { all.push(w.ja); });
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
    // rrect は必ず新しいパスを開始する（開始しないと直前の図形と融合して塗られる）
    (function () {
      var probe = document.createElement('canvas').getContext('2d');
      probe.beginPath(); probe.moveTo(0, 0); probe.lineTo(50, 0); probe.lineTo(50, 50);
      rrect(probe, 60, 60, 10, 10, 2);
      // 新パスなら (0,0) は塗り領域に含まれない
      probe.fillStyle = '#fff';
      t('rrect starts a fresh path (no shape fusion)', !probe.isPointInPath(1, 1));
    })();

    newGame();
    var d0 = G.dist; G.chosen = G.correctLane; resolve();
    t('correct increases distance', G.dist > d0);
    t('correct increases combo', G.combo === 1);
    newGame();
    var lv = G.lives; G.chosen = (G.correctLane + 1) % 3; resolve();
    t('wrong loses a life', G.lives === lv - 1);
    t('wrong resets combo', G.combo === 0);
    t('wrong records missed word', G.missed.length === 1);

    // フォロースルー: 髪/マントの遅延値が本体と同位相にならないこと（機械的動きの回帰防止）
    newGame();
    G.charX = W / 2; G.lagX = W / 2;
    G.charLane = 2;
    var maxGap = 0;
    for (var u = 0; u < 40; u++) { update(0.016); maxGap = Math.max(maxGap, Math.abs(G.lagX - G.charX)); }
    t('cloth/hair lags behind the body (follow-through)', maxGap > 1.5);
    // カメラの移動量がオーバースキャンを超えると画面端に黒帯が出る
    newGame();
    var camOK = true;
    G.charLane = 0;
    for (var c2 = 0; c2 < 120; c2++) {
      update(0.016);
      if (Math.abs((G.charX - G.camX) * 0.22) > OVERSCAN * 3) camOK = false;
    }
    t('camera never starts detached (no edge gap at boot)', Math.abs(G.charX - G.camX) < W * 0.5 && camOK);
    // 膝のある脚: 遊脚は足が持ち上がり、支持脚は伸びて接地する（上下移動だけの走行を禁止）
    ctx.save();
    var swingLeg = drawLeg(0, Math.PI / 2, 1);    // 遊脚（膝が最も上がる位相）
    var standLeg = drawLeg(0, -Math.PI / 2, 1);   // 支持脚（伸びきる位相）
    ctx.restore();
    t('legs articulate: swing foot lifts above stance foot', swingLeg.fy < standLeg.fy - 3);
    t('stance leg registers ground contact', standLeg.planted && !swingLeg.planted);

    /* ── 語彙システムの品質ゲート ─────────────────────────────── */
    var V = VOCAB.validate();
    t('vocab: no missing/duplicate/bad entries', V.issues.missing === 0 && V.issues.duplicate === 0 && V.issues.badPos === 0 && V.issues.badLevel === 0);
    t('vocab: every word has an example + translation', V.missingExample === 0);
    t('vocab: every word can produce distractors', V.noDistractor === 0);

    // 100問連続で: 意図しない重複0 / 品詞不一致0 / 正解位置の偏り許容内
    newGame();
    var lanes = [0, 0, 0], dupes = 0, posBad = 0, seenIds = {}, jaToPos = {};
    WORDS.forEach(function (w) { if (!(w.ja in jaToPos)) jaToPos[w.ja] = w.pos; });
    for (var qi = 0; qi < 100; qi++) {
      nextQuestion();
      if (!G.q) break;
      if (seenIds[G.q.word.id]) dupes++;
      seenIds[G.q.word.id] = 1;
      lanes[G.correctLane]++;
      for (var ci = 0; ci < 3; ci++) {
        if (ci === G.correctLane) continue;
        var dp = jaToPos[G.q.choices[ci]];
        if (dp && dp !== G.q.word.pos) posBad++;
      }
      if (G.q.choices[G.correctLane] !== G.q.word.ja) posBad++;
    }
    t('vocab: 100 questions with 0 unintended duplicates', dupes === 0);
    t('vocab: 0 part-of-speech mismatched distractors', posBad === 0);
    var laneMin = Math.min(lanes[0], lanes[1], lanes[2]), laneMax = Math.max(lanes[0], lanes[1], lanes[2]);
    t('vocab: correct lane balanced (' + lanes.join('/') + ')', laneMax - laneMin <= 20);
    t('vocab: unique words per run >= 100', Object.keys(seenIds).length >= 100);

    /* ── 時間制限システム ─────────────────────────────────────── */
    t('timer: easier words get more time', timeForWord(1, 1, 1, 0) > timeForWord(6, 1, 1, 0));
    t('timer: Starter is 6-7s at base', timeForWord(1, 1, 1, 0) >= 6 && timeForWord(1, 1, 1, 0) <= 7);
    t('timer: Master is 3-4s at base', timeForWord(6, 1, 1, 0) >= 3 && timeForWord(6, 1, 1, 0) <= 4);
    t('timer: struggling players get more time', timeForWord(3, 5, 0.4, 0) > timeForWord(3, 5, 0.95, 0));
    t('timer: combo tightens the clock', timeForWord(3, 5, 0.9, 20) < timeForWord(3, 5, 0.9, 0));
    t('timer: never below 2.6s', timeForWord(6, 20, 1, 40) >= 2.6);

    // 時の砂は40%回復し、満タンを超えない
    newGame(); G.tLeft = G.tQ * 0.2; var before = G.tLeft; useSand();
    t('item: sand restores ~40% of the gauge', G.tLeft > before && Math.abs(G.tLeft - (before + G.tQ * 0.4)) < 0.01);
    newGame(); G.tLeft = G.tQ * 0.95; useSand();
    t('item: sand never exceeds full', G.tLeft <= G.tQ + 0.001);
    // 以降のタイマー検証は「表示中」を強制する（テスト実行時はペインが非表示のことがある）
    var realHidden = isHidden;
    isHidden = function () { return false; };

    // 時間停止中はゲージが減らない
    newGame(); useFreeze(); var t0 = G.tLeft;
    for (var fz = 0; fz < 20; fz++) update(0.016);
    t('item: freeze stops the clock', Math.abs(G.tLeft - t0) < 0.001 && G.freezeT > 0);
    // 停止解除後は再び減る
    G.freezeT = 0; var t1 = G.tLeft;
    for (var fz2 = 0; fz2 < 20; fz2++) update(0.016);
    t('timer: resumes after freeze ends', G.tLeft < t1);

    // 通常時は時間が流れる
    newGame(); var tv0 = G.tLeft;
    for (var vv = 0; vv < 30; vv++) update(0.016);
    t('timer: counts down while visible', G.tLeft < tv0);

    // 背景タブ・アプリ切替中は停止し、残り時間を保持する
    isHidden = function () { return true; };
    newGame(); G.tLeft = G.tQ * 0.6; var th0 = G.tLeft;
    for (var hh = 0; hh < 60; hh++) update(0.016);
    t('timer: pauses while the tab is hidden', Math.abs(G.tLeft - th0) < 0.0001);
    // 復帰したら保持した残り時間から再開する
    isHidden = function () { return false; };
    for (var hr = 0; hr < 10; hr++) update(0.016);
    t('timer: resumes from the preserved remainder', G.tLeft < th0 && G.tLeft > th0 - 0.4);

    // 時間切れは専用演出＋ライフ減
    newGame(); var lv0 = G.lives; G.tLeft = 0.001;
    update(0.05);
    t('timer: running out triggers timeout failure', G.kind === 'bad' && G.move === 'timeout' && G.lives === lv0 - 1);

    isHidden = realHidden;   // 本来の判定へ戻す

    // ゲージが問題文と答えの板を隠さない
    var gaugeOK = true;
    [[320, 700], [375, 812], [390, 844], [430, 932]].forEach(function (vp) {
      var sw = W, sh = H;
      W = vp[0]; H = vp[1]; roadHalfBottom = W * 0.60; horizonY = H * 0.46;
      var gg = gaugeGeom();
      if (gg.y <= H * 0.19 + 40) gaugeOK = false;              // 問題文と重ならない
      if (gg.y + 16 >= H * ANSWER_Y - 23) gaugeOK = false;      // 答えの板と重ならない
      if (gg.half * 2 > W - 20) gaugeOK = false;                // 画面外へ出ない
      W = sw; H = sh; roadHalfBottom = W * 0.60; horizonY = H * 0.46;
    });
    t('gauge: never overlaps the word or the answer plates (4 viewports)', gaugeOK);

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
