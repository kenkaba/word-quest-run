/* WORD QUEST RUN — Service Worker
   キャッシュのバージョンは Ver 更新のたびに上げる（古いキャッシュは activate で削除）。
   方針: network-first（オンラインは常に最新、オフラインはキャッシュにフォールバック）。 */
var CACHE = 'wqr-v3.3.0';
var ASSETS = [
  './',
  './index.html',
  './vocab.js',
  './vocab-ext.js',
  './vocab-engine.js',
  './lumi-rig.js',
  './game.js',
  './assets/lumi.svg'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).catch(function () {}));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match('./index.html'); });
    })
  );
});
