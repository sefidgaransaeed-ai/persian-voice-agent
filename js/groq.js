/* کلاینت Groq — رونویسی صدا با مدل Whisper.
   چرا این و نه سرویس گفتار مرورگر: Web Speech روی این شبکه اصلاً وصل نمی‌شود
   (هر دو زبان، بلافاصله، خطای network). Groq در دسترس است، سطح رایگان واقعی
   دارد و Whisper فارسی را به‌خوبی می‌فهمد.

   برخلاف OpenRouter اینجا base64 لازم نیست: فایل مستقیم با multipart می‌رود. */
(function (App) {
  'use strict';

  var ENDPOINT = 'https://api.groq.com/openai/v1';
  var lastCall = 0;
  var GUARD_MS = 350;

  // یک منبع حقیقت در config؛ store هم برای اعتبارسنجی از همان می‌خواند
  var MODELS = App.config.GROQ_MODELS;

  function friendlyError(status, body) {
    var msg = (body && body.error && body.error.message) || '';
    if (status === 401) return 'کلید Groq پذیرفته نشد. در تنظیمات کلید درست را وارد کنید.';
    // ۴۰۳ اینجا تقریباً همیشه یعنی کشورِ آی‌پی، نه کلید. با تعویض گرهٔ VPN
    // (مثلاً از آذربایجان به آلمان) درست می‌شود — این را واقعاً دیدیم.
    if (status === 403) return 'Groq از کشورِ آی‌پی فعلی شما سرویس نمی‌دهد. ' +
                              'گرهٔ VPN را روی آلمان یا کشوری در اروپای غربی / آمریکا بگذارید.';
    if (status === 404) return 'این مدل در Groq وجود ندارد. در تنظیمات یکی از مدل‌های فهرست را انتخاب کنید.';
    if (status === 413) return 'فایل صوتی بزرگ‌تر از سقف مجاز است. طول تکه‌ها را در تنظیمات کم کنید.';
    if (status === 429) return 'به سقف درخواست Groq رسیدید. کمی صبر کنید.';
    if (status === 400 && /language/i.test(msg)) return 'کد زبان پذیرفته نشد.';
    return 'خطای Groq' + (status ? ' (' + status + ')' : '') + (msg ? ': ' + msg : '');
  }

  function throttle() {
    var wait = Math.max(0, GUARD_MS - (Date.now() - lastCall));
    return App.sleep(wait).then(function () { lastCall = Date.now(); });
  }

  /* blob → متن.
     opts: { key, model, language, prompt, onNotice } */
  function transcribeBlob(blob, opts) {
    opts = opts || {};
    if (!opts.key) return Promise.reject(new Error('کلید Groq وارد نشده است.'));

    var form = new FormData();
    // نام فایل مهم است: Groq پسوند را برای تشخیص قالب می‌خواند
    form.append('file', blob, opts.filename || 'audio.wav');
    form.append('model', opts.model || MODELS[0].id);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    // گفتن صریح زبان، دقت فارسی را بالا می‌برد و جلوی ترجمهٔ ناخواسته را می‌گیرد
    if (opts.language !== 'auto') form.append('language', opts.language || 'fa');
    if (opts.prompt) form.append('prompt', opts.prompt);

    return throttle().then(function () {
      return fetch(ENDPOINT + '/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + opts.key },
        body: form
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
        return ((body && body.text) || '').trim();
      });
    }, function (netErr) {
      if (netErr && netErr.status) throw netErr;
      throw new Error('اتصال به Groq برقرار نشد. اینترنت یا VPN را بررسی کنید.');
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

  /* پرامپت جهت‌دهی می‌سازد — عمداً محافظه‌کارانه.
     هرچه اینجا برود، Whisper ممکن است روی صدای ضعیف عیناً ادامه‌اش بدهد و
     متنی بسازد که کاربر نگفته. پس پیش‌فرض فقط واژه‌نامه است: فهرست اسم، نه
     جملهٔ قابل ادامه دادن. بافتِ متن قبلی فقط اگر کاربر صریحاً بخواهد. */
  function buildPrompt(previousText, glossary, useContext) {
    var cfg = App.config;
    var parts = [];
    if (glossary && glossary.trim()) parts.push(glossary.trim());

    if (useContext) {
      var tail = String(previousText || '').trim();
      if (tail) {
        var room = cfg.PROMPT_MAX_CHARS - parts.join(' ').length - 1;
        if (room > 40) parts.push(tail.slice(-room));
      }
    }
    return parts.join(' ').slice(-cfg.PROMPT_MAX_CHARS);
  }

  /* نگهبان توهم: اگر خروجی چیزی جز بازگفتِ پرامپت نباشد، دور انداخته می‌شود.
     نشانهٔ همان حالتی است که مدل به‌جای شنیدن، متن ورودی را ادامه داده. */
  function echoesPrompt(text, prompt) {
    if (!text || !prompt) return false;
    var norm = function (s) { return s.replace(/[\s‌.،,؛:!?]+/g, ' ').trim(); };
    var t = norm(text), p = norm(prompt);
    if (!t) return false;
    if (p.indexOf(t) !== -1 && t.length > 8) return true;
    // تکرار یک عبارت پشت سر هم، الگوی کلاسیک توهم روی سکوت است
    var w = t.split(' ');
    if (w.length >= 6) {
      var uniq = {};
      w.forEach(function (x) { uniq[x] = 1; });
      if (Object.keys(uniq).length <= Math.ceil(w.length / 4)) return true;
    }
    return false;
  }

  App.groq = {
    MODELS: MODELS,
    buildPrompt: buildPrompt,

    echoesPrompt: echoesPrompt,

    transcribe: function (blob, opts) {
      opts = opts || {};
      return withRetry(function () { return transcribeBlob(blob, opts); }, opts.onNotice)
        .then(function (text) {
          // بهتر است چیزی ننویسیم تا اینکه جمله‌ای بنویسیم که گفته نشده
          return echoesPrompt(text, opts.prompt) ? '' : text;
        });
    },

    // بررسی درستی کلید بدون مصرف سهمیهٔ صوتی
    checkKey: function (key) {
      return fetch(ENDPOINT + '/models', {
        headers: { 'Authorization': 'Bearer ' + key }
      }).then(function (r) {
        if (!r.ok) throw new Error(friendlyError(r.status, null));
        return r.json();
      }).then(function (j) {
        var ids = (j.data || []).map(function (m) { return m.id; });
        return {
          ok: true,
          total: ids.length,
          // فقط مدل‌هایی که واقعاً صدا می‌گیرند
          audio: ids.filter(function (id) { return /whisper/i.test(id); })
        };
      });
    }
  };

})(window.App = window.App || {});
