/* کلاینت OpenRouter — تبدیل صوت به متن با content type به‌نام input_audio */
(function (App) {
  'use strict';

  var cfg = App.config;
  var lastCall = 0;

  function headers(key) {
    return {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      // OpenRouter این دو را برای شناسایی برنامه می‌خواهد؛ اجباری نیستند
      'HTTP-Referer': location.origin === 'null' ? 'https://localhost' : location.origin,
      'X-Title': 'Persian Voice Agent'
    };
  }

  function friendlyError(status, body) {
    var msg = (body && body.error && body.error.message) || '';
    if (status === 401) return 'کلید API پذیرفته نشد. در تنظیمات کلید درست را وارد کنید.';
    if (status === 402) return 'اعتبار حساب OpenRouter شما منفی است. حتی مدل‌های رایگان هم تا شارژ نشود کار نمی‌کنند.';
    if (status === 429) return 'به سقف درخواست رسیدید (۲۰ در دقیقه، ۵۰ در روز برای مدل‌های رایگان).';
    if (status === 404) return 'این مدل در دسترس نیست یا ورودی صوتی نمی‌پذیرد.';
    return 'خطای سرویس' + (status ? ' (' + status + ')' : '') + (msg ? ': ' + msg : '');
  }

  // فاصلهٔ حداقلی بین درخواست‌ها تا به سقف ۲۰ در دقیقه نخوریم
  function throttle() {
    var wait = Math.max(0, cfg.RPM_GUARD_MS - (Date.now() - lastCall));
    return App.sleep(wait).then(function () { lastCall = Date.now(); });
  }

  function post(path, payload, key) {
    return throttle().then(function () {
      return fetch(cfg.ENDPOINT + path, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify(payload)
      });
    }).then(function (res) {
      return res.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { /* پاسخ JSON نبود */ }
        if (!res.ok) {
          var err = new Error(friendlyError(res.status, body));
          err.status = res.status;
          err.retryAfter = Number(res.headers.get('Retry-After')) || 0;
          throw err;
        }
        // ۴۲۹ وسط استریم به‌شکل بدنهٔ موفق با error برمی‌گردد
        if (body && body.error) {
          var e2 = new Error(friendlyError(body.error.code, body));
          e2.status = body.error.code;
          throw e2;
        }
        return body;
      });
    }, function (netErr) {
      if (netErr && netErr.status) throw netErr;
      throw new Error('اتصال به OpenRouter برقرار نشد. اینترنت یا فیلترشکن را بررسی کنید.');
    });
  }

  // تلاش دوباره با عقب‌نشینی نمایی. فقط برای خطاهای گذرا معنی دارد.
  function withRetry(fn, onNotice) {
    var attempt = 0;
    function go() {
      return fn().catch(function (e) {
        var transient = e.status === 429 || e.status === 502 || e.status === 503 || !e.status;
        if (!transient || attempt >= cfg.MAX_RETRIES) throw e;
        attempt++;
        var wait = e.retryAfter ? e.retryAfter * 1000 : Math.min(60000, 2000 * Math.pow(2, attempt));
        if (onNotice) onNotice('تلاش دوبارهٔ ' + App.fmt.fa(attempt) + ' پس از ' +
          App.fmt.fa(Math.round(wait / 1000)) + ' ثانیه…');
        return App.sleep(wait).then(go);
      });
    }
    return go();
  }

  function textOf(body) {
    var c = body && body.choices && body.choices[0];
    var t = (c && c.message && c.message.content) || '';
    if (Array.isArray(t)) {
      t = t.map(function (p) { return p && p.text ? p.text : ''; }).join('');
    }
    // بعضی مدل‌های استدلالی زنجیرهٔ فکرشان را داخل متن می‌ریزند
    return String(t).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  App.or = {
    // فهرست زندهٔ مدل‌های صوتی؛ اپ با اضافه‌شدن مدل جدید خودش به‌روز می‌شود
    listAudioModels: function () {
      return fetch(cfg.ENDPOINT + '/models').then(function (r) {
        if (!r.ok) throw new Error('فهرست مدل‌ها گرفته نشد.');
        return r.json();
      }).then(function (j) {
        return (j.data || []).filter(function (m) {
          var mods = (m.architecture && m.architecture.input_modalities) || [];
          return mods.indexOf('audio') !== -1;
        }).map(function (m) {
          var p = Number((m.pricing && (m.pricing.audio || m.pricing.prompt)) || 0);
          return { id: m.id, name: m.name, free: p === 0, price: p };
        }).sort(function (a, b) {
          return (b.free - a.free) || (a.price - b.price);
        });
      });
    },

    // یک تکهٔ WAV در base64 → متن فارسی
    transcribeChunk: function (base64, opts) {
      opts = opts || {};
      var payload = {
        model: opts.model || cfg.DEFAULT_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt || cfg.PROMPT },
            { type: 'input_audio', input_audio: { data: base64, format: 'wav' } }
          ]
        }],
        temperature: 0,
        // رونویسی به استدلال نیاز ندارد و توکن‌های فکر خروجی را کثیف می‌کند
        reasoning: { enabled: false }
      };
      return withRetry(function () {
        return post('/chat/completions', payload, opts.key);
      }, opts.onNotice).then(textOf);
    },

    // ویرایش و نقطه‌گذاری متن خام با یک مدل متنی
    polish: function (text, opts) {
      opts = opts || {};
      var payload = {
        model: opts.model || cfg.TEXT_MODEL,
        messages: [
          { role: 'system', content: cfg.POLISH_PROMPT },
          { role: 'user', content: text }
        ],
        temperature: 0.2
      };
      return withRetry(function () {
        return post('/chat/completions', payload, opts.key);
      }, opts.onNotice).then(textOf);
    },

    // مانده‌ی سهمیهٔ کلید
    keyInfo: function (key) {
      return fetch(cfg.ENDPOINT + '/key', { headers: headers(key) })
        .then(function (r) {
          if (!r.ok) throw new Error(friendlyError(r.status, null));
          return r.json();
        }).then(function (j) { return j.data || {}; });
    }
  };

})(window.App = window.App || {});
