/* همهٔ نماها، فرم‌ها و وضعیت رابط کاربری. تنها ماژولی که DOM را در دست دارد. */
(function (App) {
  'use strict';

  var el = App.dom.el, $ = App.dom.$, fmt = App.fmt;
  var cfg = App.config;

  var state = {
    tab: 'live',
    rec: null,
    parts: [],        // متن هر تکه، به ترتیب شماره
    pending: 0,       // تکه‌های در راه
    liveBlob: null,
    fileBusy: false,
    hostTheme: null
  };

  /* ——— آیکون‌ها: SVG درجا، بدون فونت آیکون بیرونی ——— */
  function icon(name, size) {
    var s = size || 18;
    var paths = {
      mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>' +
           '<path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
      stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
      copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
      down: '<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>',
      trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
      wand: '<path d="M4 20 18 6M15 3l1.5 3L20 7.5 16.5 9 15 12l-1.5-3L10 7.5 13.5 6z"/>',
      file: '<path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      key: '<circle cx="8" cy="15" r="4"/><path d="M11 12 21 2M18 5l2 2M15 8l2 2"/>'
    };
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }

  /* ——— اعلان ——— */
  var lastToast = { msg: null, at: 0 };
  function toast(msg, kind) {
    // پیام یکسان در فاصلهٔ کوتاه تکرار نمی‌شود؛ خطای پیاپی نباید صفحه را پر کند
    var now = Date.now();
    if (msg === lastToast.msg && now - lastToast.at < 8000) return;
    lastToast = { msg: msg, at: now };

    var box = $('#toasts') || document.body.appendChild(el('div', { id: 'toasts' }));
    var t = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: msg });
    box.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, kind === 'err' ? 7000 : 4000);
  }

  /* ——— پوسته ———
     'system' یعنی بازگشت به همان چیزی که میزبان گذاشته بود، نه حذف صفت. */
  function captureHostTheme() {
    state.hostTheme = document.documentElement.getAttribute('data-theme');
  }
  function applyTheme(mode) {
    var r = document.documentElement;
    if (mode === 'system') {
      if (state.hostTheme) r.setAttribute('data-theme', state.hostTheme);
      else r.removeAttribute('data-theme');
    } else {
      r.setAttribute('data-theme', mode);
    }
    App.store.setSetting('theme', mode);
  }

  /* ——— کمکی‌ها ——— */
  function badge(kind, text) {
    // نقطه و متن با هم؛ وضعیت هرگز فقط با رنگ گفته نمی‌شود
    return el('span', { class: 'badge ' + kind }, [el('span', { class: 'dot' }), text]);
  }
  function btn(label, opts) {
    opts = opts || {};
    var b = el('button', {
      class: 'btn' + (opts.variant ? ' ' + opts.variant : ''),
      type: 'button', onclick: opts.onClick, disabled: opts.disabled, title: opts.title
    });
    if (opts.icon) {
      var i = el('span', { html: icon(opts.icon) });
      i.style.display = 'inline-flex';
      b.appendChild(i);
    }
    b.appendChild(document.createTextNode(label));
    return b;
  }
  function field(labelText, control) {
    return el('label', { class: 'field' }, [el('span', { text: labelText }), control]);
  }
  function needGroqKey() {
    var k = App.store.groqKey();
    if (!k) {
      toast('اول کلید Groq را در زبانهٔ تنظیمات وارد کنید.', 'err');
      return null;
    }
    return k;
  }
  // متن تکه‌ها را به ترتیب و بدون تکرارِ لبهٔ برش به هم می‌دوزد
  function joined() {
    var out = '';
    for (var i = 0; i < state.parts.length; i++) {
      if (state.parts[i]) out = App.transcribe.stitch(out, state.parts[i]);
    }
    return out;
  }

  /* ================= زبانهٔ گفتار زنده ================= */

  function renderLive(root) {
    if (location.protocol === 'file:') {
      root.appendChild(el('div', { class: 'note crit' }, [
        el('strong', { text: 'این صفحه با دابل‌کلیک باز شده. ' }),
        'مرورگرها روی نشانی file:// اجازهٔ میکروفون نمی‌دهند. فایل serve.ps1 را اجرا ' +
        'کنید و صفحه را از روی http://localhost:8787 باز کنید.'
      ]));
    }
    if (!App.Recorder.supported()) {
      root.appendChild(el('div', { class: 'note crit' }, [
        el('strong', { text: 'ضبط صدا در این مرورگر ممکن نیست. ' }),
        'از Microsoft Edge یا Google Chrome استفاده کنید.'
      ]));
    }

    var out = el('div', { class: 'out', id: 'live-out', 'aria-live': 'polite' });
    var stateLine = el('div', { class: 'mic-state', id: 'mic-state', text: 'آماده' });
    var meter = el('div', { class: 'bar', style: 'max-width:220px;margin:10px auto' }, [el('i')]);
    var micBtn = el('button', {
      class: 'mic', id: 'mic-btn', 'data-on': 'false',
      'aria-label': 'شروع ضبط', title: 'شروع / توقف', html: icon('mic', 40)
    });

    var timer = null;
    function tick() {
      if (!state.rec || !state.rec.running) return;
      var s = 'در حال شنیدن…  ' + fmt.dur(state.rec.elapsed());
      if (state.pending > 0) s += '   •   ' + fmt.fa(state.pending) + ' تکه در حال رونویسی';
      stateLine.textContent = s;
    }

    function paint() {
      var text = joined();
      App.dom.clear(out);
      if (text) out.appendChild(document.createTextNode(text));
      if (state.pending > 0) {
        if (text) out.appendChild(document.createTextNode(' '));
        out.appendChild(el('span', { class: 'interim', text: '…' }));
      }
      out.scrollTop = out.scrollHeight;
      refreshActions();
    }

    function stopUI() {
      micBtn.setAttribute('data-on', 'false');
      micBtn.innerHTML = icon('mic', 40);
      micBtn.setAttribute('aria-label', 'شروع ضبط');
      if (timer) { clearInterval(timer); timer = null; }
      meter.firstChild.style.width = '0%';
      out.setAttribute('contenteditable', 'true');
      out.setAttribute('spellcheck', 'false');
      refreshActions();
    }

    micBtn.addEventListener('click', function () {
      if (state.rec && state.rec.running) {
        stateLine.textContent = 'در حال تمام کردن تکه‌های باقی‌مانده…';
        state.rec.stop();
        return;
      }
      var key = needGroqKey();
      if (!key) return;

      var s = App.store.settings();
      var rec = new App.Recorder();
      state.rec = rec;
      state.parts = [];
      state.pending = 0;
      state.liveBlob = null;
      out.removeAttribute('contenteditable');
      App.dom.clear(out);

      rec.on.level = function (peak) {
        meter.firstChild.style.width = Math.min(100, Math.round(peak * 180)) + '%';
      };
      rec.on.error = function (e) { toast(e.message, 'err'); };
      rec.on.state = function (st) {
        if (st === 'running') {
          micBtn.setAttribute('data-on', 'true');
          micBtn.innerHTML = icon('stop', 34);
          micBtn.setAttribute('aria-label', 'توقف ضبط');
          timer = setInterval(tick, 400);
          tick();
        }
      };

      rec.on.chunk = function (blob, index) {
        state.pending++;
        var context = App.groq.buildPrompt(joined(), s.glossary, s.useContext);
        state.parts[index] = state.parts[index] || '';
        paint();
        App.groq.transcribe(blob, {
          key: key, model: s.model, language: s.language,
          prompt: context, filename: 'live' + index + '.wav'
        }).then(function (text) {
          state.parts[index] = text || '';
        }).catch(function (e) {
          toast(e.message, 'err');
        }).then(function () {
          state.pending--;
          paint();
          tick();
        });
      };

      rec.on.done = function (blob) {
        state.liveBlob = blob;
        var finish = setInterval(function () {
          if (state.pending > 0) return;
          clearInterval(finish);
          paint();
          var text = joined();
          stateLine.textContent = text
            ? 'پایان.  ' + fmt.fa(text.trim().split(/\s+/).filter(Boolean).length) + ' کلمه.'
            : 'چیزی شنیده نشد.';
          if (text) {
            App.store.addToArchive({
              title: 'گفتار زنده — ' + fmt.stamp(), text: text,
              source: 'live', model: s.model, seconds: rec.elapsed()
            });
          }
        }, 250);
        stopUI();
      };

      rec.start({ chunkSeconds: Number(s.liveChunkSeconds) || cfg.LIVE_CHUNK_SECONDS })
        .catch(function (e) { toast(e.message, 'err'); stopUI(); });
    });

    /* ——— دکمه‌ها ——— */
    var actions = el('div', { class: 'row', id: 'live-actions' });
    function currentText() {
      return (out.getAttribute('contenteditable') === 'true' ? out.innerText : joined()) || '';
    }
    function refreshActions() {
      App.dom.clear(actions);
      var has = !!currentText().trim();
      var busy = state.rec && state.rec.running;

      actions.appendChild(btn('رونوشت', {
        icon: 'copy', disabled: !has || busy,
        onClick: function () {
          navigator.clipboard.writeText(currentText())
            .then(function () { toast('متن رونوشت شد.', 'ok'); },
                  function () { toast('رونوشت ممکن نشد.', 'err'); });
        }
      }));
      actions.appendChild(btn('ذخیرهٔ متن', {
        icon: 'down', disabled: !has || busy,
        onClick: function () { App.file.download('گفتار-' + Date.now() + '.txt', currentText()); }
      }));
      if (state.liveBlob) {
        actions.appendChild(btn('ذخیرهٔ صدا', {
          icon: 'down',
          onClick: function () { App.file.download('صدا-' + Date.now() + '.wav', state.liveBlob); }
        }));
      }
      actions.appendChild(btn('ویرایش و نقطه‌گذاری', {
        icon: 'wand', variant: 'primary', disabled: !has || busy,
        title: 'غلط‌های شنیداری را با کمک متن اطراف اصلاح و نقطه‌گذاری می‌کند (کلید OpenRouter لازم است)',
        onClick: function (ev) { polish(ev.currentTarget, currentText(), out); }
      }));
      actions.appendChild(btn('پاک کردن', {
        icon: 'trash', variant: 'ghost', disabled: !has || busy,
        onClick: function () {
          state.parts = []; state.liveBlob = null;
          App.dom.clear(out); stateLine.textContent = 'آماده'; refreshActions();
        }
      }));
    }
    out.addEventListener('input', refreshActions);

    root.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'گفتار زندهٔ فارسی' }),
      el('p', {
        class: 'hint',
        text: 'دکمه را بزنید و فارسی حرف بزنید. صدا هر چند ثانیه یک بار به Groq فرستاده ' +
              'می‌شود و متن پشت سر هم اضافه می‌شود — یکی دو ثانیه تأخیر طبیعی است.'
      }),
      el('div', { class: 'mic-wrap' }, [micBtn, meter, stateLine]),
      out,
      el('div', { style: 'height:12px' }),
      actions
    ]));

    refreshActions();
    return root;
  }

  /* ——— پاک‌نویس با مدل متنی رایگان OpenRouter ——— */
  function polish(button, text, target) {
    var key = App.store.apiKey();
    if (!key) {
      toast('برای ویرایش متن، کلید OpenRouter لازم است. در تنظیمات واردش کنید.', 'err');
      return;
    }
    var label = button.lastChild;
    var old = label.textContent;
    button.disabled = true;
    label.textContent = 'در حال ویرایش…';

    App.or.polish(text, { key: key, model: App.store.settings().textModel })
      .then(function (clean) {
        if (!clean) throw new Error('مدل پاسخ خالی داد.');
        target.textContent = clean;
        state.parts = [clean];
        toast('متن ویرایش شد.', 'ok');
      })
      .catch(function (e) { toast(e.message, 'err'); })
      .then(function () { button.disabled = false; label.textContent = old; });
  }

  /* ================= زبانهٔ فایل صوتی ================= */

  function renderFile(root) {
    var picked = null;
    var input = el('input', { type: 'file', accept: 'audio/*,video/*', class: 'hidden' });
    var drop = el('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'انتخاب فایل صوتی' }, [
      el('div', { html: icon('file', 30) }),
      el('div', { class: 'big-t', text: 'فایل صوتی را اینجا رها کنید' }),
      el('div', { class: 'small-t', text: 'یا کلیک کنید. mp3، wav، m4a، ogg، webm و صدای ویدیو' })
    ]);

    var info = el('div', { class: 'stage' });
    var bar = el('div', { class: 'bar' }, [el('i')]);
    var stage = el('div', { class: 'stage' });
    var out = el('div', { class: 'out' });
    var actions = el('div', { class: 'row' });

    function setProgress(p) { bar.firstChild.style.width = Math.round(p * 100) + '%'; }

    function choose(f) {
      if (!f) return;
      picked = f;
      info.textContent = f.name + ' — ' + fmt.bytes(f.size);
      drop.querySelector('.big-t').textContent = f.name;
      refresh();
    }

    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () { choose(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (n) {
      drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (n) {
      drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) choose(e.dataTransfer.files[0]);
    });

    function refresh() {
      App.dom.clear(actions);
      actions.appendChild(btn(state.fileBusy ? 'در حال رونویسی…' : 'شروع رونویسی', {
        icon: 'wand', variant: 'primary', disabled: !picked || state.fileBusy, onClick: run
      }));
      if (state.fileBusy) {
        actions.appendChild(btn('لغو', { variant: 'danger', onClick: function () { App.transcribe.cancel(); } }));
      }
      var has = !!out.textContent.trim();
      actions.appendChild(btn('رونوشت', {
        icon: 'copy', disabled: !has || state.fileBusy,
        onClick: function () {
          navigator.clipboard.writeText(out.innerText).then(function () { toast('رونوشت شد.', 'ok'); });
        }
      }));
      actions.appendChild(btn('ذخیرهٔ متن', {
        icon: 'down', disabled: !has || state.fileBusy,
        onClick: function () {
          App.file.download(App.file.stem(picked ? picked.name : 'متن') + '.txt', out.innerText);
        }
      }));
      actions.appendChild(btn('ویرایش و نقطه‌گذاری', {
        icon: 'wand', disabled: !has || state.fileBusy,
        onClick: function (ev) { polish(ev.currentTarget, out.innerText, out); }
      }));
    }

    function run() {
      var key = needGroqKey();
      if (!key) return;
      var s = App.store.settings();
      state.fileBusy = true;
      App.dom.clear(out);
      setProgress(0);
      refresh();

      App.transcribe.file(picked, {
        key: key, model: s.model, language: s.language, glossary: s.glossary, useContext: s.useContext,
        chunkSeconds: Number(s.chunkSeconds) || cfg.CHUNK_SECONDS,
        onStage: function (m) { stage.textContent = m; },
        onProgress: function (done, total) { setProgress(total ? done / total : 0); },
        onPartial: function (t) { out.textContent = t; refresh(); }
      }).then(function (res) {
        out.textContent = res.text;
        stage.textContent = 'انجام شد — ' + fmt.dur(res.duration) + ' صدا در ' +
                            fmt.fa(res.chunks) + ' تکه.';
        setProgress(1);
        App.store.addToArchive({
          title: picked.name, text: res.text, source: 'file',
          model: s.model, seconds: res.duration
        });
        if (s.autoPolish && res.text && App.store.apiKey()) {
          stage.textContent = 'در حال ویرایش و نقطه‌گذاری…';
          return App.or.polish(res.text, { key: App.store.apiKey(), model: s.textModel })
            .then(function (clean) {
              if (clean) { out.textContent = clean; stage.textContent = 'انجام شد و ویرایش شد.'; }
            });
        }
      }).catch(function (e) {
        stage.textContent = '';
        toast(e.message, 'err');
      }).then(function () {
        state.fileBusy = false;
        refresh();
      });
    }

    root.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'رونویسی فایل صوتی' }),
      el('p', {
        class: 'hint',
        text: 'فایل داخل مرورگر شما به WAV تک‌کاناله ۱۶ کیلوهرتز تبدیل، در صورت نیاز ' +
              'تکه‌تکه و به Groq فرستاده می‌شود.'
      }),
      input, drop, info, bar, stage,
      el('div', { style: 'height:10px' }),
      out,
      el('div', { style: 'height:12px' }),
      actions
    ]));
    refresh();
    return root;
  }

  /* ================= زبانهٔ بایگانی ================= */

  function renderArchive(root) {
    var list = App.store.archive();
    var card = el('div', { class: 'card' }, [
      el('h2', { text: 'بایگانی' }),
      el('p', { class: 'hint', text: 'پنجاه رونویسی آخر، در حافظهٔ همین مرورگر.' })
    ]);

    if (!list.length) {
      card.appendChild(el('div', { class: 'stage', text: 'هنوز چیزی ثبت نشده.' }));
      root.appendChild(card);
      return root;
    }

    card.appendChild(el('div', { class: 'row', style: 'margin-bottom:14px' }, [
      btn('ذخیرهٔ همه در یک فایل', {
        icon: 'down',
        onClick: function () {
          var all = list.map(function (r) {
            return '### ' + r.title + '\n' + fmt.stamp(new Date(r.at)) + '\n\n' + r.text;
          }).join('\n\n---\n\n');
          App.file.download('بایگانی-رونویسی.txt', all);
        }
      }),
      btn('پاک کردن بایگانی', {
        icon: 'trash', variant: 'danger',
        onClick: function () {
          if (!confirm('کل بایگانی پاک شود؟ این کار برگشت‌پذیر نیست.')) return;
          App.store.clearArchive();
          render();
        }
      })
    ]));

    list.forEach(function (r) {
      card.appendChild(el('div', { class: 'arc-item' }, [
        el('div', { class: 'head' }, [
          el('span', { class: 'title', text: r.title }),
          badge('info', r.source === 'live' ? 'زنده' : 'فایل'),
          el('span', { class: 'meta num', text: fmt.dur(r.seconds) }),
          el('span', { class: 'meta', text: fmt.stamp(new Date(r.at)) })
        ]),
        el('div', { class: 'body', text: r.text }),
        el('div', { class: 'row', style: 'margin-top:8px' }, [
          btn('رونوشت', {
            icon: 'copy', variant: 'ghost',
            onClick: function () {
              navigator.clipboard.writeText(r.text).then(function () { toast('رونوشت شد.', 'ok'); });
            }
          }),
          btn('ذخیره', {
            icon: 'down', variant: 'ghost',
            onClick: function () { App.file.download(r.title + '.txt', r.text); }
          }),
          btn('حذف', {
            icon: 'trash', variant: 'ghost',
            onClick: function () { App.store.removeFromArchive(r.id); render(); }
          })
        ])
      ]));
    });

    root.appendChild(card);
    return root;
  }

  /* ================= زبانهٔ تنظیمات ================= */

  function renderSettings(root) {
    var s = App.store.settings();

    /* --- کلید Groq: موتور اصلی --- */
    var gInput = el('input', {
      type: 'password', value: App.store.groqKey(),
      placeholder: 'gsk_…', autocomplete: 'off', spellcheck: 'false'
    });
    var gStatus = el('div', { class: 'stage' });

    root.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'کلید Groq — لازم' }),
      el('p', {
        class: 'hint',
        text: 'موتور تبدیل گفتار به متن. کلید رایگان از console.groq.com/keys بگیرید؛ ' +
              'کارت بانکی نمی‌خواهد. کلید فقط در حافظهٔ همین مرورگر می‌ماند.'
      }),
      field('کلید', gInput),
      el('div', { class: 'row' }, [
        btn('ذخیره', {
          icon: 'check', variant: 'primary',
          onClick: function () { App.store.groqKey(gInput.value); toast('کلید Groq ذخیره شد.', 'ok'); }
        }),
        btn('بررسی کلید', {
          icon: 'key',
          onClick: function () {
            var k = gInput.value.trim();
            if (!k) { toast('کلید خالی است.', 'err'); return; }
            gStatus.textContent = 'در حال بررسی…';
            App.groq.checkKey(k).then(function (d) {
              App.dom.clear(gStatus);
              gStatus.appendChild(badge('good', 'کلید معتبر است'));
              gStatus.appendChild(el('div', {
                style: 'margin-top:6px',
                text: 'مدل‌های صوتی در دسترس: ' + d.audio.join('  •  ')
              }));
            }).catch(function (e) {
              App.dom.clear(gStatus);
              gStatus.appendChild(badge('crit', e.message));
            });
          }
        }),
        btn('حذف', {
          icon: 'trash', variant: 'ghost',
          onClick: function () { App.store.groqKey(null); gInput.value = ''; App.dom.clear(gStatus); }
        })
      ]),
      gStatus
    ]));

    /* --- مدل و زبان --- */
    var modelSel = el('select', {});
    App.groq.MODELS.forEach(function (m) {
      modelSel.appendChild(el('option', { value: m.id, text: m.label, selected: m.id === s.model }));
    });
    modelSel.addEventListener('change', function () { App.store.setSetting('model', modelSel.value); });

    var langSel = el('select', {}, [
      el('option', { value: 'fa', text: 'فارسی', selected: s.language === 'fa' }),
      el('option', { value: 'en', text: 'انگلیسی', selected: s.language === 'en' }),
      el('option', { value: 'auto', text: 'تشخیص خودکار', selected: s.language === 'auto' })
    ]);
    langSel.addEventListener('change', function () { App.store.setSetting('language', langSel.value); });

    var liveChunk = el('input', { type: 'number', min: '3', max: '30', step: '1', value: String(s.liveChunkSeconds) });
    liveChunk.addEventListener('change', function () {
      App.store.setSetting('liveChunkSeconds', Number(liveChunk.value) || cfg.LIVE_CHUNK_SECONDS);
    });

    var glossary = el('textarea', {
      rows: '3',
      placeholder: 'مثال: سعید سفیدگران، شرکت پیشگامان، پروژهٔ فاز دو، PMBOK، پرتفوی'
    });
    glossary.value = s.glossary || '';
    glossary.addEventListener('change', function () {
      App.store.setSetting('glossary', glossary.value);
      toast('واژه‌نامه ذخیره شد.', 'ok');
    });

    var ctxCheck = el('input', { type: 'checkbox', checked: s.useContext });
    ctxCheck.addEventListener('change', function () {
      App.store.setSetting('useContext', ctxCheck.checked);
    });

    root.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'رونویسی' }),
      el('div', { class: 'grid' }, [
        field('مدل', modelSel),
        field('زبان گفتار', langSel),
        field('طول تکه در حالت زنده (ثانیه)', liveChunk)
      ]),
      el('p', {
        class: 'hint',
        text: 'تکهٔ کوتاه‌تر یعنی متن زودتر ظاهر می‌شود، ولی مدل بافت کمتری دارد و ' +
              'بیشتر اشتباه می‌کند. پانزده ثانیه تعادل خوبی است.'
      }),
      field('واژه‌نامه — نام‌ها و اصطلاحاتی که مدام غلط شنیده می‌شوند', glossary),
      el('p', {
        class: 'hint',
        text: 'فقط فهرست اسم بنویسید، نه جملهٔ کامل. مدل هرچه اینجا ببیند ممکن است ' +
              'روی صدای ضعیف ادامه‌اش بدهد، و جملهٔ کامل یعنی متنی که شما نگفته‌اید.'
      }),
      el('label', { class: 'check' }, [
        ctxCheck, 'متن قبلی را به‌عنوان بافت بفرست (دقت مرزها بهتر، ولی خطر ساختن متن نگفته)'
      ])
    ]));

    /* --- OpenRouter: اختیاری، فقط برای ویرایش متن --- */
    var oInput = el('input', {
      type: 'password', value: App.store.apiKey(),
      placeholder: 'sk-or-v1-…', autocomplete: 'off', spellcheck: 'false'
    });
    var textModel = el('input', { type: 'text', value: s.textModel });
    textModel.addEventListener('change', function () {
      App.store.setSetting('textModel', textModel.value.trim());
    });
    var autoCheck = el('input', { type: 'checkbox', checked: s.autoPolish });
    autoCheck.addEventListener('change', function () {
      App.store.setSetting('autoPolish', autoCheck.checked);
    });

    root.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'کلید OpenRouter — اختیاری' }),
      el('p', {
        class: 'hint',
        text: 'فقط برای دکمهٔ «ویرایش و نقطه‌گذاری». مدل‌های متنی رایگان OpenRouter ' +
              'بدون هیچ موجودی کار می‌کنند. بدون این کلید، بقیهٔ اپ کامل کار می‌کند.'
      }),
      field('کلید', oInput),
      field('مدل ویرایش متن', textModel),
      el('label', { class: 'check' }, [autoCheck, 'بعد از رونویسی فایل، متن را خودکار ویرایش کن']),
      el('div', { class: 'row', style: 'margin-top:12px' }, [
        btn('ذخیره', {
          icon: 'check',
          onClick: function () { App.store.apiKey(oInput.value); toast('ذخیره شد.', 'ok'); }
        }),
        btn('حذف', {
          icon: 'trash', variant: 'ghost',
          onClick: function () { App.store.apiKey(null); oInput.value = ''; }
        })
      ])
    ]));

    /* --- پوسته --- */
    var themeSel = el('select', {}, [
      el('option', { value: 'system', text: 'مطابق سیستم', selected: s.theme === 'system' }),
      el('option', { value: 'light', text: 'روشن', selected: s.theme === 'light' }),
      el('option', { value: 'dark', text: 'تاریک', selected: s.theme === 'dark' })
    ]);
    themeSel.addEventListener('change', function () { applyTheme(themeSel.value); });
    root.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'ظاهر' }), field('پوسته', themeSel)
    ]));

    return root;
  }

  /* ================= چیدمان کلی ================= */

  var TABS = [
    { id: 'live', label: 'گفتار زنده', render: renderLive },
    { id: 'file', label: 'فایل صوتی', render: renderFile },
    { id: 'archive', label: 'بایگانی', render: renderArchive },
    { id: 'settings', label: 'تنظیمات', render: renderSettings }
  ];

  function render() {
    var host = $('#app');
    if (!host) return;
    App.dom.clear(host);

    var head = el('div', { class: 'top' }, [
      el('div', { class: 'brand' }, [
        el('div', { class: 'logo', html: icon('mic', 21) }),
        el('div', {}, [
          el('h1', { text: 'ایجنت ویس فارسی' }),
          el('div', { class: 'sub', text: 'گفتار فارسی به متن — زنده و از روی فایل' })
        ])
      ]),
      el('div', { class: 'spacer' }),
      btn('', {
        icon: 'sun', variant: 'ghost', title: 'تغییر پوسته',
        onClick: function () {
          var cur = App.store.settings().theme;
          var next = cur === 'dark' ? 'light' : (cur === 'light' ? 'system' : 'dark');
          applyTheme(next);
          toast('پوسته: ' + ({ dark: 'تاریک', light: 'روشن', system: 'مطابق سیستم' })[next]);
        }
      })
    ]);

    var tabs = el('div', { class: 'tabs', role: 'tablist' });
    TABS.forEach(function (t) {
      tabs.appendChild(el('button', {
        class: 'tab', role: 'tab', text: t.label,
        'aria-selected': String(state.tab === t.id),
        onclick: function () {
          // وسط ضبط، جابه‌جایی زبانه ضبط را قطع می‌کند
          if (state.rec && state.rec.running) { toast('اول ضبط را متوقف کنید.', 'err'); return; }
          state.tab = t.id;
          render();
        }
      }));
    });

    var body = el('div', { id: 'tab-body' });
    var tab = TABS.filter(function (t) { return t.id === state.tab; })[0] || TABS[0];
    tab.render(body);

    host.appendChild(head);
    host.appendChild(tabs);
    host.appendChild(body);

    // اولین بار: اگر کلیدی نیست، کاربر را مستقیم ببر سراغ تنظیمات
    if (!App.store.groqKey() && state.tab === 'live' && !state._nagged) {
      state._nagged = true;
      toast('برای شروع، کلید Groq را در زبانهٔ تنظیمات وارد کنید.');
    }
  }

  App.ui = {
    boot: function () {
      captureHostTheme();
      applyTheme(App.store.settings().theme);
      if (!$('#toasts')) document.body.appendChild(el('div', { id: 'toasts' }));
      render();
    },
    render: render,
    toast: toast,
    applyTheme: applyTheme,
    isRecording: function () { return !!(state.rec && state.rec.running); }
  };

})(window.App = window.App || {});
