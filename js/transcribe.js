/* هماهنگ‌کنندهٔ رونویسی فایل: آماده‌سازی صدا، ارسال تکه‌به‌تکه به Deepgram، دوختن نتیجه */
(function (App) {
  'use strict';

  var cancelled = false;

  function words(s) { return String(s).trim().split(/\s+/).filter(Boolean); }

  /* یکسان‌سازی — فقط برای مقایسهٔ دو سرِ تکه، نه برای خروجی.
     Deepgram همان واژه را در دو تکهٔ مجاور گاهی جور دیگری می‌نویسد: یک‌بار با
     نیم‌فاصله و یک‌بار بی آن، یا با «ي» و «ك» عربی به‌جای فارسی، یا با نقطه و
     ویرگولی که smart_format چسبانده. بدون این، تطابقِ دقیق تقریباً هیچ‌وقت
     برقرار نمی‌شد و همپوشانی دوباره در متن می‌نشست. */
  function norm(w) {
    return String(w)
      .replace(/[\u200b-\u200f]/g, '')           // نیم‌فاصله و نشانه‌های جهت
      // کسرهٔ اضافه دو املای رایج دارد و Deepgram هر دو را می‌دهد:
      // «خانهٔ» (ه + همزه) و «خانه‌ی» (ه + نیم‌فاصله + ی). یکی‌شان می‌کنیم.
      .replace(/\u0647\u0654/g, '\u0647\u06cc')
      .replace(/[\u064b-\u0652\u0640\u0653-\u0655]/g, '')  // اعراب، کشیده، همزه
      .replace(/[\u064a\u0649]/g, '\u06cc')      // ي ى → ی
      .replace(/\u0643/g, '\u06a9')              // ك → ک
      .replace(/[\u06f0-\u06f9\u0660-\u0669]/g, function (d) {
        var c = d.charCodeAt(0);                 // ارقام فارسی و عربی → لاتین
        return String((c >= 0x06f0 ? c - 0x06f0 : c - 0x0660));
      })
      .replace(/[.,،؛؟!:"'«»\u2026\u2013\u2014-]/g, '')
      .toLowerCase();
  }

  // تکه‌ها هم‌پوشان‌اند، پس دُم قبلی و سرِ بعدی تکرار می‌شوند.
  // بلندترین تطابق تا ۱۲ کلمه را پیدا و حذف می‌کنیم تا جمله دوبار نیاید.
  function stitch(prev, next) {
    if (!prev) return String(next || '').trim();
    if (!next) return prev;
    var a = words(prev), b = words(next);
    var na = a.map(norm), nb = b.map(norm);
    var max = Math.min(12, a.length, b.length);
    for (var n = max; n >= 2; n--) {
      var tail = na.slice(na.length - n).join(' ');
      // دُمی که پس از یکسان‌سازی چیزی جز فاصله نمانده (مثلاً فقط نقطه‌گذاری)
      // نباید تطابق بشمارد؛ وگرنه کلمهٔ سالم را می‌خورد.
      if (tail.replace(/\s/g, '') && tail === nb.slice(0, n).join(' ')) {
        return a.concat(b.slice(n)).join(' ');
      }
    }
    return prev.replace(/\s+$/, '') + ' ' + String(next).replace(/^\s+/, '');
  }

  App.transcribe = {
    cancel: function () { cancelled = true; },
    stitch: stitch,

    /* opts: { key, model, language, chunkSeconds, onStage, onProgress, onPartial }
       برمی‌گرداند: { text, duration, chunks } */
    file: function (blob, opts) {
      opts = opts || {};
      cancelled = false;
      var stage = opts.onStage || function () {};
      var progress = opts.onProgress || function () {};

      stage('در حال خواندن و آماده‌سازی صدا…');

      return App.audio.prepareBlobs(blob, opts.chunkSeconds).then(function (prep) {
        var total = prep.chunks.length;
        var out = '';
        var i = 0;

        stage(total === 1 ? 'ارسال به Deepgram…'
                          : 'صدا به ' + App.fmt.fa(total) + ' تکه تقسیم شد.');

        function step() {
          if (cancelled) throw new Error('لغو شد.');
          if (i >= total) return out;

          var c = prep.chunks[i];
          progress(i, total);
          stage('رونویسی تکهٔ ' + App.fmt.fa(i + 1) + ' از ' + App.fmt.fa(total) +
                ' (' + App.fmt.dur(c.start) + ' تا ' + App.fmt.dur(c.end) + ')…');

          return App.dg.transcribe(c.blob, {
            key: opts.key,
            model: opts.model,
            language: opts.language,
            // Deepgram اصطلاحات را با keyterm می‌گیرد، نه با پرامپتِ قابل ادامه دادن
            glossary: opts.glossary,
            onNotice: stage
          }).then(function (text) {
            out = stitch(out, text);
            if (opts.onPartial) opts.onPartial(out);
            i++;
            progress(i, total);
            return step();
          });
        }

        return Promise.resolve().then(step).then(function (text) {
          return { text: text, duration: prep.duration, chunks: total };
        });
      });
    }
  };

})(window.App = window.App || {});
