/* کلاینت Deepgram — موتور تبدیل گفتار به متن.
   چرا این و نه Whisper: روی همان ۱۰ دقیقه گفتار فارسی سنجیده شد. Whisper
   «آذربایجان» را «آزبای جان»، «کیلومتر» را «کلومتر» و «افزوده» را «افسوده»
   می‌نوشت و اصلاً نقطه‌گذاری نداشت. Deepgram هر سه را درست نوشت، جمله‌ها را
   نقطه‌گذاری کرد و اعداد را خوانا درآورد. AssemblyAI تقریباً هم‌سطح Whisper بود.

   از نظر فنی هم ساده‌تر است: بدنهٔ خام صوتی، بدون multipart و بدون base64. */
(function (App) {
  'use strict';

  var ENDPOINT = 'https://api.deepgram.com/v1';
  var lastCall = 0;
  var GUARD_MS = 250;

  var MODELS = App.config.DG_MODELS;

  function friendlyError(status, body) {
    var msg = (body && (body.err_msg || body.message || body.reason)) || '';
    if (status === 401) return 'کلید Deepgram پذیرفته نشد. در تنظیمات کلید درست را وارد کنید.';
    if (status === 402 || status === 403) {
      return 'Deepgram درخواست را رد کرد. اعتبار حساب تمام شده یا کشورِ آی‌پی پشتیبانی نمی‌شود ' +
             '— گرهٔ VPN را روی آلمان بگذارید.';
    }
    if (status === 413) return 'فایل صوتی بزرگ‌تر از سقف مجاز است. طول تکه‌ها را کم کنید.';
    if (status === 429) return 'به سقف درخواست Deepgram رسیدید. کمی صبر کنید.';
    if (status === 400 && /model|language/i.test(msg)) {
      return 'ترکیب مدل و زبان پذیرفته نشد: ' + msg;
    }
    return 'خطای Deepgram' + (status ? ' (' + status + ')' : '') + (msg ? ': ' + msg : '');
  }

  function throttle() {
    var wait = Math.max(0, GUARD_MS - (Date.now() - lastCall));
    return App.sleep(wait).then(function () { lastCall = Date.now(); });
  }

  /* واژه‌نامه → پارامتر keyterm.
     برخلاف prompt در Whisper، این فهرست اصطلاح است و مدل هرگز «ادامه‌اش» را
     نمی‌نویسد. برای همین خطر ساختن متنِ نگفته را ندارد. */
  function keytermParams(glossary) {
    if (!glossary) return '';
    return glossary.split(/[،,\n]+/)
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 1 && t.length < 60; })
      .slice(0, 40)
      .map(function (t) { return '&keyterm=' + encodeURIComponent(t); })
      .join('');
  }

  function buildUrl(opts) {
    var p = [
      'model=' + encodeURIComponent(opts.model || App.config.DG_MODEL),
      'punctuate=true',
      'smart_format=true'
    ];
    if (opts.language && opts.language !== 'auto') {
      p.push('language=' + encodeURIComponent(opts.language));
    } else {
      p.push('detect_language=true');
    }
    return ENDPOINT + '/listen?' + p.join('&') + keytermParams(opts.glossary);
  }

  function textOf(body) {
    try {
      var alt = body.results.channels[0].alternatives[0];
      return String(alt.transcript || '').trim();
    } catch (e) { return ''; }
  }

  function send(blob, opts) {
    if (!opts.key) return Promise.reject(new Error('کلید Deepgram وارد نشده است.'));

    return throttle().then(function () {
      return fetch(buildUrl(opts), {
        method: 'POST',
        headers: {
          'Authorization': 'Token ' + opts.key,
          'Content-Type': blob.type || 'audio/wav'
        },
        body: blob
      });
    }).then(function (res) {
      return res.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { /* JSON نبود */ }
        if (!res.ok) {
          var err = new Error(friendlyError(res.status, body));
          err.status = res.status;
          err.retryAfter = Number(res.headers.get('Retry-After')) || 0;
          throw err;
        }
        return textOf(body);
      });
    }, function (netErr) {
      if (netErr && netErr.status) throw netErr;
      throw new Error('اتصال به Deepgram برقرار نشد. اینترنت یا VPN را بررسی کنید.');
    });
  }

  function withRetry(fn, onNotice, max) {
    var attempt = 0;
    function go() {
      return fn().catch(function (e) {
        var transient = e.status === 429 || e.status === 500 || e.status === 502 ||
                        e.status === 503 || !e.status;
        if (!transient || attempt >= (max || 4)) throw e;
        attempt++;
        var wait = e.retryAfter ? e.retryAfter * 1000 : Math.min(30000, 1500 * Math.pow(2, attempt));
        if (onNotice) onNotice('تلاش دوبارهٔ ' + App.fmt.fa(attempt) + ' پس از ' +
          App.fmt.fa(Math.round(wait / 1000)) + ' ثانیه…');
        return App.sleep(wait).then(go);
      });
    }
    return go();
  }

  App.dg = {
    MODELS: MODELS,

    transcribe: function (blob, opts) {
      opts = opts || {};
      return withRetry(function () { return send(blob, opts); }, opts.onNotice);
    },

    // بررسی کلید بدون مصرف اعتبار صوتی
    checkKey: function (key) {
      return fetch(ENDPOINT + '/projects', {
        headers: { 'Authorization': 'Token ' + key }
      }).then(function (r) {
        if (!r.ok) throw new Error(friendlyError(r.status, null));
        return r.json();
      }).then(function (j) {
        var ps = j.projects || [];
        return { ok: true, projects: ps.length, name: ps.length ? ps[0].name : '' };
      });
    }
  };

})(window.App = window.App || {});
