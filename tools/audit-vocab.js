#!/usr/bin/env node
/* WORD QUEST RUN — 語彙の意味品質監査ツール
   使い方: node tools/audit-vocab.js [--write]

   役割:
   1. 不自然・説明的な訳を修正（CORRECTIONS）
   2. 低頻度語・非標準語・ゲームに不向きな語を隔離（QUARANTINE）
   3. 「複数正解に見える」語を意味単位でグループ化（自動検出 + 手当てした種）
   4. 結果を vocab-quality.js へ書き出す（実行時コスト0にするため事前計算）

   方針: 偽陽性は安全側。同時出題されなくなるだけで、3,002語あるため損失はない。
         偽陰性（見逃し）は壊れた問題になるため、積極的にグループ化する。
*/

/* ── 1. 訳の修正 ─────────────────────────────────────────────────────
   「説明的すぎる」「機械翻訳調」「衝突回避のため不自然になった」訳を自然な語へ。 */
var CORRECTIONS = {
  enormous: '莫大な',
  tiny: 'ちっぽけな',
  massive: '大規模な',
  impact: '強い影響',
  crucial: '決定的な',
  vital: '肝心な',
  claim: '言い張る',
  acknowledge: '素直に認める',
  admit: '白状する',
  postulate: '前提として置く',
  assume: '当然と思う',
  coordinate: '足並みをそろえる',
  adjust: '調節する',
  liberate: '自由の身にする',
  negotiable: '交渉可能な',
  validate: '妥当だと確かめる',
  manipulate: '意のままに操る',
  orchestrate: '裏で仕組む',
  undermine: 'じわじわ弱らせる',
  instill: '染み込ませる',
  compel: '余儀なくさせる',
  deter: '抑止する',
  dissuade: '思いとどまらせる',
  denounce: '糾弾する',
  condemn: '断罪する',
  negligible: 'ごくわずかな',
  perpetual: '永続する',
  allegedly: '報じられるところでは',
  conceivably: 'ひょっとすると',
  meticulously: '入念に',
  corollary: '当然の帰結',
  moratorium: '猶予措置',
  impunity: 'おとがめなし',
  charisma: '人望',
  obfuscate: '煙に巻く',
  exhort: '力説して促す',
  repudiate: 'きっぱり否定する',
  usurp: '横取りする',
  relinquish: '譲り渡す',
  circumvent: '出し抜く',
  plausible: 'ありそうな',
  malleable: '順応性のある',
  insidious: '油断ならない',
  assign: '任せる',
  confirm: '確認して裏づける',
  urge: 'せき立てる',
  calibrate: '較正する',
  prioritize: '優先づける',
  dissect: '細かく解剖する',
  differentiate: '見分ける',
  recognize: 'それと分かる',
  contamination: '汚染された状態',
  legacy: '後世に残るもの',
  scrutiny: '精査',
  nuance: 'ニュアンス',
  consequence: '成り行きの結末',
  outcome: '結末',
  premise: '前提',
  assumption: '思い込み',
  provoke: 'あおる',
  cause: '引き起こす',
  salvage: '引き揚げる',
  rescue: '救助する',
  emancipation: '解き放つこと',
  liberation: '解放',
  nourishment: '滋養',
  nutrient: '栄養素',
  nutrition: '栄養',
  cuisine: '郷土料理',
  exam: '試験の問題',
  lesson: '学課',
  inform: '通知する',
  tell: '伝える',
  complain: 'ぼやく',
  prefer: '好む方を取る',
  feed: 'えさをやる',
  collapse: '崩れ落ちる',
  fall: '落ちる',
  remind: '思い出させる',
  hardly: 'ほとんどしない',
  almost: 'もう少しで',
  attic: '屋根裏',
  dome: '丸屋根',
  risk: 'リスク',
  danger: '危険',
  destination: '行き先',
  purpose: '目的',
  campaign: '啓発運動',
  sport: 'スポーツ',
  tension: '緊迫',
  exacerbate: '一層ひどくする',
  deteriorate: '悪化する',
  actually: '実のところ',
  indeed: 'いかにも',
  consequently: 'その結果',
  forsake: '見放す',
  abandon: '見捨てる',
  divide: '分ける',
  suspend: '一時停止する',
  temporary: '一時的な'
};

