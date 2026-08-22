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

      // این خطاها با تلاش دوباره درست نمی‌شوند. اگر حلقهٔ راه‌اندازی مجدد ادامه
      // پیدا کند، هر دور یک پیام تکراری روی صفحه تلنبار می‌شود.
      var FATAL = {
        'not-allowed': 'اجازهٔ دسترسی به میکروفون داده نشد. روی قفل کنار نوار آدرس بزنید و میکروفون را Allow کنید.',
        'service-not-allowed': 'مرورگر اجازهٔ استفاده از سرویس تشخیص گفتار را نداد. صفحه را از روی http://localhost باز کنید، نه با دابل‌کلیک روی فایل.',
        'audio-capture': 'میکروفونی پیدا نشد. اتصال میکروفون را بررسی کنید.',
        'language-not-supported': 'سرویس تشخیص گفتار این مرورگر از فارسی پشتیبانی نمی‌کند.',
        'network': 'سرور تشخیص گفتار مرورگر پاسخ نداد. این سرویس معمولاً از ایران در دسترس نیست — ' +
                   'یک بار با VPN امتحان کنید.'
      };

      r.onerror = function (ev) {
        // no-speech و aborted طبیعی‌اند و نباید کاربر را بترسانند
        if (ev.error === 'no-speech' || ev.error === 'aborted') return;
        if (FATAL[ev.error]) {
          // حلقهٔ راه‌اندازی مجدد را می‌بندیم تا پیام فقط یک بار بیاید
          self.wantStop = true;
          self.fatal = ev.error;
          self.emit('error', new Error(FATAL[ev.error]));
          return;
        }
        self.emit('error', new Error('خطای تشخیص گفتار: ' + ev.error));
      };

      // کروم پس از هر سکوت خودش قطع می‌کند؛ تا وقتی کاربر نگفته «توقف» دوباره وصلش می‌کنیم
      self.restarts = 0;
      r.onend = function () {
        if (self.wantStop) { self.finish(); return; }
        // سقف ایمنی: اگر چیزی مدام قطع می‌کند، بی‌نهایت تلاش نکن
        if (++self.restarts > 60) { self.finish(); return; }
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
