/* OpenRouter — فقط برای ویرایش و نقطه‌گذاری متن.
   ورودی صوتی‌اش عمداً استفاده نمی‌شود: آزمایش شد که حساب با موجودی صفر
   خطای «at least $0.50 in balance for audio» می‌گیرد، حتی برای مدل رایگان.
   مدل‌های متنی رایگان اما بدون هیچ موجودی کار می‌کنند. */
(function (App) {
  'use strict';

  var cfg = App.config;

  function headers(key) {
    return {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin === 'null' ? 'https://localhost' : location.origin,
      'X-Title': 'Persian Voice Agent'
    };
  }

  function friendlyError(status, body) {
    var msg = (body && body.error && body.error.message) || '';
    if (status === 401) return 'کلید OpenRouter پذیرفته نشد.';
    if (status === 402) return 'اعتبار حساب OpenRouter منفی است.';
    if (status === 429) return 'به سقف درخواست رسیدید (۲۰ در دقیقه، ۵۰ در روز برای مدل‌های رایگان).';
    return 'خطای OpenRouter' + (status ? ' (' + status + ')' : '') + (msg ? ': ' + msg : '');
  }

  App.or = {
    // ویرایش متن خام: نقطه‌گذاری و اصلاح واژه‌های بدشنیده‌شده
    polish: function (text, opts) {
      opts = opts || {};
      if (!opts.key) return Promise.reject(new Error('کلید OpenRouter وارد نشده است.'));

      return fetch(cfg.OR_ENDPOINT + '/chat/completions', {
        method: 'POST',
        headers: headers(opts.key),
        body: JSON.stringify({
          model: opts.model || cfg.TEXT_MODEL,
          messages: [
            { role: 'system', content: cfg.POLISH_PROMPT },
            { role: 'user', content: text }
          ],
          temperature: 0.2
        })
      }).then(function (res) {
        return res.text().then(function (t) {
          var body = null;
          try { body = t ? JSON.parse(t) : null; } catch (e) {}
          if (!res.ok) throw new Error(friendlyError(res.status, body));
          if (body && body.error) throw new Error(friendlyError(body.error.code, body));
          var c = body && body.choices && body.choices[0];
          var out = (c && c.message && c.message.content) || '';
          if (Array.isArray(out)) {
            out = out.map(function (p) { return p && p.text ? p.text : ''; }).join('');
          }
          // بعضی مدل‌های استدلالی زنجیرهٔ فکرشان را داخل متن می‌ریزند
          return String(out).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        });
      }, function () {
        throw new Error('اتصال به OpenRouter برقرار نشد.');
      });
    },

    keyInfo: function (key) {
      return fetch(cfg.OR_ENDPOINT + '/key', { headers: headers(key) })
        .then(function (r) {
          if (!r.ok) throw new Error(friendlyError(r.status, null));
          return r.json();
        }).then(function (j) { return j.data || {}; });
    }
  };

})(window.App = window.App || {});