/* ── 2. 隔離（ゲームで出題しない） ───────────────────────────────────
   低頻度・非標準・専門的すぎる・ゲームで問う価値が薄い語。
   削除ではなく隔離。データは残し、出題対象から外す。 */
var QUARANTINE = {
  ostensively: '非標準語（ostensibly の誤形）',
  surplusage: '法律分野の低頻度語',
  corequisite: '教務用語で低頻度',
  indispensably: '低頻度の副詞',
  consequentially: '低頻度。consequently と紛らわしい',
  extemporize: '低頻度。improvise と重複',
  stretchy: '口語的で品詞判定が曖昧',
  ostensibly: '中級帯には抽象度が高すぎる',
  vicariously: '低頻度の副詞',
  ineluctably: '低頻度・文語',
  attenuation: '専門用語',
  omnivore: '理科の専門語',
  herbivore: '理科の専門語',
  carnivore: '理科の専門語',
  pupa: '理科の専門語',
  larva: '理科の専門語',
  bellows: '低頻度の道具語',
  anvil: '低頻度の道具語',
  spindle: '低頻度の道具語',
  loom: '低頻度の道具語',
  quarry: '低頻度',
  deductible: '保険の専門語',
  reimbursement: '事務の専門語',
  overhead: '会計の専門語で多義',
  collateral: '金融の専門語',
  dividend: '金融の専門語',
  turnover: '多義で紛らわしい',
  procurement: '事務の専門語',
  logistics: '専門語',
  prognosis: '医療の専門語',
  pathology: '医療の専門語',
  physiology: '医療の専門語',
  dosage: '医療の専門語',
  metabolism: '専門語',
  enzyme: '理科の専門語',
  hormone: '理科の専門語',
  sediment: '理科の専門語',
  residue: '理科の専門語',
  catalyst: '理科の専門語',
  specimen: '理科の専門語',
  compendium: '低頻度',
  tautology: '論理学の専門語',
  sophistry: '低頻度',
  polemic: '低頻度',
  treatise: '低頻度',
  epistemology: '哲学の専門語',
  ontology: '哲学の専門語',
  dialectic: '哲学の専門語',
  heuristic: '専門語',
  axiom: '専門語',
  asceticism: '低頻度',
  hedonism: '低頻度',
  nihilism: '低頻度',
  oligarchy: '低頻度',
  autocracy: '低頻度',
  meritocracy: '低頻度',
  nepotism: '低頻度',
  restitution: '法律の専門語',
  reparation: '法律の専門語',
  prerogative: '低頻度',
  subterfuge: '低頻度',
  duplicity: '低頻度',
  erudition: '低頻度',
  diaspora: '低頻度',
  schism: '低頻度',
  exodus: '低頻度',
  symbiosis: '理科の専門語',
  metamorphosis: '理科の専門語',
  disenfranchise: '低頻度',
  misappropriate: '低頻度',
  embezzle: '低頻度',
  divest: '低頻度',
  disband: '低頻度',
  ostracize: '低頻度',
  vilify: '低頻度',
  abdicate: '低頻度',
  subjugate: '低頻度',
  irascible: '低頻度',
  timorous: '低頻度',
  truculent: '低頻度',
  obsequious: '低頻度',
  parsimonious: '低頻度',
  profligate: '低頻度',
  squalid: '低頻度',
  turgid: '低頻度',
  florid: '低頻度',
  laconic: '低頻度',
  garrulous: '低頻度',
  abstruse: '低頻度',
  arcane: '低頻度',
  esoteric: '低頻度',
  specious: '低頻度',
  spurious: '低頻度',
  quintessential: '低頻度',
  ephemeral: '低頻度',
  intractable: '低頻度',
  pernicious: '低頻度',
  innocuous: '低頻度',
  banal: '低頻度',
  wistful: '低頻度',
  poignant: '低頻度',
  harrowing: '低頻度',
  gait: '低頻度',
  dexterity: '低頻度',
  countenance: '低頻度',
  demeanor: '低頻度',
  proclivity: '低頻度',
  propensity: '低頻度'
};

