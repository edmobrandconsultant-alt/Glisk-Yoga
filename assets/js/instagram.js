/* Instagram posts, loaded only when someone asks for one.
 *
 * The official embed pulls a script from Meta and sets cookies, which would
 * oblige the whole site to carry a cookie banner under PECR. So nothing is
 * requested from Instagram until a visitor clicks — the page ships with plain
 * cards, and the real embed replaces one only on demand. A visitor who never
 * clicks is never tracked, and the site keeps its cookie-free character.
 */
(function () {
  'use strict';

  var SCRIPT = 'https://www.instagram.com/embed.js';
  var scriptState = 'idle'; // idle | loading | ready | failed
  var waiting = [];

  function process() {
    if (window.instgrm && window.instgrm.Embeds) window.instgrm.Embeds.process();
  }

  function ensureScript(onReady, onFail) {
    if (scriptState === 'ready') return onReady();
    if (scriptState === 'failed') return onFail();
    waiting.push({ ok: onReady, fail: onFail });
    if (scriptState === 'loading') return;

    scriptState = 'loading';
    var s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = function () {
      scriptState = 'ready';
      waiting.splice(0).forEach(function (w) { w.ok(); });
    };
    s.onerror = function () {
      scriptState = 'failed';
      waiting.splice(0).forEach(function (w) { w.fail(); });
    };
    document.body.appendChild(s);
  }

  function load(card) {
    var url = card.getAttribute('data-ig');
    if (!url) return;

    var status = document.createElement('p');
    status.className = 'muted-line';
    status.setAttribute('role', 'status');
    status.textContent = 'Loading from Instagram…';

    var quote = document.createElement('blockquote');
    quote.className = 'instagram-media';
    quote.setAttribute('data-instgrm-permalink', url);
    quote.setAttribute('data-instgrm-version', '14');

    card.classList.add('is-loaded');
    card.replaceChildren(status, quote);

    ensureScript(
      function () { status.remove(); process(); },
      function () {
        // Instagram blocked, offline, or a content blocker did its job. Say so
        // plainly and hand over a link that always works.
        card.classList.remove('is-loaded');
        card.replaceChildren();
        var p = document.createElement('p');
        p.className = 'muted-line';
        p.innerHTML = 'Instagram could not be reached. <a href="' + url + '" rel="noopener">Open the post on Instagram</a> instead.';
        card.appendChild(p);
      }
    );
  }

  document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-ig-load]');
    if (!btn) return;
    event.preventDefault();
    var card = btn.closest('[data-ig]');
    if (card) load(card);
  });

  var all = document.querySelector('[data-ig-load-all]');
  if (all) {
    all.addEventListener('click', function () {
      all.remove();
      document.querySelectorAll('[data-ig]:not(.is-loaded)').forEach(load);
    });
  }
})();
