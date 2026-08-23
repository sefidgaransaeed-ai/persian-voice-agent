/* ضبط پیوستهٔ میکروفون با برش تکه‌ای — پایهٔ «گفتار تقریباً زنده».
   چرا از راه Web Audio و نه MediaRecorder با timeslice: تکه‌های MediaRecorder
   مستقل نیستند؛ فقط اولی سرآیند دارد و بقیه به‌تنهایی قابل رمزگشایی نیستند.
   قطع و وصل کردن ضبط‌کننده هم هر بار چند ده میلی‌ثانیه صدا را می‌اندازد.
   پس PCM خام را پیوسته می‌گیریم و خودمان می‌بریم: بدون شکاف، بدون وابستگی. */
(function (App) {
  'use strict';

  var cfg = App.config;

  function Recorder() {
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.source = null;
    this.running = false;
    this.buffer = [];      // تکهٔ در حال جمع شدن
    this.bufferLen = 0;
    this.all = [];         // کل ضبط، برای ذخیره و پاک‌نویس نهایی
    this.allLen = 0;
    this.rate = 0;
    this.startedAt = 0;
    this.seq = 0;
    this.on = {};
  }

  Recorder.prototype.emit = function (name, a, b) {
    if (this.on[name]) this.on[name](a, b);
  };

  Recorder.supported = function () {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
              (window.AudioContext || window.webkitAudioContext));
  };

  /* opts: { chunkSeconds, overlapSeconds } */
  Recorder.prototype.start = function (opts) {
    opts = opts || {};
    var self = this;
    if (this.running) return Promise.resolve();

    if (!Recorder.supported()) {
      return Promise.reject(new Error(
        'مرورگر شما ضبط صدا را پشتیبانی نمی‌کند یا صفحه از روی نشانی امن باز نشده است.'));
    }

    var chunkSec = opts.chunkSeconds || cfg.LIVE_CHUNK_SECONDS;
    var lapSec = (opts.overlapSeconds !== undefined) ? opts.overlapSeconds : cfg.LIVE_OVERLAP_SECONDS;

    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    }).catch(function (e) {
      var map = {
        NotAllowedError: 'اجازهٔ دسترسی به میکروفون داده نشد. روی قفل کنار نوار آدرس بزنید و Allow کنید.',
        NotFoundError: 'میکروفونی پیدا نشد.',
        NotReadableError: 'میکروفون در اختیار برنامهٔ دیگری است.'
      };
      throw new Error(map[e.name] || ('دسترسی به میکروفون ممکن نشد: ' + e.name));
    }).then(function (stream) {
      var AC = window.AudioContext || window.webkitAudioContext;
      self.stream = stream;
      self.ctx = new AC();
      self.rate = self.ctx.sampleRate;
      self.source = self.ctx.createMediaStreamSource(stream);

      var chunkLen = Math.floor(chunkSec * self.rate);
      var lapLen = Math.floor(lapSec * self.rate);

      // ScriptProcessor منسوخ است ولی AudioWorklet به فایل ماژول جدا و addModule
      // نیاز دارد که با اسکریپت کلاسیک جور درنمی‌آید. اینجا همه‌جا کار می‌کند.
      self.node = self.ctx.createScriptProcessor(4096, 1, 1);
      self.node.onaudioprocess = function (ev) {
        if (!self.running) return;
        var input = ev.inputBuffer.getChannelData(0);
        var copy = new Float32Array(input);   // باید کپی شود؛ بافر بازاستفاده می‌شود
        self.buffer.push(copy);
        self.bufferLen += copy.length;
        self.all.push(copy);
        self.allLen += copy.length;

        // سطح صدا برای نمایش زنده
        var peak = 0;
        for (var i = 0; i < copy.length; i += 16) {
          var v = copy[i] < 0 ? -copy[i] : copy[i];
          if (v > peak) peak = v;
        }
        self.emit('level', peak);

        if (self.bufferLen >= chunkLen) self.cut(lapLen);
      };

      self.source.connect(self.node);
      // بدون وصل شدن به مقصد، در بعضی مرورگرها onaudioprocess اصلاً صدا نمی‌زند.
      // بهرهٔ صفر می‌گذاریم تا صدای خود کاربر از بلندگو پخش نشود.
      var mute = self.ctx.createGain();
      mute.gain.value = 0;
      self.node.connect(mute);
      mute.connect(self.ctx.destination);

      self.running = true;
      self.startedAt = Date.now();
      self.emit('state', 'running');
    });
  };

  // انرژی مؤثر تکه. تکهٔ ساکت نباید فرستاده شود: هم سهمیه مصرف می‌کند
  // و هم گاهی خروجی بی‌ربط می‌دهد.
  function rms(samples) {
    if (!samples.length) return 0;
    var sum = 0;
    for (var i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  // تکهٔ جمع‌شده را جدا و به بیرون می‌دهد، با کمی همپوشانی برای واژهٔ لبِ برش
  Recorder.prototype.cut = function (lapLen) {
    var merged = merge(this.buffer, this.bufferLen);
    if (!merged.length) return;

    var keep = (lapLen && lapLen < merged.length)
      ? merged.subarray(merged.length - lapLen).slice()
      : new Float32Array(0);

    this.buffer = keep.length ? [keep] : [];
    this.bufferLen = keep.length;

    if (rms(merged) < cfg.SILENCE_RMS) {
      this.emit('silent');
      return;
    }

    var self = this;
    var index = this.seq++;
    // بازنمونه‌برداری و کدگذاری async است تا رشتهٔ صوتی را نگه ندارد
    toWav(merged, this.rate).then(function (blob) {
      self.emit('chunk', blob, index);
    }).catch(function (e) {
      self.emit('error', e);
    });
  };

  Recorder.prototype.stop = function () {
    var self = this;
    if (!this.running) return Promise.resolve(null);
    this.running = false;

    // باقی‌ماندهٔ بافر نباید دور ریخته شود
    if (this.bufferLen > 0) this.cut(0);

    try { this.source.disconnect(); } catch (e) {}
    try { this.node.disconnect(); } catch (e) {}
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = null;
    }
    var ctx = this.ctx;
    this.ctx = null;
    this.emit('state', 'stopped');

    // کل ضبط را به‌صورت یک WAV برمی‌گردانیم
    var whole = merge(this.all, this.allLen);
    var rate = this.rate;
    return toWav(whole, rate).then(function (blob) {
      if (ctx && ctx.close) { try { ctx.close(); } catch (e) {} }
      self.emit('done', blob);
      return blob;
    });
  };

  Recorder.prototype.elapsed = function () {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  };

  /* ——— کمکی‌ها ——— */

  function merge(parts, total) {
    var out = new Float32Array(total);
    var off = 0;
    for (var i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  // Float32 با نرخ میکروفون → WAV تک‌کاناله ۱۶ کیلوهرتز
  function toWav(samples, rate) {
    return Promise.resolve().then(function () {
      if (!samples.length) return new Blob([], { type: 'audio/wav' });
      var target = cfg.SAMPLE_RATE;
      if (rate === target) {
        return new Blob([App.audio.encodeWav(samples, target)], { type: 'audio/wav' });
      }
      var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var AC = window.AudioContext || window.webkitAudioContext;
      var tmp = new AC();
      var buf = tmp.createBuffer(1, samples.length, rate);
      buf.copyToChannel ? buf.copyToChannel(samples, 0) : buf.getChannelData(0).set(samples);
      if (tmp.close) { try { tmp.close(); } catch (e) {} }

      var frames = Math.max(1, Math.ceil(samples.length * target / rate));
      var off = new OC(1, frames, target);
      var src = off.createBufferSource();
      src.buffer = buf;
      src.connect(off.destination);
      src.start(0);
      return off.startRendering().then(function (rendered) {
        return new Blob([App.audio.encodeWav(rendered.getChannelData(0), target)],
                        { type: 'audio/wav' });
      });
    });
  }

  App.Recorder = Recorder;

})(window.App = window.App || {});