/* ── 3. 手当てした混同グループ（自動検出が拾えない意味的な近さ） ────── */
var CONFUSABLE_SEED = [
  ['work', 'job', 'task', 'labor'],
  ['travel', 'trip', 'journey', 'tour'],
  ['begin', 'start', 'initiate', 'commence'],
  ['look', 'watch', 'see', 'observe', 'gaze'],
  ['erase', 'remove', 'eliminate', 'delete'],
  ['big', 'huge', 'enormous', 'massive', 'giant'],
  ['small', 'tiny', 'little', 'compact'],
  ['important', 'crucial', 'vital', 'essential', 'significant'],
  ['quick', 'fast', 'rapid', 'swift'],
  ['angry', 'furious', 'mad'],
  ['happy', 'glad', 'joyful', 'cheerful'],
  ['sad', 'unhappy', 'gloomy', 'melancholy'],
  ['smart', 'clever', 'intelligent', 'wise'],
  ['make', 'create', 'produce', 'build', 'construct'],
  ['choose', 'select', 'pick', 'prefer'],
  ['answer', 'reply', 'respond'],
  ['keep', 'maintain', 'preserve', 'retain', 'sustain'],
  ['stop', 'halt', 'cease', 'quit', 'terminate'],
  ['help', 'assist', 'aid', 'support'],
  ['show', 'display', 'reveal', 'indicate', 'demonstrate'],
  ['think', 'consider', 'ponder', 'contemplate', 'reflect'],
  ['fear', 'dread', 'terror', 'anxiety'],
  ['danger', 'risk', 'threat', 'hazard'],
  ['result', 'outcome', 'consequence', 'effect'],
  ['idea', 'concept', 'notion', 'thought'],
  ['problem', 'issue', 'trouble', 'difficulty'],
  ['method', 'way', 'approach', 'means', 'procedure'],
  ['change', 'alter', 'modify', 'transform', 'convert'],
  ['increase', 'expand', 'grow', 'extend', 'enlarge'],
  ['decrease', 'reduce', 'diminish', 'decline', 'shrink'],
  ['allow', 'permit', 'authorize'],
  ['forbid', 'prohibit', 'ban', 'restrict'],
  ['destroy', 'demolish', 'ruin', 'devastate'],
  ['protect', 'defend', 'guard', 'shield'],
  ['find', 'discover', 'detect', 'locate'],
  ['understand', 'comprehend', 'grasp', 'perceive'],
  ['explain', 'describe', 'clarify', 'illustrate'],
  ['ask', 'inquire', 'question', 'request'],
  ['say', 'tell', 'speak', 'state', 'mention'],
  ['strong', 'powerful', 'robust', 'sturdy'],
  ['weak', 'fragile', 'feeble', 'vulnerable'],
  ['beautiful', 'pretty', 'lovely', 'gorgeous'],
  ['difficult', 'hard', 'tough', 'complex', 'complicated'],
  ['easy', 'simple', 'straightforward'],
  ['rich', 'wealthy', 'affluent'],
  ['poor', 'needy'],
  ['old', 'ancient', 'aged'],
  ['new', 'modern', 'recent', 'fresh'],
  ['calm', 'quiet', 'peaceful', 'serene', 'mild', 'gentle'],
  ['brave', 'courageous', 'bold', 'fearless'],
  ['honest', 'sincere', 'truthful', 'candid'],
  ['tired', 'exhausted', 'weary'],
  ['famous', 'renowned', 'prominent', 'notable'],
  ['strange', 'odd', 'weird', 'peculiar'],
  ['whole', 'entire', 'total', 'complete'],
  ['often', 'frequently', 'usually'],
  ['rarely', 'seldom', 'occasionally'],
  ['almost', 'nearly', 'hardly', 'barely'],
  ['perhaps', 'maybe', 'probably', 'presumably'],
  ['therefore', 'consequently', 'accordingly', 'thus'],
  ['however', 'nevertheless', 'nonetheless'],
  ['agree', 'accept', 'approve', 'consent'],
  ['refuse', 'reject', 'decline', 'deny'],
  ['admit', 'acknowledge', 'confess'],
  ['praise', 'compliment', 'commend', 'extol'],
  ['blame', 'criticize', 'condemn', 'denounce', 'reproach'],
  ['worry', 'concern', 'anxiety'],
  ['happy', 'satisfied', 'content'],
  ['angry', 'indignant', 'irritated'],
  ['boundary', 'border', 'edge', 'limit'],
  ['area', 'region', 'zone', 'district', 'territory'],
  ['group', 'team', 'crowd', 'gathering'],
  ['leader', 'chief', 'head', 'boss'],
  ['aim', 'goal', 'objective', 'target', 'purpose'],
  ['plan', 'scheme', 'strategy', 'design'],
  ['rule', 'law', 'regulation', 'principle'],
  ['duty', 'obligation', 'responsibility'],
  ['chance', 'opportunity', 'possibility'],
  ['ability', 'capacity', 'capability', 'skill', 'competence'],
  ['effort', 'attempt', 'endeavor'],
  ['fix', 'repair', 'mend', 'restore'],
  ['clean', 'wash', 'cleanse'],
  ['throw', 'toss', 'hurl'],
  ['pull', 'drag', 'draw'],
  ['push', 'shove', 'press'],
  ['jump', 'leap', 'hop'],
  ['run', 'dash', 'sprint'],
  ['walk', 'stroll', 'wander'],
  ['shout', 'yell', 'scream'],
  ['whisper', 'murmur', 'mutter'],
  ['laugh', 'giggle', 'chuckle'],
  ['cry', 'weep', 'sob'],
  ['clock', 'watch'],
  ['test', 'exam', 'quiz'],
  ['class', 'lesson', 'course'],
  ['nutrition', 'nutrient', 'nourishment'],
  ['dish', 'cuisine', 'meal'],
  ['time', 'hour', 'moment'],
  ['assume', 'presume', 'postulate', 'suppose'],
  ['prove', 'verify', 'validate', 'confirm', 'certify', 'substantiate']
];

