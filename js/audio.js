/* پردازش صدا — همه‌چیز دستی، بدون کتابخانه.
   چرا لازم است: OpenRouter فقط wav و mp3 را آن هم base64 می‌پذیرد، ولی
   MediaRecorder مرورگر webm/opus می‌دهد و فایل‌های کاربر m4a/ogg/… هستند.
   پس هر ورودی را رمزگشایی، تک‌کاناله و به ۱۶ کیلوهرتز تبدیل و به WAV تبدیل می‌کنیم. */
(function (App) {
  'use strict';

  var cfg = App.config;

  function ctx() {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) throw new Error('مرورگر شما Web Audio را پشتیبانی نمی‌کند.');
    return new C();
  }

  // فایل (یا Blob) → AudioBuffer. decodeAudioData خودش mp3/wav/m4a/ogg را می‌شناسد.
  function decode(blobOrBuffer) {
    return Promise.resolve().then(function () {
      var ac = ctx();
      var p = blobOrBuffer instanceof ArrayBuffer
        ? Promise.resolve(blobOrBuffer)
        : blobOrBuffer.arrayBuffer();
      return p.then(function (buf) {
        return new Promise(function (resolve, reject) {
          // امضای قدیمی با callback را هم می‌پذیریم چون Safari هنوز همان را دارد
          var ret = ac.decodeAudioData(buf, resolve, reject);
          if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
        });
      }).then(function (ab) {
        if (ac.close) ac.close();
        return ab;
      }, function (e) {
        if (ac.close) ac.close();
        throw new Error('این فایل صوتی قابل خواندن نبود. قالبش پشتیبانی نمی‌شود یا فایل خراب است.');
      });
    });
  }

  // بازنمونه‌برداری به ۱۶ کیلوهرتز تک‌کاناله با OfflineAudioContext
  // (وصل‌کردن منبع چندکاناله به مقصد تک‌کاناله، خودش میکس پایین می‌دهد)
  function toMono16k(audioBuffer) {
    var rate = cfg.SAMPLE_RATE;
    if (audioBuffer.sampleRate === rate && audioBuffer.numberOfChannels === 1) {
      return Promise.resolve(audioBuffer.getChannelData(0).slice());
    }
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var frames = Math.max(1, Math.ceil(audioBuffer.duration * rate));
    var off = new OC(1, frames, rate);
    var src = off.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(off.destination);
    src.start(0);
    return off.startRendering().then(function (rendered) {
      return rendered.getChannelData(0).slice();
    });
  }

  // Float32 [-1,1] → WAV تک‌کاناله ۱۶ بیتی
  function encodeWav(samples, sampleRate) {
    var n = samples.length;
    var buf = new ArrayBuffer(44 + n * 2);
    var v = new DataView(buf);
    var off = 0;
    function str(s) { for (var i = 0; i < s.length; i++) v.setUint8(off++, s.charCodeAt(i)); }
    function u32(x) { v.setUint32(off, x, true); off += 4; }
    function u16(x) { v.setUint16(off, x, true); off += 2; }

    str('RIFF'); u32(36 + n * 2); str('WAVE');
    str('fmt '); u32(16); u16(1); u16(1);
    u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16);
    str('data'); u32(n * 2);

    for (var i = 0; i < n; i++) {
      var s = samples[i];
      s = s < -1 ? -1 : (s > 1 ? 1 : s);
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
    return buf;
  }

  // برش به تکه‌های هم‌پوشان. طولانی‌ترین فایل هم باید از سقف حجم درخواست رد شود.
  function chunk(samples, sampleRate, seconds, overlapSeconds) {
    var size = Math.floor(seconds * sampleRate);
    var lap = Math.floor((overlapSeconds || 0) * sampleRate);
    if (samples.length <= size) return [{ data: samples, start: 0, end: samples.length / sampleRate }];

    var out = [], pos = 0;
    while (pos < samples.length) {
      var end = Math.min(pos + size, samples.length);
      out.push({
        data: samples.subarray(pos, end),
        start: pos / sampleRate,
        end: end / sampleRate
      });
      if (end >= samples.length) break;
      pos = end - lap;
    }
    return out;
  }

  // ArrayBuffer → base64. تکه‌تکه، چون fromCharCode.apply روی آرایهٔ بزرگ پشته را می‌ترکاند.
  function toBase64(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var step = 0x8000, parts = [];
    for (var i = 0; i < bytes.length; i += step) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + step)));
    }
    return btoa(parts.join(''));
  }

  App.audio = {
    decode: decode,
    toMono16k: toMono16k,
    encodeWav: encodeWav,
    chunk: chunk,
    toBase64: toBase64,

    // مسیر کامل: هر ورودی صوتی → فهرست تکه‌های آمادهٔ ارسال
    prepare: function (blob, seconds) {
      return decode(blob)
        .then(toMono16k)
        .then(function (mono) {
          var pieces = chunk(mono, cfg.SAMPLE_RATE,
            seconds || cfg.CHUNK_SECONDS, cfg.OVERLAP_SECONDS);
          return {
            duration: mono.length / cfg.SAMPLE_RATE,
            chunks: pieces.map(function (p) {
              return {
                start: p.start,
                end: p.end,
                base64: toBase64(encodeWav(p.data, cfg.SAMPLE_RATE))
              };
            })
          };
        });
    },

    // برای دکمهٔ «ذخیرهٔ صدا» در حالت زنده
    blobFromSamples: function (samples) {
      return new Blob([encodeWav(samples, cfg.SAMPLE_RATE)], { type: 'audio/wav' });
    }
  };

})(window.App = window.App || {});
