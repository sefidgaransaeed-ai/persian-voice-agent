/* هماهنگ‌کنندهٔ رونویسی فایل: آماده‌سازی صدا، ارسال تکه‌به‌تکه، دوختن نتیجه */
(function (App) {
  'use strict';

  var cancelled = false;

  function words(s) { return String(s).trim().split(/\s+/).filter(Boolean); }

  // تکه‌ها هم‌پوشان‌اند، پس دُم قبلی و سرِ بعدی تکرار می‌شوند.
  // بلندترین تطابق تا ۱۲ کلمه را پیدا و حذف می‌کنیم تا جمله دوبار نیاید.
  function stitch(prev, next) {
    if (!prev) return next;
    if (!next) return prev;
    var a = words(prev), b = words(next);
    var max = Math.min(12, a.length, b.length);
    for (var n = max; n >= 2; n--) {
      var tail = a.slice(a.length - n).join(' ');
      var head = b.slice(0, n).join(' ');
      if (tail === head) return a.concat(b.slice(n)).join(' ');
    }
    return prev.replace(/\s+$/, '') + ' ' + next.replace(/^\s+/, '');
  }

  App.transcribe = {
    cancel: function () { cancelled = true; },

    /* opts: { key, model, chunkSeconds, onStage, onProgress, onPartial }
       برمی‌گرداند: { text, duration, chunks } */
    file: function (blob, opts) {
      opts = opts || {};
      cancelled = false;
      var stage = opts.onStage || function () {};
      var progress = opts.onProgress || function () {};

      stage('در حال خواندن و آماده‌سازی صدا…');

      return App.audio.prepare(blob, opts.chunkSeconds).then(function (prep) {
        var total = prep.chunks.length;
        var out = '';
        var i = 0;

        stage(total === 1
          ? 'ارسال به مدل…'
          : 'صدا به ' + App.fmt.fa(total) + ' تکه تقسیم شد.');

        function step() {
          if (cancelled) throw new Error('لغو شد.');
          if (i >= total) return out;

          var c = prep.chunks[i];
          progress(i, total, c);
          stage('رونویسی تکهٔ ' + App.fmt.fa(i + 1) + ' از ' + App.fmt.fa(total) +
                ' (' + App.fmt.dur(c.start) + ' تا ' + App.fmt.dur(c.end) + ')…');

          return App.or.transcribeChunk(c.base64, {
            key: opts.key,
            model: opts.model,
            onNotice: stage
          }).then(function (text) {
            out = stitch(out, text);
            if (opts.onPartial) opts.onPartial(out);
            i++;
            progress(i, total, c);
            return step();
          });
        }

        return Promise.resolve().then(step).then(function (text) {
          return { text: text, duration: prep.duration, chunks: total };
        });
      });
    },

    stitch: stitch
  };

})(window.App = window.App || {});
