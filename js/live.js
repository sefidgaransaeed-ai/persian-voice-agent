/* گفتار زندهٔ فارسی با Web Speech API مرورگر.
   چرا این و نه OpenRouter: OpenRouter هیچ ورودی جریانی برای صدا ندارد و سقف
   رایگانش ۵۰ درخواست در روز است. Web Speech بلادرنگ، بی‌سقف و بدون کلید است.
   هم‌زمان صدای خام هم ضبط می‌شود تا در صورت نیاز پاک‌نویس دقیق‌تری گرفته شود. */
(function (App) {
  'use strict';

  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;

  function Live() {
    this.rec = null;
    this.recorder = null;
    this.stream = null;
    this.parts = [];
    this.running = false;
    this.wantStop = false;
    this.startedAt = 0;
    this.finalText = '';
    this.on = {};
  }

  Live.prototype.emit = function (name, a, b) {
    if (this.on[name]) this.on[name](a, b);
  };

  Live.supported = function () { return !!Rec; };

  Live.prototype.start = function (opts) {
    opts = opts || {};
    var self = this;
    if (!Rec) {
      return Promise.reject(new Error(
        'مرورگر شما تشخیص گفتار زنده ندارد. از Microsoft Edge یا Google Chrome استفاده کنید.'));
    }
    if (this.running) return Promise.resolve();

    this.wantStop = false;
    this.finalText = '';
    this.parts = [];
    this.startedAt = Date.now();

    // ضبط موازیِ صدا اختیاری است؛ اگر میکروفون در دسترس نبود، متن زنده باز هم کار می‌کند
    var micReady = (opts.recordAudio && navigator.mediaDevices)
      ? navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
          self.stream = stream;
          try {
            self.recorder = new MediaRecorder(stream);
            self.recorder.ondataavailable = function (e) {
              if (e.data && e.data.size) self.parts.push(e.data);
            };
            self.recorder.start(1000);
          } catch (e) { self.recorder = null; }
        }).catch(function () { /* بدون ضبط ادامه می‌دهیم */ })
      : Promise.resolve();

    return micReady.then(function () {
      var r = new Rec();
      self.rec = r;
      r.lang = opts.lang || App.config.LANG;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;

      r.onresult = function (ev) {
        var interim = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var res = ev.results[i];
          var txt = res[0].transcript;
          if (res.isFinal) {
            self.finalText = (self.finalText ? self.finalText + ' ' : '') + txt.trim();
          } else {
            interim += txt;
          }
        }
        self.emit('text', self.finalText, interim.trim());
      };

      r.onerror = function (ev) {
        // no-speech و aborted طبیعی‌اند و نباید کاربر را بترسانند
        if (ev.error === 'no-speech' || ev.error === 'aborted') return;
        var map = {
          'not-allowed': 'اجازهٔ دسترسی به میکروفون داده نشد. از نوار آدرس مرورگر اجازه بدهید.',
          'service-not-allowed': 'سرویس تشخیص گفتار در دسترس نیست. صفحه را از روی http://localhost باز کنید، نه با دابل‌کلیک.',
          'audio-capture': 'میکروفونی پیدا نشد.',
          'network': 'ارتباط سرویس تشخیص گفتار قطع شد. اینترنت را بررسی کنید.'
        };
        self.emit('error', new Error(map[ev.error] || ('خطای تشخیص گفتار: ' + ev.error)));
      };

      // کروم پس از هر سکوت خودش قطع می‌کند؛ تا وقتی کاربر نگفته «توقف» دوباره وصلش می‌کنیم
      r.onend = function () {
        if (self.wantStop) { self.finish(); return; }
        try { r.start(); }
        catch (e) { self.finish(); }
      };

      r.start();
      self.running = true;
      self.emit('state', 'running');
    });
  };

  Live.prototype.stop = function () {
    this.wantStop = true;
    if (this.rec) { try { this.rec.stop(); } catch (e) { this.finish(); } }
    else this.finish();
  };

  Live.prototype.finish = function () {
    var self = this;
    if (!this.running) return;
    this.running = false;

    var done = function (blob) {
      if (self.stream) {
        self.stream.getTracks().forEach(function (t) { t.stop(); });
        self.stream = null;
      }
      self.rec = null;
      self.emit('state', 'stopped');
      self.emit('done', self.finalText, blob);
    };

    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = function () {
        var blob = self.parts.length
          ? new Blob(self.parts, { type: self.parts[0].type || 'audio/webm' })
          : null;
        self.recorder = null;
        done(blob);
      };
      try { this.recorder.stop(); } catch (e) { done(null); }
    } else {
      done(this.parts.length ? new Blob(this.parts) : null);
    }
  };

  Live.prototype.elapsed = function () {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  };

  App.Live = Live;

})(window.App = window.App || {});
