/* ==========================================================================
   WORD QUEST RUN — LUMI アセットパイプライン + リグ

   assets/lumi.svg（正式アート原本）から各 <symbol> を取り出してラスタライズし、
   パーツごとのピボットで回転・追従させて走行アニメーションを作る。

   設計:
   - アートは SVG が正本。コード側に形状を持たない（差し替えるだけで見た目が変わる）
   - 読み込み前・失敗時は game.js 側の手続き描画へフォールバックし、ゲームは絶対に止めない
   - パーツのピボットと配置は docs/CHARACTER_BIBLE_LUMI.md 第6・7節に従う

   ローカル座標系: 全高110ユニット。足裏 y=+38、帽子の先 y=-72、腰 y=-5。
   ========================================================================== */
(function () {
  'use strict';

  var SRC = 'assets/lumi.svg';
  var RASTER_SCALE = 3;          // 画面サイズに対する解像度倍率（拡大に耐える）

  /* パーツ定義: id → { w,h(ローカルユニット), px,py(ピボットの割合 0..1) } */
  var PARTS = {
    hatCrown: { id: 'lumi-hat-crown', w: 34, h: 30, px: 0.42, py: 0.98 },
    hatBrim:  { id: 'lumi-hat-brim',  w: 40, h: 12, px: 0.50, py: 0.55 },
    head:     { id: 'lumi-head',      w: 25, h: 25, px: 0.50, py: 0.50 },
    braid:    { id: 'lumi-braid',     w: 11, h: 18, px: 0.50, py: 0.05 },
    braidTie: { id: 'lumi-braid-tie', w: 9,  h: 9,  px: 0.50, py: 0.20 },
    hairLoose:{ id: 'lumi-hair-loose',w: 15, h: 26, px: 0.50, py: 0.05 },
    cape:     { id: 'lumi-cape',      w: 38, h: 42, px: 0.76, py: 0.05 },
    scarf:    { id: 'lumi-scarf',     w: 13, h: 9,  px: 0.05, py: 0.40 },
    torso:    { id: 'lumi-torso',     w: 24, h: 26, px: 0.50, py: 0.08 },
    skirt:    { id: 'lumi-skirt',     w: 30, h: 22, px: 0.50, py: 0.05 },
    arm:      { id: 'lumi-arm',       w: 11, h: 29, px: 0.45, py: 0.05 },
    leg:      { id: 'lumi-leg',       w: 12, h: 30, px: 0.45, py: 0.04 },
    boot:     { id: 'lumi-boot',      w: 17, h: 18, px: 0.50, py: 0.10 },
    staff:    { id: 'lumi-staff',     w: 9,  h: 52, px: 0.40, py: 0.60 },
    crescent: { id: 'lumi-crescent',  w: 16, h: 16, px: 0.45, py: 0.85 },
    orb:      { id: 'lumi-orb',       w: 12, h: 12, px: 0.50, py: 0.50 },
    satchel:  { id: 'lumi-satchel',   w: 18, h: 16, px: 0.50, py: 0.30 }
  };

  var images = {};      // key → HTMLImageElement（ラスタライズ済み）
  var ready = false;
  var failed = false;

  function loadAll(unitPx) {
    if (typeof fetch !== 'function' || typeof DOMParser !== 'function') { failed = true; return; }
    fetch(SRC).then(function (r) {
      if (!r.ok) throw new Error('svg ' + r.status);
      return r.text();
    }).then(function (text) {
      var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      var pending = 0, done = 0, any = false;
      Object.keys(PARTS).forEach(function (key) {
        var def = PARTS[key];
        var sym = doc.getElementById(def.id);
        if (!sym) return;
        var vb = sym.getAttribute('viewBox') || '0 0 100 100';
        var w = Math.max(2, Math.round(def.w * unitPx * RASTER_SCALE));
        var h = Math.max(2, Math.round(def.h * unitPx * RASTER_SCALE));
        // symbol の中身をそのまま持つ独立SVGを作る（グラデーションは symbol 内に閉じてある）
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
                  '" viewBox="' + vb + '" preserveAspectRatio="none">' + sym.innerHTML + '</svg>';
        var img = new Image();
        pending++; any = true;
        img.onload = function () { images[key] = img; if (++done >= pending) ready = true; };
        img.onerror = function () { if (++done >= pending) ready = Object.keys(images).length > 0; };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      });
      if (!any) failed = true;
    }).catch(function () { failed = true; });
  }

  /* パーツを1枚描く。(x,y)=ピボット位置、ang=回転(rad)、sc=追加スケール */
  function part(ctx, key, x, y, ang, unit, sc, alpha, flip) {
    var img = images[key], def = PARTS[key];
    if (!img || !def) return;
    var w = def.w * unit * (sc || 1), h = def.h * unit * (sc || 1);
    ctx.save();
    ctx.translate(x, y);
    if (ang) ctx.rotate(ang);
    if (flip) ctx.scale(-1, 1);
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.drawImage(img, -def.px * w, -def.py * h, w, h);
    ctx.restore();
  }

  /* ── 走行リグ ──────────────────────────────────────────────────────
     s: {
       t: 走行位相, unit: 1ユニットのpx, sway: 横揺れ, wind/wind2: 風,
       squash: 縦の潰し, sunX: 光源方向, jump: 跳躍量, combo: コンボ
     }
     ローカル原点は「腰」。呼び出し側で translate/rotate/scale 済みであること。 */
  function drawRig(ctx, s) {
    if (!ready) return false;
    var u = s.unit, t = s.t;
    var sway = s.sway || 0, wind = s.wind || 0, wind2 = s.wind2 || 0;

    // 主要な骨の位置（ローカルユニット・腰が原点）
    var HIP = 0, SHOULDER = -17.6, CHIN = -23, HEADC = -35, HATBASE = -47;

    /* 脚: 腿と脛を別々に回転させ、膝を作る（上下移動だけの走行にしない） */
    function leg(sideSign, phase) {
      var sn = Math.sin(phase), lift = Math.max(0, sn);
      var thighAng = -0.32 + lift * 1.05 - Math.max(0, -sn) * 0.42;
      var kneeBend = 0.28 + lift * 1.85;
      var hipX = sideSign * 3.6, hipY = HIP + 1;
      var TL = 11, SL = 11;
      var kx = hipX + Math.sin(thighAng) * TL * 0.35 * sideSign;
      var ky = hipY + Math.cos(thighAng) * TL;
      var shinAng = thighAng - kneeBend;
      var fx = kx + Math.sin(shinAng) * SL * 0.35 * sideSign;
      var fy = ky + Math.cos(shinAng) * SL;
      // 腿
      part(ctx, 'leg', hipX * u, hipY * u, thighAng * 0.5, u, 0.42, 1, sideSign < 0);
      // 脛
      part(ctx, 'leg', kx * u, ky * u, shinAng * 0.5, u, 0.38, 1, sideSign < 0);
      // ブーツ（遊脚は靴底が見えるよう傾ける）
      part(ctx, 'boot', fx * u, fy * u, lift * 0.45 * sideSign, u, 0.62, 1, sideSign < 0);
      return { fx: fx, fy: fy, planted: lift < 0.08 };
    }

    var legBack = leg(-1, t + Math.PI);     // 奥の脚を先に
    part(ctx, 'staff', (9.5 + sway * 0.2) * u, (-6) * u, 0.06, u, 0.62);
    var legFront = leg(1, t);

    // スカート → 胴（背面なので布が体を覆う）
    part(ctx, 'skirt', (sway * 0.5) * u, (HIP - 4) * u, sway * 0.012, u, 0.62);
    part(ctx, 'torso', 0, (SHOULDER + 1) * u, 0, u, 0.62);

    // 腕（脚と逆位相＝体幹の逆回転）
    var armB = Math.sin(t) * 0.34, armF = Math.sin(t + Math.PI) * 0.34;
    part(ctx, 'arm', -7.4 * u, (SHOULDER + 2) * u, armB, u, 0.40, 1, true);
    part(ctx, 'arm', 7.4 * u, (SHOULDER + 2) * u, armF, u, 0.40);

    // サッチェル（腰で跳ねる）
    part(ctx, 'satchel', (-6 + sway * 0.5) * u, (HIP + 1 + Math.sin(t * 2) * 0.5) * u,
      sway * 0.02, u, 0.36);

    // ハーフマント（右肩・遅れて追う）
    part(ctx, 'cape', (7 + sway * 1.1) * u, (SHOULDER - 1) * u,
      sway * 0.030 + wind * 0.008, u, 0.60);

    // 頭
    part(ctx, 'head', 0, HEADC * u, sway * 0.010, u, 0.60);

    // 遊び毛（右・短い側）
    part(ctx, 'hairLoose', (5.2 + sway * 0.7) * u, (CHIN - 6) * u, sway * 0.026, u, 0.52);

    // 三つ編み（左・3節が順に遅れて波打つ）
    var bx = -5.4, by = CHIN - 5, ba = 0;
    for (var i = 0; i < 3; i++) {
      var lagN = sway * (0.030 + i * 0.020) + (i === 0 ? wind : wind2) * 0.010;
      ba += lagN + 0.06;
      part(ctx, 'braid', bx * u, by * u, ba, u, 0.52);
      bx += Math.sin(ba) * 7.6;
      by += Math.cos(ba) * 7.6;
    }
    part(ctx, 'braidTie', bx * u, by * u, ba, u, 0.42);

    // 帽子（つば → 冠部。先端がしなる）
    var hatA = sway * 0.020 + Math.sin(t * 0.9 + 0.6) * 0.035;
    part(ctx, 'hatBrim', 0, HATBASE * u, hatA * 0.5, u, 0.62);
    part(ctx, 'hatCrown', 0, (HATBASE - 1) * u, hatA, u, 0.62);

    // スカーフ（3節・動きの視認性を担う唯一の暖色）
    var sx = 3.0, sy = CHIN - 1, sa = -0.5;
    for (var k = 0; k < 3; k++) {
      sa += sway * (0.045 + k * 0.030) + wind2 * 0.014 + 0.24;
      part(ctx, 'scarf', sx * u, sy * u, sa, u, 0.52, 1 - k * 0.12);
      sx += Math.cos(sa) * 5.4;
      sy += Math.sin(sa) * 5.4;
    }

    // 杖頭（三日月）とグリフオーブ
    var cx = (10.6 + sway * 0.2) * u, cy = (-34) * u;
    part(ctx, 'crescent', cx, cy, 0.06, u, 0.62);
    part(ctx, 'orb', cx + 1.2 * u, cy - 1.0 * u, 0, u,
      0.52 * (1 + Math.sin(t * 1.7) * 0.05));

    return { planted: legFront.planted || legBack.planted };
  }

  window.LumiRig = {
    load: loadAll,
    draw: drawRig,
    isReady: function () { return ready; },
    hasFailed: function () { return failed; },
    partCount: function () { return Object.keys(images).length; },
    expectedParts: function () { return Object.keys(PARTS).length; }
  };
})();
