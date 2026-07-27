/* ==========================================================================
   WORD QUEST RUN — Ver2.0 engine (game.js)
   3レーン 英単語ランニングアドベンチャー
   - 主人公後方視点の疑似3Dランナー（Canvas）
   - 3本の道 = 3つの答え（左/中央/右）
   - 中央に英単語、3本の道の入口に日本語訳
   - 視線は常に画面中央に固定
   構成: helpers / Store / Sfx / Stages / Render / Question / Boss / Game / Input / SelfTest
   ========================================================================== */
(function () {
  'use strict';

  var WORDS = Array.isArray(window.WORDS) ? window.WORDS.slice() : [];

  /* ── helpers ───────────────────────────────────────────────────────── */
  function $(s, r) { return (r || document).querySelector(s); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rnd(arr.length)]; }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  /* ── Store (localStorage) ──────────────────────────────────────────── */
  var Store = {
    K_BEST: 'wqr2_best', K_SND: 'wqr2_sound',
    best: function () { var v = +localStorage.getItem(this.K_BEST); return isFinite(v) ? v : 0; },
    setBest: function (v) { try { localStorage.setItem(this.K_BEST, String(Math.round(v))); } catch (e) {} },
    sound: function () { return localStorage.getItem(this.K_SND) !== '0'; },
    setSound: function (on) { try { localStorage.setItem(this.K_SND, on ? '1' : '0'); } catch (e) {} }
  };

  /* ── Sfx (WebAudio, 軽量) ──────────────────────────────────────────── */
  var Sfx = {
    ctx: null, on: Store.sound(),
    ensure: function () {
      if (!this.on) return null;
      if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; } }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    blip: function (freq, dur, type, vol) {
      var c = this.ensure(); if (!c) return;
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.value = 0.0001;
      o.connect(g); g.connect(c.destination);
      var t = c.currentTime;
      g.gain.exponentialRampToValueAtTime(vol || 0.14, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.16));
      o.start(t); o.stop(t + (dur || 0.16) + 0.02);
    },
    good: function (combo) { var base = 520 + Math.min(combo, 12) * 22; this.blip(base, 0.12, 'triangle', 0.16); var s = this; setTimeout(function () { s.blip(base * 1.5, 0.11, 'triangle', 0.13); }, 70); },
    bad: function () { this.blip(150, 0.28, 'sawtooth', 0.16); },
    hint: function () { this.blip(880, 0.09, 'sine', 0.12); },
    boss: function () { this.blip(90, 0.5, 'square', 0.12); },
    fanfare: function () { var s = this, n = [523, 659, 784, 1046]; n.forEach(function (f, i) { setTimeout(function () { s.blip(f, 0.16, 'triangle', 0.15); }, i * 110); }); }
  };

  /* ── Stages (距離で世界が変化) ─────────────────────────────────────── */
  var STAGES = [
    { name: '古代遺跡', min: 0,    sky: ['#3a2f5a', '#120f26'], ground: '#2a2440', road: '#4b3f6e', line: '#c9a24b', accent: '#ffcf4d', hill: '#241d3d' },
    { name: '密林',     min: 300,  sky: ['#123a2e', '#07160f'], ground: '#123024', road: '#1e4a38', line: '#8ef0a8', accent: '#7ef0a0', hill: '#0d241a' },
    { name: '洞窟',     min: 600,  sky: ['#1a1830', '#050409'], ground: '#161326', road: '#2a2440', line: '#8fb8ff', accent: '#9fd0ff', hill: '#100c1f' },
    { name: '雪山',     min: 1000, sky: ['#2b4a66', '#0b1626'], ground: '#33465c', road: '#54708c', line: '#eaf6ff', accent: '#dff1ff', hill: '#22344a' },
    { name: '火山遺跡', min: 1500, sky: ['#5a1e1e', '#160607'], ground: '#3a1414', road: '#5e2222', line: '#ffb24a', accent: '#ff8a4a', hill: '#2a0d0d' }
  ];
  function stageFor(dist) {
    var s = STAGES[0];
    for (var i = 0; i < STAGES.length; i++) if (dist >= STAGES[i].min) s = STAGES[i];
    return s;
  }

  /* ── 突破演出 / 失敗演出のバリエーション ───────────────────────────── */
  var WINMOVES = ['jump', 'slide', 'dash', 'vault', 'strike'];   // 正解時
  var FAILMOVES = ['fall', 'crash', 'trip', 'bonk'];             // 不正解時
  var WIN_LABEL = { jump: '橋を跳んだ！', slide: 'スライドで通過！', dash: '一気に走り抜けた！', vault: '岩を乗り越えた！', strike: '敵を突破！' };
  var FAIL_LABEL = { fall: 'ズドン…落ちた', crash: 'ゴツン！衝突', trip: 'つまずいた…', bonk: '扉に激突！' };

  var BOSS_AT = [300, 600, 1000];     // ボス出現距離
  var BOSS_HITS = 3;                   // ボス撃破に必要な正解数

  /* ── Canvas / DOM ──────────────────────────────────────────────────── */
  var cv = $('#stage'), ctx = cv.getContext('2d');
  var W = 0, H = 0, DPR = 1, horizonY = 0;
  var el = {
    hudStage: $('#hudStage'), hudDist: $('#hudDist'), hudLives: $('#hudLives'), hudCombo: $('#hudCombo'),
    word: $('#qword'), pron: $('#qpron'), qmode: $('#qmode'), timer: $('#qtimer'),
    lanes: [$('#lane0'), $('#lane1'), $('#lane2')],
    banner: $('#banner'),
    hintScroll: $('#hintScroll'), hintSand: $('#hintSand'), hintEye: $('#hintEye'),
    hintScrollN: $('#hintScrollN'), hintSandN: $('#hintSandN'), hintEyeN: $('#hintEyeN'),
    title: $('#title'), over: $('#over'), howto: $('#howto'),
    titleBest: $('#titleBest'), sound: $('#soundBtn'),
    ovDist: $('#ovDist'), ovBest: $('#ovBest'), ovNew: $('#ovNew'), ovMissed: $('#ovMissed'), ovCombo: $('#ovCombo')
  };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    horizonY = H * 0.30;
    positionLanes();
  }

  /* レーンの画面上のX（読みやすさ優先で左/中央/右に固定配置） */
  var LANE_FRAC = [0.20, 0.50, 0.80];
  function positionLanes() {
    for (var i = 0; i < 3; i++) {
      var lx = LANE_FRAC[i] * W;
      var e = el.lanes[i];
      e.style.left = lx + 'px';
    }
  }

  /* 疑似3D: 深さ z(0=手前 .. 1=地平線) → 画面y と 道半幅 */
  var roadHalfBottom = 0;
  function road(z) {
    var s = 1 - z;              // 1手前 .. 0奥
    var e = smoothstep(s);      // 遠近圧縮
    var y = horizonY + e * (H - horizonY);
    var hw = e * roadHalfBottom;
    return { y: y, hw: hw };
  }
  function laneCenterX(lane, z) {
    var r = road(z);
    return W / 2 + (lane - 1) * (r.hw * 0.60);
  }

  /* ── Game state ────────────────────────────────────────────────────── */
  var G = null;
  function newGame() {
    G = {
      mode: 'play', phase: 'ask',
      dist: 0, lives: 3, combo: 0, bestCombo: 0, level: 1, qCount: 0,
      q: null, chosen: null, correctLane: 1,
      tQ: 3.2, tLeft: 3.2, blocked: {},          // blocked: 巻物で封鎖したレーン
      charLane: 1, charX: 0, targetX: 0, charY: 0, runPhase: 0, speed: 1,
      scroll: 0, shake: 0, flashLane: -1, flashT: 0,
      fx: [], boss: null,
      resolveT: 0, resolveKind: '', resolveMove: '',
      missed: [], recent: [], correctCount: 0, answered: 0,
      hints: { scroll: 3, sand: 3, eye: 3 }, sandT: 0,
      newBest: false
    };
    roadHalfBottom = W * 0.46;
    G.charX = laneCenterX(1, 0.10);
    updateHints();
    nextQuestion();
  }

  function timeForLevel(lv) { return clamp(3.4 - (lv - 1) * 0.18, 1.5, 3.4); }

  function updateLevel() {
    // 到達距離と正答率で難易度を調整
    var byDist = 1 + Math.floor(G.dist / 200);
    var acc = G.answered ? G.correctCount / G.answered : 1;
    var adj = acc > 0.85 ? 1 : acc < 0.5 ? -1 : 0;
    G.level = clamp(byDist + adj, 1, 12);
  }

  function maxDifficulty() {
    // レベルに応じて出題する単語難易度の上限
    if (G.level <= 2) return 1;
    if (G.level <= 4) return 2;
    if (G.level <= 7) return 3;
    return 4;
  }

  /* ── 出題 ──────────────────────────────────────────────────────────── */
  function pickWord() {
    var maxD = maxDifficulty();
    // 間違えた単語を優先的に再出題（ただし直近には出さない）
    var due = G.missed.filter(function (w) { return G.recent.indexOf(w.w) < 0; });
    if (due.length && Math.random() < 0.4) return pick(due);
    var pool = WORDS.filter(function (w) { return w.d <= maxD && G.recent.indexOf(w.w) < 0; });
    if (!pool.length) pool = WORDS.filter(function (w) { return w.d <= maxD; });
    if (!pool.length) pool = WORDS.slice();
    // 難易度上限に近い単語を少し優先
    var top = pool.filter(function (w) { return w.d >= maxD - 1; });
    return pick(top.length ? top : pool);
  }

  function nextQuestion() {
    G.phase = 'ask'; G.chosen = null; G.blocked = {}; G.flashLane = -1; G.flashT = 0;
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

    // DOM 更新
    el.word.textContent = word.w;
    el.pron.textContent = word.p || '';
    el.qmode.textContent = ['EASY', 'NORMAL', 'HARD', 'MASTER'][word.d - 1] || '';
    for (var i = 0; i < 3; i++) {
      var le = el.lanes[i];
      $('.laneText', le).textContent = choices[i];
      le.className = 'lane';
      le.style.opacity = '1';
    }
  }

  /* ── 回答 ──────────────────────────────────────────────────────────── */
  function choose(lane) {
    if (!G || G.mode !== 'play' || G.phase !== 'ask') return;
    if (G.blocked[lane]) return;                    // 封鎖レーンは選べない
    G.chosen = lane; G.charLane = lane;
    resolve();
  }

  function resolve() {
    G.phase = 'resolve'; G.answered++;
    var correct = (G.chosen === G.correctLane);
    el.lanes[G.correctLane].classList.add('lane--correct');
    if (!correct && G.chosen != null) el.lanes[G.chosen].classList.add('lane--wrong');

    if (correct) {
      G.resolveKind = 'good';
      G.resolveMove = WINMOVES[(G.qCount) % WINMOVES.length];
      G.correctCount++; G.combo++; G.bestCombo = Math.max(G.bestCombo, G.combo);
      var gain = 20 + Math.min(G.combo, 12);
      G.dist += gain; G.speed = clamp(1 + G.combo * 0.06, 1, 2.2);
      Sfx.good(G.combo);
      burst(laneCenterX(G.chosen, 0.14), H * 0.70, stageFor(G.dist).accent, 26);
      banner(WIN_LABEL[G.resolveMove] + (G.combo >= 5 ? '  ' + G.combo + ' COMBO' : ''), 'good');
      if (G.combo === 10) Sfx.fanfare();
      if (G.boss) { G.boss.hits++; if (G.boss.hits >= BOSS_HITS) defeatBoss(); }
    } else {
      G.resolveKind = 'bad';
      G.resolveMove = FAILMOVES[(G.qCount) % FAILMOVES.length];
      G.combo = 0; G.speed = 1; G.shake = 0.6; G.lives--;
      Sfx.bad();
      addMissed(G.q.word);
      banner((G.chosen == null ? 'まにあわなかった…' : FAIL_LABEL[G.resolveMove]) + '  正解: ' + G.q.word.a, 'bad');
    }
    updateHud();
    G.resolveT = correct ? 0.62 : 0.85;
  }

  function addMissed(word) {
    for (var i = 0; i < G.missed.length; i++) if (G.missed[i].w === word.w) return;
    G.missed.push(word);
  }

  function afterResolve() {
    for (var i = 0; i < 3; i++) el.lanes[i].className = 'lane';
    if (G.lives <= 0) return gameOver();
    // ボス距離に到達したらボス開始
    if (!G.boss) {
      for (var b = 0; b < BOSS_AT.length; b++) {
        if (!G.bossCleared || G.bossCleared.indexOf(BOSS_AT[b]) < 0) {
          if (G.dist >= BOSS_AT[b] && (!G.bossCleared || G.bossCleared.indexOf(BOSS_AT[b]) < 0)) { startBoss(BOSS_AT[b]); break; }
        }
      }
    }
    nextQuestion();
  }

  /* ── ボス ──────────────────────────────────────────────────────────── */
  function startBoss(at) {
    G.boss = { at: at, hits: 0, x: W / 2, hp: BOSS_HITS, shake: 0, intro: 1 };
    Sfx.boss();
    banner('BOSS あらわる！ ' + BOSS_HITS + '問 正解で撃破', 'boss');
  }
  function defeatBoss() {
    if (!G.bossCleared) G.bossCleared = [];
    G.bossCleared.push(G.boss.at);
    burst(W / 2, H * 0.40, '#ffcf4d', 60);
    Sfx.fanfare();
    banner('BOSS 撃破！ そのまま走れ！', 'good');
    G.boss = null;
  }

  /* ── ヒント（装備） ─────────────────────────────────────────────────── */
  function useScroll() {
    if (!G || G.phase !== 'ask' || G.hints.scroll <= 0) return;
    // 誤答レーンを1本封鎖して2択に
    var wrongLanes = [0, 1, 2].filter(function (i) { return i !== G.correctLane && !G.blocked[i]; });
    if (!wrongLanes.length) return;
    var b = pick(wrongLanes); G.blocked[b] = true;
    el.lanes[b].classList.add('lane--blocked'); el.lanes[b].style.opacity = '0.28';
    G.hints.scroll--; Sfx.hint(); updateHints();
  }
  function useSand() {
    if (!G || G.phase !== 'ask' || G.hints.sand <= 0) return;
    G.sandT = 2.2; G.hints.sand--; Sfx.hint(); updateHints();   // 分岐が近づく速度を遅く
  }
  function useEye() {
    if (!G || G.phase !== 'ask' || G.hints.eye <= 0) return;
    G.flashLane = G.correctLane; G.flashT = 0.6;                 // 正解を一瞬光らせる
    el.lanes[G.correctLane].classList.add('lane--hintflash');
    G.hints.eye--; Sfx.hint(); updateHints();
    setTimeout(function () { if (el.lanes[G.correctLane]) el.lanes[G.correctLane].classList.remove('lane--hintflash'); }, 600);
  }
  function updateHints() {
    el.hintScrollN.textContent = G.hints.scroll;
    el.hintSandN.textContent = G.hints.sand;
    el.hintEyeN.textContent = G.hints.eye;
    el.hintScroll.classList.toggle('is-empty', G.hints.scroll <= 0);
    el.hintSand.classList.toggle('is-empty', G.hints.sand <= 0);
    el.hintEye.classList.toggle('is-empty', G.hints.eye <= 0);
  }

  /* ── HUD ───────────────────────────────────────────────────────────── */
  function updateHud() {
    var st = stageFor(G.dist);
    el.hudStage.textContent = st.name;
    el.hudDist.textContent = Math.round(G.dist) + ' m';
    el.hudLives.textContent = '❤'.repeat(Math.max(0, G.lives)) + '·'.repeat(Math.max(0, 3 - G.lives));
    el.hudCombo.textContent = G.combo >= 2 ? G.combo + ' COMBO' : '';
    el.hudCombo.classList.toggle('hot', G.combo >= 10);
  }

  /* ── バナー / パーティクル ─────────────────────────────────────────── */
  var bannerT = 0;
  function banner(text, kind) {
    el.banner.textContent = text;
    el.banner.className = 'banner show ' + (kind || '');
    bannerT = 1.0;
  }
  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
      G.fx.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.6 + Math.random() * 0.4, t: 0, c: color, r: 2 + Math.random() * 3 });
    }
  }

  /* ── メインループ ──────────────────────────────────────────────────── */
  var last = 0, raf = 0;
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016; last = ts;
    if (G && G.mode === 'play') { update(dt); render(dt); }
  }

  function update(dt) {
    var sandSlow = G.sandT > 0 ? 0.45 : 1;
    if (G.sandT > 0) G.sandT -= dt;

    // 走行・スクロール
    var runSpeed = (G.phase === 'ask' ? 1 : 0.6) * G.speed;
    G.scroll = (G.scroll + dt * (2.6 + G.combo * 0.12) * runSpeed) % 1;
    G.runPhase = (G.runPhase + dt * (8 + G.combo * 0.4) * runSpeed) % (Math.PI * 2);

    // 主人公のレーン移動（なめらか）
    G.targetX = laneCenterX(G.charLane, 0.10);
    G.charX = lerp(G.charX, G.targetX, clamp(dt * 12, 0, 1));

    // 制限時間（分岐が近づく）
    if (G.phase === 'ask') {
      G.tLeft -= dt * sandSlow;
      if (G.tLeft <= 0) { G.chosen = null; resolve(); }
    } else if (G.phase === 'resolve') {
      G.resolveT -= dt;
      if (G.resolveT <= 0) { G.phase = 'ask'; afterResolve(); }
    }

    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 2);
    if (G.flashT > 0) G.flashT -= dt;
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.className = 'banner'; }

    // パーティクル
    for (var i = G.fx.length - 1; i >= 0; i--) {
      var p = G.fx[i]; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 480 * dt;
      if (p.t >= p.life) G.fx.splice(i, 1);
    }

    // タイマー表示
    var frac = clamp(G.tLeft / G.tQ, 0, 1);
    el.timer.style.transform = 'scaleX(' + frac + ')';
    el.timer.style.background = frac < 0.3 ? '#ff6a6a' : (stageFor(G.dist).accent);

    updateHud();
  }

  /* ── 描画 ──────────────────────────────────────────────────────────── */
  function render() {
    var st = stageFor(G.dist);
    ctx.save();
    var sx = 0, sy = 0;
    if (G.shake > 0) { sx = (Math.random() - 0.5) * 14 * G.shake; sy = (Math.random() - 0.5) * 14 * G.shake; }
    ctx.translate(sx, sy);

    drawSky(st);
    drawRoad(st);
    drawGate(st);
    if (G.boss) drawBoss(st);
    drawCharacter(st);
    drawParticles();
    if (G.combo >= 10) drawAura();
    ctx.restore();
  }

  function drawSky(st) {
    var g = ctx.createLinearGradient(0, 0, 0, horizonY + 40);
    g.addColorStop(0, st.sky[0]); g.addColorStop(1, st.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, horizonY + 60);
    // 遠景の丘（パララックス）
    ctx.fillStyle = st.hill;
    var off = (G.scroll * 40) % 120;
    for (var i = -1; i < W / 120 + 1; i++) {
      var bx = i * 120 - off;
      ctx.beginPath();
      ctx.moveTo(bx, horizonY);
      ctx.quadraticCurveTo(bx + 60, horizonY - 46, bx + 120, horizonY);
      ctx.fill();
    }
  }

  function drawRoad(st) {
    var top = road(1), bot = road(0);
    var cx = W / 2;
    // 地面
    ctx.fillStyle = st.ground; ctx.fillRect(-20, horizonY, W + 40, H - horizonY + 20);
    // 道（台形）
    ctx.fillStyle = st.road;
    ctx.beginPath();
    ctx.moveTo(cx - top.hw, top.y); ctx.lineTo(cx + top.hw, top.y);
    ctx.lineTo(cx + bot.hw, bot.y); ctx.lineTo(cx - bot.hw, bot.y);
    ctx.closePath(); ctx.fill();
    // レーン境界線（流れるダッシュで疾走感）
    ctx.strokeStyle = st.line; ctx.globalAlpha = 0.7;
    for (var b = 0; b < 2; b++) {
      var laneEdge = b - 0.5;   // -0.5, +0.5
      ctx.lineWidth = 2;
      for (var seg = 0; seg < 14; seg++) {
        var z0 = ((seg + G.scroll) / 14) % 1;
        var z1 = z0 + 0.035;
        if (z1 > 1) continue;
        var r0 = road(z0), r1 = road(z1);
        var x0 = cx + laneEdge * (r0.hw * 1.2), x1 = cx + laneEdge * (r1.hw * 1.2);
        ctx.beginPath(); ctx.moveTo(x0, r0.y); ctx.lineTo(x1, r1.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // 道の外周
    ctx.strokeStyle = st.line; ctx.globalAlpha = 0.35; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx - top.hw, top.y); ctx.lineTo(cx - bot.hw, bot.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + top.hw, top.y); ctx.lineTo(cx + bot.hw, bot.y); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* 3つの入口（門）: レーンごとに正解=通路、resolve中は演出 */
  function drawGate(st) {
    var z = 0.42;                       // 選択肢バンドの深さ（読みやすい位置）
    for (var i = 0; i < 3; i++) {
      var x = laneCenterX(i, z), r = road(z);
      var w = r.hw * 0.46, h = (H - horizonY) * 0.16;
      var y = r.y;
      var chosen = (G.phase !== 'ask' && G.chosen === i);
      var isCorrect = (i === G.correctLane);
      var col = st.line;
      if (G.phase !== 'ask') col = isCorrect ? '#7dffa8' : (chosen ? '#ff6a6a' : st.line);
      if (G.blocked[i]) col = '#7a6a3a';
      ctx.globalAlpha = G.blocked[i] ? 0.3 : 0.9;
      // 門柱
      ctx.fillStyle = col;
      ctx.fillRect(x - w, y - h, 5, h);
      ctx.fillRect(x + w - 5, y - h, 5, h);
      // 梁
      ctx.fillRect(x - w, y - h, w * 2, 5);
      // 正解が光る（魔法の目 / resolve）
      if ((G.flashT > 0 && G.flashLane === i) || (G.phase !== 'ask' && isCorrect)) {
        ctx.globalAlpha = 0.28; ctx.fillStyle = '#7dffa8';
        ctx.fillRect(x - w, y - h, w * 2, h);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawBoss(st) {
    var b = G.boss;
    var y = horizonY + 24, s = 54;
    ctx.save();
    ctx.translate(W / 2 + (Math.random() - 0.5) * (G.phase === 'resolve' && G.resolveKind === 'good' ? 8 : 0), y);
    // 本体（オリジナルの遺跡ゴーレム風・簡易）
    ctx.fillStyle = '#2c2440'; ctx.strokeStyle = st.accent; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-s, -s * 0.7, s * 2, s * 1.5, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = st.accent;
    ctx.beginPath(); ctx.arc(-s * 0.4, -s * 0.1, 8, 0, 7); ctx.arc(s * 0.4, -s * 0.1, 8, 0, 7); ctx.fill();
    ctx.restore();
    // HPバー
    var bw = W * 0.5, bx = (W - bw) / 2, by = horizonY - 14;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, 8);
    ctx.fillStyle = '#ff6a6a'; ctx.fillRect(bx, by, bw * (1 - b.hits / BOSS_HITS), 8);
  }

  function drawCharacter(st) {
    var y = H * 0.72, x = G.charX;
    var bob = Math.sin(G.runPhase) * 4;
    var jump = 0, rot = 0, squash = 1;
    if (G.phase === 'resolve') {
      var pr = 1 - clamp(G.resolveT / (G.resolveKind === 'good' ? 0.62 : 0.85), 0, 1);
      if (G.resolveKind === 'good') {
        if (G.resolveMove === 'jump' || G.resolveMove === 'vault') jump = Math.sin(pr * Math.PI) * 60;
        else if (G.resolveMove === 'slide') { squash = 0.6; y += 14; }
        else if (G.resolveMove === 'dash') x += pr * 8;
        else if (G.resolveMove === 'strike') rot = Math.sin(pr * Math.PI * 3) * 0.15;
      } else {
        if (G.resolveMove === 'fall') { y += pr * 90; rot = pr * 1.2; }
        else if (G.resolveMove === 'trip') { rot = pr * 1.4; y += pr * 20; }
        else if (G.resolveMove === 'crash' || G.resolveMove === 'bonk') { x += Math.sin(pr * 30) * 6 * (1 - pr); squash = 1 - pr * 0.3; }
      }
    }
    ctx.save();
    ctx.translate(x, y - bob - jump);
    ctx.rotate(rot);
    ctx.scale(1, squash);
    // 影
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 34, 20, 6, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    // 脚（走り）
    var lp = Math.sin(G.runPhase) * 8;
    ctx.strokeStyle = '#3a2f2a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-5, 16); ctx.lineTo(-8, 32 + lp); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, 16); ctx.lineTo(8, 32 - lp); ctx.stroke();
    // 体（マント姿のオリジナル冒険者）
    var body = ctx.createLinearGradient(0, -20, 0, 20);
    body.addColorStop(0, st.accent); body.addColorStop(1, '#4a3f66');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.roundRect(-14, -14, 28, 34, 10); ctx.fill();
    // 頭（フード）
    ctx.fillStyle = '#efe0c0';
    ctx.beginPath(); ctx.arc(0, -22, 11, 0, 7); ctx.fill();
    ctx.fillStyle = '#4a3f66';
    ctx.beginPath(); ctx.arc(0, -24, 12, Math.PI, 0); ctx.fill();
    // 目
    ctx.fillStyle = '#1a1420';
    ctx.beginPath(); ctx.arc(-3, -21, 1.6, 0, 7); ctx.arc(3, -21, 1.6, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (var i = 0; i < G.fx.length; i++) {
      var p = G.fx[i], a = 1 - p.t / p.life;
      ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawAura() {
    var x = G.charX, y = H * 0.72;
    var g = ctx.createRadialGradient(x, y, 4, x, y, 70);
    g.addColorStop(0, 'rgba(255,207,77,0.35)'); g.addColorStop(1, 'rgba(255,207,77,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 70, 0, 7); ctx.fill();
  }

  /* ── ゲーム終了 ─────────────────────────────────────────────────────── */
  function gameOver() {
    G.mode = 'over';
    G.newBest = G.dist > Store.best();
    if (G.newBest) Store.setBest(G.dist);
    el.ovDist.textContent = Math.round(G.dist) + ' m';
    el.ovBest.textContent = Store.best() + ' m';
    el.ovCombo.textContent = G.bestCombo + ' COMBO';
    el.ovNew.style.display = G.newBest ? '' : 'none';
    // 間違えた単語
    el.ovMissed.innerHTML = '';
    if (!G.missed.length) {
      el.ovMissed.innerHTML = '<div class="miss-empty">ミスなし！お見事！</div>';
    } else {
      G.missed.slice(0, 12).forEach(function (w) {
        var d = document.createElement('div'); d.className = 'miss';
        d.innerHTML = '<b>' + w.w + '</b><span>' + w.a + '</span>';
        el.ovMissed.appendChild(d);
      });
    }
    show('over');
  }

  /* ── 画面遷移 ───────────────────────────────────────────────────────── */
  function show(which) {
    el.title.classList.toggle('hidden', which !== 'title');
    el.over.classList.toggle('hidden', which !== 'over');
    el.howto.classList.add('hidden');
    document.body.classList.toggle('playing', which === 'play');
  }
  function startPlay() {
    Sfx.ensure();
    resize();
    show('play');
    newGame();
    if (!raf) raf = requestAnimationFrame(loop);
  }

  /* ── 入力 ──────────────────────────────────────────────────────────── */
  function bindInput() {
    // タップ: 画面左/中央/右の3分割（下部ヒントバーは除外）
    var field = $('#field');
    var sx = 0, sy = 0, moved = false, t0 = 0;
    field.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; moved = false; t0 = Date.now();
    }, { passive: true });
    field.addEventListener('touchend', function (e) {
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx > 40 || ady > 40) {                 // スワイプ
        if (adx > ady) choose(dx < 0 ? 0 : 2);
        else if (dy < 0) choose(1);               // 上スワイプ=中央
      } else {                                    // タップ（左/中央/右）
        var f = t.clientX / window.innerWidth;
        choose(f < 0.34 ? 0 : f > 0.66 ? 2 : 1);
      }
    }, { passive: true });

    // マウス（PC/デバッグ）
    field.addEventListener('click', function (e) {
      if ('ontouchstart' in window) return;
      var f = e.clientX / window.innerWidth;
      choose(f < 0.34 ? 0 : f > 0.66 ? 2 : 1);
    });

    // 各レーンラベル直接タップ
    for (var i = 0; i < 3; i++) (function (idx) {
      el.lanes[idx].addEventListener('click', function (e) { e.stopPropagation(); choose(idx); });
    })(i);

    // キーボード
    window.addEventListener('keydown', function (e) {
      if (G && G.mode === 'play') {
        if (e.key === 'ArrowLeft') { choose(0); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { choose(1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { choose(2); e.preventDefault(); }
        else if (e.key === '1') choose(0);
        else if (e.key === '2') choose(1);
        else if (e.key === '3') choose(2);
      }
    });

    // ヒント
    el.hintScroll.addEventListener('click', function (e) { e.stopPropagation(); useScroll(); });
    el.hintSand.addEventListener('click', function (e) { e.stopPropagation(); useSand(); });
    el.hintEye.addEventListener('click', function (e) { e.stopPropagation(); useEye(); });

    // ボタン
    $('#startBtn').addEventListener('click', startPlay);
    $('#retryBtn').addEventListener('click', startPlay);
    $('#howtoBtn').addEventListener('click', function () { el.howto.classList.toggle('hidden'); });
    $('#howtoClose').addEventListener('click', function () { el.howto.classList.add('hidden'); });
    $('#homeBtn').addEventListener('click', function () { G && (G.mode = 'title'); show('title'); el.titleBest.textContent = Store.best() + ' m'; });
    el.sound.addEventListener('click', function () {
      Sfx.on = !Sfx.on; Store.setSound(Sfx.on);
      el.sound.textContent = Sfx.on ? '🔊 音あり' : '🔈 音なし';
      if (Sfx.on) Sfx.ensure();
    });
    window.addEventListener('resize', function () { if (document.body.classList.contains('playing')) resize(); });
  }

  /* ── 起動 ──────────────────────────────────────────────────────────── */
  function boot() {
    el.titleBest.textContent = Store.best() + ' m';
    el.sound.textContent = Sfx.on ? '🔊 音あり' : '🔈 音なし';
    bindInput();
    resize();
    show('title');
    if (/[?&]selftest=1/.test(location.search)) SelfTest();
  }

  /* ── 自己テスト（?selftest=1） ─────────────────────────────────────── */
  function SelfTest() {
    var log = [], ok = 0, ng = 0;
    function assert(name, cond) { if (cond) { ok++; log.push('PASS ' + name); } else { ng++; log.push('FAIL ' + name); } }

    assert('WORDS loaded (>=60)', WORDS.length >= 60);
    assert('every word has 3+ distractors', WORDS.every(function (w) { return w.x && w.x.length >= 3; }));
    assert('difficulties 1..4', WORDS.every(function (w) { return w.d >= 1 && w.d <= 4; }));

    // stageFor thresholds
    assert('stage 0m=古代遺跡', stageFor(0).name === '古代遺跡');
    assert('stage 300m=密林', stageFor(300).name === '密林');
    assert('stage 999m=洞窟', stageFor(999).name === '洞窟');
    assert('stage 1500m=火山遺跡', stageFor(1500).name === '火山遺跡');

    // question generation
    newGame();
    var seenCorrect = { 0: 0, 1: 0, 2: 0 }, uniqueOK = true;
    for (var i = 0; i < 200; i++) {
      nextQuestion();
      var c = G.q.choices;
      if (c.length !== 3) uniqueOK = false;
      if (new Set(c).size !== 3) uniqueOK = false;
      if (c[G.correctLane] !== G.q.word.a) uniqueOK = false;
      if (G.correctLane < 0 || G.correctLane > 2) uniqueOK = false;
      seenCorrect[G.correctLane]++;
    }
    assert('choices unique & correct mapped (x200)', uniqueOK);
    assert('correct lane randomized across 0/1/2', seenCorrect[0] > 10 && seenCorrect[1] > 10 && seenCorrect[2] > 10);

    // timeForLevel monotonic & bounded
    assert('timeForLevel decreases with level', timeForLevel(1) > timeForLevel(6));
    assert('timeForLevel bounded >=1.5', timeForLevel(50) >= 1.5);

    // resolve: correct increases distance, wrong loses life
    newGame();
    var d0 = G.dist; G.chosen = G.correctLane; resolve();
    assert('correct answer increases distance', G.dist > d0);
    assert('correct answer increases combo', G.combo === 1);
    newGame();
    var lv = G.lives; G.chosen = (G.correctLane + 1) % 3; resolve();
    assert('wrong answer loses a life', G.lives === lv - 1);
    assert('wrong answer resets combo', G.combo === 0);
    assert('wrong answer records missed word', G.missed.length === 1);

    // hints
    newGame();
    var hs = G.hints.scroll; useScroll();
    assert('scroll hint blocks a wrong lane', G.hints.scroll === hs - 1 && !G.blocked[G.correctLane]);

    G.mode = 'title';
    var summary = 'SELFTEST: ' + ok + ' passed, ' + ng + ' failed';
    (ng ? console.error : console.log)(summary + '\n' + log.join('\n'));
    var badge = document.createElement('div');
    badge.id = 'selftest-badge';
    badge.style.cssText = 'position:fixed;z-index:9999;left:8px;bottom:8px;padding:6px 10px;border-radius:8px;font:600 12px system-ui;color:#fff;background:' + (ng ? '#b03030' : '#207a3a');
    badge.textContent = summary;
    document.body.appendChild(badge);
    show('title');
    return { ok: ok, ng: ng };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // debug hook（?selftest 等の検証用。通常プレイには影響しない）
  window.__WQR = {
    stageFor: stageFor, timeForLevel: timeForLevel,
    get state() { return G; },
    answer: function (lane) { if (G) { G.chosen = lane; G.charLane = lane; resolve(); } },
    advance: function () { if (G) afterResolve(); }
  };
})();
