/* ═══════════════════════════════════════════════════════════════════
   DSM ANALYTICS — Full-Stack Visitor Intelligence
   Tracks: sessions, scroll depth, section time, CTA clicks,
           exit intent, rage clicks, idle, device, referrer
   Sends to: Google Apps Script Web App → Google Sheets
   Drop this script at the END of <body> on every page.
   Set ANALYTICS_URL below after deploying your Apps Script.
═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── CONFIG ── set this after deploying the Apps Script ──────────
  var ANALYTICS_URL = 'https://script.google.com/macros/s/AKfycbx9IMP9hrapIEaLWZXMTaPbxNeZeuazQEB1DjJe_eSxN8kmLez_pyHn5zxidHqt8UkE/exec';
  var SITE_NAME     = 'persuasionacademybyra.com';
  // ────────────────────────────────────────────────────────────────

  if (!ANALYTICS_URL || ANALYTICS_URL.indexOf('YOUR_') === 0) {
    console.warn('[DSM Analytics] URL not configured. Set ANALYTICS_URL in analytics.js');
    return;
  }

  /* ── UTILITIES ─────────────────────────────────────────────── */
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function now() { return Date.now(); }

  function getStorage(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  function setStorage(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|;)\\s*' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function setCookie(name, val, days) {
    var exp = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(val) + '; expires=' + exp + '; path=/; SameSite=Lax';
  }

  /* ── SESSION / VISITOR IDs ──────────────────────────────────── */
  var visitorId = getCookie('dsm_vid');
  if (!visitorId) {
    visitorId = uuid();
    setCookie('dsm_vid', visitorId, 365);
  }

  var sessionId  = getStorage('dsm_sid', '');
  var sessionAge = parseInt(getStorage('dsm_sid_ts', '0'), 10);
  if (!sessionId || (now() - sessionAge) > 30 * 60 * 1000) {
    sessionId = uuid();
    setStorage('dsm_sid', sessionId);
  }
  setStorage('dsm_sid_ts', String(now()));

  var isNewVisitor = !getCookie('dsm_ret');
  setCookie('dsm_ret', '1', 365);

  var visitCount = parseInt(getCookie('dsm_vc') || '0', 10) + 1;
  setCookie('dsm_vc', String(visitCount), 365);

  /* ── PAGE INFO ──────────────────────────────────────────────── */
  var PAGE      = window.location.pathname.replace(/\/$/, '') || '/';
  var PAGE_NAME = PAGE === '/' || PAGE.indexOf('index') !== -1 ? 'Sales Page' : 'Research Page';
  var REFERRER  = document.referrer || 'direct';
  var REF_SOURCE = (function () {
    if (!document.referrer) return 'direct';
    if (/google|bing|yahoo|duckduck/i.test(document.referrer)) return 'organic_search';
    if (/instagram|facebook|twitter|linkedin|youtube|tiktok/i.test(document.referrer)) return 'social';
    if (/topmate/i.test(document.referrer)) return 'topmate';
    return 'referral';
  })();

  /* ── DEVICE INFO ────────────────────────────────────────────── */
  var UA     = navigator.userAgent;
  var DEVICE = /Mobi|Android/i.test(UA) ? 'mobile' : /iPad|Tablet/i.test(UA) ? 'tablet' : 'desktop';
  var OS     = /Windows/i.test(UA) ? 'Windows' : /Mac/i.test(UA) ? 'Mac' : /iPhone|iPad/i.test(UA) ? 'iOS' : /Android/i.test(UA) ? 'Android' : /Linux/i.test(UA) ? 'Linux' : 'Other';
  var BROWSER = /Chrome/i.test(UA) && !/Edge|OPR/i.test(UA) ? 'Chrome' : /Firefox/i.test(UA) ? 'Firefox' : /Safari/i.test(UA) && !/Chrome/i.test(UA) ? 'Safari' : /Edge/i.test(UA) ? 'Edge' : 'Other';
  var SCREEN  = window.screen.width + 'x' + window.screen.height;
  var LANG    = navigator.language || 'unknown';

  /* ── SESSION START TIME ─────────────────────────────────────── */
  var sessionStart = now();
  var activeTime   = 0;
  var idleStart    = null;
  var isIdle       = false;
  var IDLE_THRESHOLD = 30000; // 30 seconds

  /* ── SEND EVENT ─────────────────────────────────────────────── */
  function send(action, payload) {
    if (!ANALYTICS_URL || ANALYTICS_URL.indexOf('YOUR_') === 0) return;
    var data = Object.assign({
      action:      action,
      sessionId:   sessionId,
      visitorId:   visitorId,
      page:        PAGE_NAME,
      pagePath:    PAGE,
      site:        SITE_NAME,
      ts:          new Date().toISOString(),
      device:      DEVICE,
      os:          OS,
      browser:     BROWSER,
      screen:      SCREEN,
      lang:        LANG,
      referrer:    REFERRER,
      refSource:   REF_SOURCE,
      isNew:       isNewVisitor ? 'yes' : 'no',
      visitCount:  visitCount
    }, payload || {});

    var qs = Object.keys(data).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(String(data[k]));
    }).join('&');

    // Use sendBeacon if available (non-blocking, survives page unload)
    if (navigator.sendBeacon) {
      try {
        var blob = new Blob([qs], { type: 'application/x-www-form-urlencoded' });
        navigator.sendBeacon(ANALYTICS_URL, blob);
        return;
      } catch (e) {}
    }

    // Fallback: JSONP
    var cbName = '__dsm_ac_' + now();
    window[cbName] = function () { delete window[cbName]; try { document.getElementById(cbName).remove(); } catch (e) {} };
    var s = document.createElement('script');
    s.id  = cbName;
    s.src = ANALYTICS_URL + '?' + qs + '&callback=' + cbName;
    document.head.appendChild(s);
    setTimeout(function () { try { s.remove(); } catch (e) {} delete window[cbName]; }, 5000);
  }

  /* ── PAGE VIEW ──────────────────────────────────────────────── */
  send('pageview', {});

  /* ── SCROLL DEPTH ───────────────────────────────────────────── */
  var scrollMilestones = { 25: false, 50: false, 75: false, 90: false, 100: false };
  var maxScroll = 0;

  function getScrollPct() {
    var scrolled = window.scrollY || document.documentElement.scrollTop;
    var total    = document.documentElement.scrollHeight - window.innerHeight;
    return total > 0 ? Math.round((scrolled / total) * 100) : 0;
  }

  window.addEventListener('scroll', function () {
    var pct = getScrollPct();
    if (pct > maxScroll) maxScroll = pct;
    Object.keys(scrollMilestones).forEach(function (m) {
      if (!scrollMilestones[m] && pct >= parseInt(m, 10)) {
        scrollMilestones[m] = true;
        send('scroll_depth', { depth: m + '%', timeOnPage: Math.round((now() - sessionStart) / 1000) });
      }
    });
  }, { passive: true });

  /* ── SECTION VISIBILITY TRACKING ───────────────────────────── */
  var sectionNames = {
    'hero':     'Hero',
    'problem':  'Problem',
    'window':   'Two Men Story',
    'product':  'Product Description',
    'research': 'Research',
    'chapters': 'Chapters',
    'faq':      'FAQ',
    'pricing':  'Pricing'
  };

  var sectionTimers = {};

  if (window.IntersectionObserver) {
    Object.keys(sectionNames).forEach(function (id) {
      var el = document.getElementById(id) || document.querySelector('.' + id);
      if (!el) return;
      var enterTime = null;
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            enterTime = now();
          } else if (enterTime) {
            var spent = Math.round((now() - enterTime) / 1000);
            if (spent >= 2) {
              send('section_time', { section: sectionNames[id], seconds: spent });
            }
            enterTime = null;
          }
        });
      }, { threshold: 0.3 });
      observer.observe(el);
      sectionTimers[id] = { el: el, observer: observer };
    });
  }

  /* ── CTA / BUY BUTTON CLICKS ────────────────────────────────── */
  function labelForEl(el) {
    var txt = (el.textContent || el.innerText || '').trim().substring(0, 60);
    var href = el.href || '';
    if (href.indexOf('topmate') !== -1) return 'Buy — ' + txt;
    if (href.indexOf('pricing') !== -1) return 'Nav — Get Access';
    return txt || 'Unknown CTA';
  }

  var BUY_SELECTORS = [
    'a[href*="topmate"]',
    '.btn-primary',
    '.btn-primary-large',
    '.nav-cta',
    '.modal-cta',
    '.preview-cta',
    '.footer-cta-strip a',
    '#floatingCTA a'
  ];

  BUY_SELECTORS.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el) {
      el.addEventListener('click', function () {
        send('cta_click', {
          label:       labelForEl(el),
          ctaLocation: getScrollPct() + '%_scroll',
          timeOnPage:  Math.round((now() - sessionStart) / 1000)
        });
      });
    });
  });

  /* Chapter modal CTA */
  var modalCta = document.getElementById('modalCta');
  if (modalCta) {
    modalCta.addEventListener('click', function () {
      var chapter = document.getElementById('modalChapterNum');
      send('cta_click', {
        label:      'Modal CTA — ' + (chapter ? chapter.textContent : 'Chapter'),
        ctaLocation: 'chapter_modal'
      });
    });
  }

  /* ── NAV LINK CLICKS ────────────────────────────────────────── */
  document.querySelectorAll('nav a, footer a').forEach(function (el) {
    el.addEventListener('click', function () {
      var href = el.getAttribute('href') || '';
      if (href.indexOf('topmate') !== -1) return; // already tracked above
      send('nav_click', { label: (el.textContent || '').trim().substring(0, 40), target: href });
    });
  });

  /* ── FAQ INTERACTIONS ───────────────────────────────────────── */
  document.querySelectorAll('.faq-question').forEach(function (el) {
    el.addEventListener('click', function () {
      var question = (el.textContent || '').trim().substring(0, 80);
      send('faq_open', { question: question });
    });
  });

  /* ── CHAPTER CARD CLICKS ────────────────────────────────────── */
  document.querySelectorAll('.chapter-card').forEach(function (card, idx) {
    card.addEventListener('click', function () {
      var num   = card.querySelector('.chapter-num');
      var title = card.querySelector('.chapter-title');
      send('chapter_click', {
        chapter: (num ? num.textContent : 'Ch ' + (idx + 1)),
        title:   (title ? title.textContent : '').trim().substring(0, 60)
      });
    });
  });

  /* ── RAGE CLICK DETECTION ───────────────────────────────────── */
  var clickLog = [];
  document.addEventListener('click', function (e) {
    var t = now();
    clickLog.push({ t: t, x: e.clientX, y: e.clientY });
    clickLog = clickLog.filter(function (c) { return t - c.t < 2000; });
    if (clickLog.length >= 4) {
      var xs = clickLog.map(function (c) { return c.x; });
      var ys = clickLog.map(function (c) { return c.y; });
      var spread = Math.max.apply(null, xs) - Math.min.apply(null, xs) + Math.max.apply(null, ys) - Math.min.apply(null, ys);
      if (spread < 80) {
        send('rage_click', { x: Math.round(e.clientX), y: Math.round(e.clientY), clicks: clickLog.length });
        clickLog = [];
      }
    }
  });

  /* ── IDLE / ACTIVE DETECTION ────────────────────────────────── */
  var lastActivity = now();
  var idleTimer    = null;
  var totalIdleTime = 0;

  function onActivity() {
    if (isIdle) {
      totalIdleTime += now() - idleStart;
      isIdle = false;
      send('idle_end', { idleSecs: Math.round((now() - idleStart) / 1000) });
    }
    lastActivity = now();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      isIdle    = true;
      idleStart = now();
      send('idle_start', { activeSecsSoFar: Math.round((now() - sessionStart - totalIdleTime) / 1000) });
    }, IDLE_THRESHOLD);
  }

  ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
    document.addEventListener(ev, onActivity, { passive: true });
  });
  onActivity();

  /* ── EXIT INTENT ─────────────────────────────────────────────── */
  var exitFired = false;
  document.addEventListener('mouseleave', function (e) {
    if (exitFired || e.clientY > 20) return;
    exitFired = true;
    send('exit_intent', {
      scrollDepth:  maxScroll + '%',
      timeOnPage:   Math.round((now() - sessionStart) / 1000),
      activeTime:   Math.round((now() - sessionStart - totalIdleTime) / 1000),
      reachedPricing: scrollMilestones[75] ? 'yes' : 'no'
    });
  });

  /* ── TAB VISIBILITY ─────────────────────────────────────────── */
  var hiddenAt = null;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      hiddenAt = now();
      send('tab_hidden', { timeOnPage: Math.round((now() - sessionStart) / 1000) });
    } else if (hiddenAt) {
      var away = Math.round((now() - hiddenAt) / 1000);
      send('tab_return', { awaySeconds: away });
      hiddenAt = null;
    }
  });

  /* ── SESSION END (page unload) ───────────────────────────────── */
  function sendSessionEnd() {
    var totalSecs  = Math.round((now() - sessionStart) / 1000);
    var activeSecs = Math.round((totalSecs * 1000 - totalIdleTime) / 1000);
    send('session_end', {
      totalSeconds:   totalSecs,
      activeSeconds:  activeSecs,
      maxScrollDepth: maxScroll + '%',
      ctasClicked:    window.__dsmCtaCount || 0
    });
  }

  window.addEventListener('pagehide',   sendSessionEnd);
  window.addEventListener('beforeunload', sendSessionEnd);

  /* ── UTM PARAMS ─────────────────────────────────────────────── */
  (function () {
    var params = new URLSearchParams(window.location.search);
    var utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
      if (params.get(k)) utm[k] = params.get(k);
    });
    if (Object.keys(utm).length) {
      send('utm', utm);
    }
  })();

  /* ── EXPOSE MANUAL TRACK FOR COURSE PAGE ────────────────────── */
  window.DSMTrack = function (event, data) { send(event, data || {}); };

  console.log('[DSM Analytics] Loaded — Session:', sessionId.substring(0, 8) + '...');

})();
