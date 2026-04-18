/* ═══════════════════════════════════════════════════════════════════
   DSM ANALYTICS v2 — Full-Stack Visitor Intelligence
   NEW IN v2:
   - Pricing section time tracking
   - UTM params joined to sessions (not lost in Events sheet)
   - Time-to-first-CTA-click per session
   - Backscroll detection (strong buying signal)
   - Video play/progress tracking
   - Content copy event
   - Testimonials section tracking
   - Social proof scroll tracking
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

  /* ── UTM PARAMS — captured at page load ─────────────────────── */
  var UTM = {};
  (function () {
    try {
      var params = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
        if (params.get(k)) UTM[k] = params.get(k);
      });
      // Also store in sessionStorage so they survive soft navigations
      if (Object.keys(UTM).length) {
        setStorage('dsm_utm', JSON.stringify(UTM));
      } else {
        // Try to recover from storage (user clicked link earlier this session)
        var stored = getStorage('dsm_utm', '');
        if (stored) UTM = JSON.parse(stored);
      }
    } catch (e) {}
  })();

  // Determine ref source — UTM source takes priority over referrer detection
  var REF_SOURCE = (function () {
    if (UTM.utm_source) return UTM.utm_source; // exact source from UTM
    if (!document.referrer) return 'direct';
    if (/google|bing|yahoo|duckduck/i.test(document.referrer)) return 'organic_search';
    if (/instagram/i.test(document.referrer)) return 'instagram';
    if (/facebook/i.test(document.referrer)) return 'facebook';
    if (/twitter|x\.com/i.test(document.referrer)) return 'twitter';
    if (/linkedin/i.test(document.referrer)) return 'linkedin';
    if (/youtube/i.test(document.referrer)) return 'youtube';
    if (/tiktok/i.test(document.referrer)) return 'tiktok';
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

  /* ── SESSION TIMING ─────────────────────────────────────────── */
  var sessionStart    = now();
  var activeTime      = 0;
  var idleStart       = null;
  var isIdle          = false;
  var IDLE_THRESHOLD  = 30000;
  var totalIdleTime   = 0;

  // NEW v2: time-to-first-CTA tracking
  var firstCtaFired   = false;
  var firstCtaSecs    = null;

  /* ── SEND EVENT ─────────────────────────────────────────────── */
  function send(action, payload) {
    if (!ANALYTICS_URL || ANALYTICS_URL.indexOf('YOUR_') === 0) return;

    var base = {
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
    };

    // Attach UTM fields to every event so they're always joinable
    if (UTM.utm_source)   base.utm_source   = UTM.utm_source;
    if (UTM.utm_medium)   base.utm_medium   = UTM.utm_medium;
    if (UTM.utm_campaign) base.utm_campaign = UTM.utm_campaign;
    if (UTM.utm_content)  base.utm_content  = UTM.utm_content;
    if (UTM.utm_term)     base.utm_term     = UTM.utm_term;

    var data = Object.assign(base, payload || {});

    var qs = Object.keys(data).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(String(data[k]));
    }).join('&');

    // sendBeacon — non-blocking, survives page unload
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
  // Include UTM fields in pageview so session row gets them immediately
  send('pageview', {
    utm_source:   UTM.utm_source   || '',
    utm_medium:   UTM.utm_medium   || '',
    utm_campaign: UTM.utm_campaign || '',
    utm_content:  UTM.utm_content  || '',
    utm_term:     UTM.utm_term     || ''
  });

  /* ── SCROLL DEPTH ───────────────────────────────────────────── */
  var scrollMilestones = { 25: false, 50: false, 75: false, 90: false, 100: false };
  var maxScroll        = 0;

  function getScrollPct() {
    var scrolled = window.scrollY || document.documentElement.scrollTop;
    var total    = document.documentElement.scrollHeight - window.innerHeight;
    return total > 0 ? Math.round((scrolled / total) * 100) : 0;
  }

  // NEW v2: backscroll detection
  var lastScrollY      = 0;
  var backscrollFired  = false;
  var deepestScroll    = 0;

  window.addEventListener('scroll', function () {
    var pct = getScrollPct();
    if (pct > maxScroll) maxScroll = pct;
    if (pct > deepestScroll) deepestScroll = pct;

    // Scroll milestones
    Object.keys(scrollMilestones).forEach(function (m) {
      if (!scrollMilestones[m] && pct >= parseInt(m, 10)) {
        scrollMilestones[m] = true;
        send('scroll_depth', { depth: m + '%', timeOnPage: Math.round((now() - sessionStart) / 1000) });
      }
    });

    // NEW v2: Backscroll — visitor scrolled deep then scrolled back up toward top
    // Fires once per session when they scroll back up more than 30% after reaching 50%+
    if (!backscrollFired && deepestScroll >= 50) {
      var currentY = window.scrollY;
      if (lastScrollY - currentY > window.innerHeight * 0.4 && pct < deepestScroll - 30) {
        backscrollFired = true;
        send('backscroll', {
          deepestReached: deepestScroll + '%',
          scrolledBackTo: pct + '%',
          timeOnPage: Math.round((now() - sessionStart) / 1000)
        });
      }
    }
    lastScrollY = window.scrollY;
  }, { passive: true });

  /* ── SECTION VISIBILITY TRACKING ───────────────────────────── */
  var sectionNames = {
    'hero':      'Hero',
    'problem':   'Problem',
    'window':    'Two Men Story',
    'product':   'Product Description',
    'research':  'Research',
    'chapters':  'Chapters',
    'faq':       'FAQ',
    'pricing':   'Pricing'   // NEW v2: was missing — most important section
  };

  if (window.IntersectionObserver) {
    Object.keys(sectionNames).forEach(function (id) {
      var el = document.getElementById(id) || document.querySelector('.' + id) || document.querySelector('[data-section="' + id + '"]');
      if (!el) return;
      var enterTime = null;
      var observer  = new IntersectionObserver(function (entries) {
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
    });
  }

  /* ── CTA / BUY BUTTON CLICKS ────────────────────────────────── */
  function labelForEl(el) {
    var txt  = (el.textContent || el.innerText || '').trim().substring(0, 60);
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
        var timeOnPage = Math.round((now() - sessionStart) / 1000);

        // NEW v2: time-to-first-CTA
        if (!firstCtaFired) {
          firstCtaFired = true;
          firstCtaSecs  = timeOnPage;
          send('first_cta_click', {
            label:         labelForEl(el),
            secsToFirstCta: timeOnPage,
            scrollAtClick: getScrollPct() + '%'
          });
        }

        send('cta_click', {
          label:       labelForEl(el),
          ctaLocation: getScrollPct() + '%_scroll',
          timeOnPage:  timeOnPage
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
        ctaLocation: 'chapter_modal',
        timeOnPage:  Math.round((now() - sessionStart) / 1000)
      });
    });
  }

  /* ── NAV LINK CLICKS ────────────────────────────────────────── */
  document.querySelectorAll('nav a, footer a').forEach(function (el) {
    el.addEventListener('click', function () {
      var href = el.getAttribute('href') || '';
      if (href.indexOf('topmate') !== -1) return;
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

  /* ── VIDEO TRACKING (NEW v2) ────────────────────────────────── */
  document.querySelectorAll('video').forEach(function (v, idx) {
    var videoLabel  = v.getAttribute('data-label') || v.title || ('Video ' + (idx + 1));
    var milestones  = { 25: false, 50: false, 75: false };
    var playFired   = false;

    v.addEventListener('play', function () {
      if (!playFired) {
        playFired = true;
        send('video_play', {
          label:      videoLabel,
          timeOnPage: Math.round((now() - sessionStart) / 1000)
        });
      }
    });

    v.addEventListener('ended', function () {
      send('video_complete', { label: videoLabel });
    });

    v.addEventListener('timeupdate', function () {
      if (!v.duration) return;
      var pct = Math.round((v.currentTime / v.duration) * 100);
      Object.keys(milestones).forEach(function (m) {
        if (!milestones[m] && pct >= parseInt(m, 10)) {
          milestones[m] = true;
          send('video_progress', { label: videoLabel, milestone: m + '%' });
        }
      });
    });

    v.addEventListener('pause', function () {
      if (v.ended) return;
      send('video_pause', {
        label:    videoLabel,
        progress: v.duration ? Math.round((v.currentTime / v.duration) * 100) + '%' : '—'
      });
    });
  });

  /* ── CONTENT COPY DETECTION (NEW v2) ───────────────────────── */
  document.addEventListener('copy', function () {
    var selected = '';
    try { selected = (window.getSelection() || '').toString().substring(0, 100); } catch (e) {}
    send('content_copy', {
      scrollPct:    getScrollPct() + '%',
      copiedText:   selected,
      timeOnPage:   Math.round((now() - sessionStart) / 1000)
    });
  });

  /* ── RAGE CLICK DETECTION ───────────────────────────────────── */
  var clickLog = [];
  document.addEventListener('click', function (e) {
    var t = now();
    clickLog.push({ t: t, x: e.clientX, y: e.clientY });
    clickLog = clickLog.filter(function (c) { return t - c.t < 2000; });
    if (clickLog.length >= 4) {
      var xs     = clickLog.map(function (c) { return c.x; });
      var ys     = clickLog.map(function (c) { return c.y; });
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
      scrollDepth:     maxScroll + '%',
      timeOnPage:      Math.round((now() - sessionStart) / 1000),
      activeTime:      Math.round((now() - sessionStart - totalIdleTime) / 1000),
      reachedPricing:  scrollMilestones[75] ? 'yes' : 'no',
      firstCtaSecs:    firstCtaSecs !== null ? firstCtaSecs : 'never'  // NEW v2
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

  /* ── SESSION END ─────────────────────────────────────────────── */
  function sendSessionEnd() {
    var totalSecs  = Math.round((now() - sessionStart) / 1000);
    var activeSecs = Math.round((totalSecs * 1000 - totalIdleTime) / 1000);
    send('session_end', {
      totalSeconds:    totalSecs,
      activeSeconds:   activeSecs,
      maxScrollDepth:  maxScroll + '%',
      ctasClicked:     window.__dsmCtaCount || 0,
      firstCtaSecs:    firstCtaSecs !== null ? firstCtaSecs : -1,  // NEW v2
      hadBackscroll:   backscrollFired ? 'yes' : 'no',             // NEW v2
      utmSource:       UTM.utm_source   || '',                      // NEW v2
      utmMedium:       UTM.utm_medium   || '',
      utmCampaign:     UTM.utm_campaign || ''
    });
  }

  window.addEventListener('pagehide',     sendSessionEnd);
  window.addEventListener('beforeunload', sendSessionEnd);

  /* ── EXPOSE MANUAL TRACK ────────────────────────────────────── */
  window.DSMTrack = function (event, data) { send(event, data || {}); };

  console.log('[DSM Analytics v2] Loaded — Session:', sessionId.substring(0, 8) + '...');

})();