/* ── 監査本体 ─────────────────────────────────────────────────────── */
global.window = {};
require('../vocab.js');
require('../vocab-ext.js');
var RAW = window.VOCAB_RAW;

var stats = { total: RAW.length, corrected: 0, quarantined: 0, groups: 0, grouped: 0 };
var byWord = {};
RAW.forEach(function (e) { byWord[String(e[0]).toLowerCase()] = e; });

// 1) 修正の適用（存在しない語は報告）
var missingCorrections = [];
Object.keys(CORRECTIONS).forEach(function (w) {
  var e = byWord[w];
  if (!e) { missingCorrections.push(w); return; }
  if (e[1] !== CORRECTIONS[w]) { e[1] = CORRECTIONS[w]; stats.corrected++; }
});

// 2) 隔離（存在しない語は報告）
var missingQuarantine = [];
var quarantined = {};
Object.keys(QUARANTINE).forEach(function (w) {
  if (!byWord[w]) { missingQuarantine.push(w); return; }
  quarantined[w] = QUARANTINE[w];
  stats.quarantined++;
});

// 3) 混同グループ（union-find）
var parent = {};
function find(x) { if (parent[x] === undefined) parent[x] = x; return parent[x] === x ? x : (parent[x] = find(parent[x])); }
function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

// 3a) 手当てした種
CONFUSABLE_SEED.forEach(function (g) {
  var present = g.filter(function (w) { return byWord[w]; });
  for (var i = 1; i < present.length; i++) union(present[0], present[i]);
});

// 3b) 自動検出（訳の核が一致・包含・漢字核一致）
function core(ja) {
  return ja.replace(/(する|される|させる)$/, '')
    .replace(/(な|の|い|に|く|と|て|り|る|た|だ)$/, '')
    .replace(/[のがをにへとでもは、。・（）()〜]/g, '');
}
function kanji(s) { return (s.match(/[一-鿿]/g) || []).join(''); }
var autoPairs = 0;
var list = RAW.map(function (e) { return { w: String(e[0]).toLowerCase(), ja: e[1], pos: e[2], lvl: e[3] }; });
for (var i = 0; i < list.length; i++) {
  for (var j = i + 1; j < list.length; j++) {
    var A = list[i], B = list[j];
    if (A.pos !== B.pos) continue;
    if (Math.abs(A.lvl - B.lvl) > 2) continue;
    var ca = core(A.ja), cb = core(B.ja);
    if (!ca || !cb) continue;
    var same = (ca === cb);
    var sub = (ca.length >= 2 && cb.length >= 2 && (ca.indexOf(cb) >= 0 || cb.indexOf(ca) >= 0));
    var ka = kanji(ca), kb = kanji(cb);
    var kEq = (ka.length >= 2 && ka === kb);
    if (same || sub || kEq) { union(A.w, B.w); autoPairs++; }
  }
}

// グループ番号を採番（2語以上のグループのみ）
var members = {};
Object.keys(parent).forEach(function (w) { var r = find(w); (members[r] = members[r] || []).push(w); });
var groups = {}, gid = 0;
Object.keys(members).forEach(function (r) {
  if (members[r].length < 2) return;
  gid++;
  members[r].forEach(function (w) { groups[w] = 'g' + gid; });
});
stats.groups = gid;
stats.grouped = Object.keys(groups).length;

/* ── 出力 ─────────────────────────────────────────────────────────── */
console.log('=== 語彙 意味品質監査 ===');
console.log('総語数: ' + stats.total);
console.log('訳を修正: ' + stats.corrected);
console.log('隔離: ' + stats.quarantined);
console.log('自動検出ペア: ' + autoPairs);
console.log('混同グループ: ' + stats.groups + ' 個 / 所属語 ' + stats.grouped);
console.log('承認（出題対象）: ' + (stats.total - stats.quarantined));
if (missingCorrections.length) console.log('\n[警告] 存在しない修正対象: ' + missingCorrections.join(', '));
if (missingQuarantine.length) console.log('\n[警告] 存在しない隔離対象: ' + missingQuarantine.join(', '));

if (process.argv.indexOf('--write') >= 0) {
  var fs = require('fs');
  var out = '/* WORD QUEST RUN — 語彙品質オーバーレイ（自動生成 / tools/audit-vocab.js）\n' +
    '   手で編集しない。修正・隔離・混同グループの決定は tools/audit-vocab.js を編集して再生成する。\n' +
    '   生成日時: ' + new Date().toISOString() + '\n' +
    '   承認 ' + (stats.total - stats.quarantined) + ' / 隔離 ' + stats.quarantined +
    ' / 混同グループ ' + stats.groups + ' */\n' +
    'window.VOCAB_QUALITY = {\n' +
    '  corrections: ' + JSON.stringify(CORRECTIONS) + ',\n' +
    '  quarantine: ' + JSON.stringify(quarantined) + ',\n' +
    '  groups: ' + JSON.stringify(groups) + '\n' +
    '};\n';
  fs.writeFileSync(__dirname + '/../vocab-quality.js', out);
  console.log('\nvocab-quality.js を書き出しました (' + out.length + ' bytes)');
}
