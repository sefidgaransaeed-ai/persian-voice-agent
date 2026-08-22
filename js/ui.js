/* همهٔ نماها، فرم‌ها و وضعیت رابط کاربری. تنها ماژولی که DOM را در دست دارد. */
(function (App) {
  'use strict';

  var el = App.dom.el, $ = App.dom.$, fmt = App.fmt;
  var cfg = App.config;

  var state = {
    tab: 'live',
    live: null,
    liveText: '',
    liveBlob: null,
    fileBusy: false,
    hostTheme: null
  };

  /* ——— آیکون‌ها: SVG درجا، بدون هیچ فونت آیکون بیرونی ——— */
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
    // پیام یکسان در فاصلهٔ کوتاه تکرار نمی‌شود؛ یک خطای پیاپی نباید صفحه را پر کند
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
    return el('span', { class: 'badge ' + kind }, [
      el('span', { class: 'dot' }), text
    ]);
  }
  function btn(label, opts) {
    opts = opts || {};
    var b = el('button', {
      class: 'btn' + (opts.variant ? ' ' + opts.variant : ''),
      type: 'button',
      onclick: opts.onClick,
      disabled: opts.disabled,
      title: opts.title
    });
    if (opts.icon) {
      var i = el('span', { html: icon(opts.icon) });
      i.style.display = 'inline-flex';
      b.appendChild(i);
    }
    // فاصلهٔ بین دو عنصر درون‌خطی جمع می‌شود؛ gap در CSS این را حل کرده
    b.appendChild(document.createTextNode(label));
    return b;
  }
  function field(labelText, control) {
    return el('label', { class: 'field' }, [el('span', { text: labelText }), control]);
  }

  /* ================= زبانهٔ گفتار زنده ================= */

  function renderLive(root) {
    var supported = App.Live.supported();
    var onFile = location.protocol === 'file:';

    if (onFile) {
      root.appendChild(el('div', { class: 'note crit' }, [
        el('strong', { text: 'این صفحه با دابل‌کلیک باز شده. ' }),
        'مرورگرها دسترسی میکروفون را روی نشانی file:// نمی‌دهند. ' +
        'فایل serve.ps1 کنار همین پروژه را اجرا کنید و صفحه را از روی ' +
        'http://localhost:8787 باز کنید. رونویسی فایل صوتی از همین‌جا هم کار می‌کند.'
      ]));
    }
    if (!supported) {
      root.appendChild(el('div', { class: 'note crit' }, [
        el('strong', { text: 'مرورگر پشتیبانی نمی‌کند. ' }),
        'تشخیص گفتار زنده در Microsoft Edge و Google Chrome کار می‌کند. ' +
        'در Firefox موجود نیست.'
      ]));
    }

    var out = el('div', { class: 'out', id: 'live-out', 'aria-live': 'polite' });
    var stateLine = el('div', { class: 'mic-state', id: 'mic-state', text: 'آماده' });
    var micBtn = el('button', {
      class: 'mic', id: 'mic-btn', 'data-on': 'false',
      'aria-label': 'شروع ضبط', title: 'شروع / توقف',
      html: icon('mic', 40),
      disabled: !supported
    });

    var timer = null;
    function tick() {
      if (!state.live || !state.live.running) return;
      stateLine.textContent = 'در حال شنیدن…  ' + fmt.dur(state.live.elapsed());
    }

    function paint(finalText, interim) {
      App.dom.clear(out);
      if (finalText) out.appendChild(document.createTextNode(finalText));
      if (interim) {
        // یک فاصلهٔ صریح، چون فاصلهٔ بین دو عنصر درون‌خطی جمع می‌شود
        if (finalText) out.appendChild(document.createTextNode(' '));
        out.appendChild(el('span', { class: 'interim', text: interim }));
      }
      out.scrollTop = out.scrollHeight;
    }

    function stopUI() {
      micBtn.setAttribute('data-on', 'false');
      micBtn.innerHTML = icon('mic', 40);
      micBtn.setAttribute('aria-label', 'شروع ضبط');
      if (timer) { clearInterval(timer); timer = null; }
      out.setAttribute('contenteditable', 'true');
      out.setAttribute('spellcheck', 'false');
      refreshActions();
    }

    micBtn.addEventListener('click', function () {
      if (state.live && state.live.running) { state.live.stop(); return; }

      var live = new App.Live();
      state.live = live;
      state.liveText = '';
      state.liveBlob = null;
      out.removeAttribute('contenteditable');
      App.dom.clear(out);

      live.on.text = function (f, i) { state.liveText = f; paint(f, i); refreshActions(); };
      live.on.error = function (e) { toast(e.message, 'err'); };
      live.on.state = function (s) {
        if (s === 'running') {
          micBtn.setAttribute('data-on', 'true');
          micBtn.innerHTML = icon('stop', 34);
          micBtn.setAttribute('aria-label', 'توقف ضبط');
          timer = setInterval(tick, 500);
          tick();
        }
      };
      live.on.done = function (text, blob) {
        state.liveText = text;
        state.liveBlob = blob;
        paint(text, '');
        stateLine.textContent = text
          ? 'پایان.  ' + fmt.fa(text.trim().split(/\s+/).filter(Boolean).length) + ' کلمه ثبت شد.'
          : 'چیزی شنیده نشد.';
        stopUI();
        if (text) {
          App.store.addToArchive({
            title: 'گفتار زنده — ' + fmt.stamp(),
            text: text, source: 'live', model: 'Web Speech API (مرورگر)',
            seconds: live.elapsed()
          });
        }
      };

      live.start({ recordAudio: true, lang: cfg.LANG }).catch(function (e) {
        toast(e.message, 'err');
        stopUI();
      });
    });

    /* ——— دکمه‌های پس از ضبط ——— */
    var actions = el('div', { class: 'row', id: 'live-actions' });
    function currentText() {
      return (out.getAttribute('contenteditable') === 'true' ? out.innerText : state.liveText) || '';
    }
    function refreshActions() {
      App.dom.clear(actions);
      var has = !!currentText().trim();
      var busy = state.live && state.live.running;

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
        onClick: function () {
          App.file.download('گفتار-' + Date.now() + '.txt', currentText());
        }
      }));
      if (state.liveBlob) {
        actions.appendChild(btn('ذخیرهٔ صدا', {
          icon: 'down',
          onClick: function () {
            var ext = (state.liveBlob.type.indexOf('webm') !== -1) ? 'webm' : 'ogg';
            App.file.download('صدا-' + Date.now() + '.' + ext, state.liveBlob);
          }
        }));
      }
      actions.appendChild(btn('ویرایش و نقطه‌گذاری', {
        icon: 'wand', variant: 'primary', disabled: !has || busy,
        title: 'متن خام را با یک مدل متنی رایگان پاک‌نویس می‌کند (به کلید OpenRouter نیاز دارد)',
        onClick: function (ev) { polish(ev.currentTarget, currentText(), out); }
      }));
      actions.appendChild(btn('پاک کردن', {
        icon: 'trash', variant: 'ghost', disabled: !has || busy,
        onClick: function () {
          state.liveText = ''; state.liveBlob = null;
          App.dom.clear(out); stateLine.textContent = 'آماده'; refreshActions();
        }
      }));
    }
    out.addEventListener('input', refreshActions);

    root.appendChild(el('div', { class: 'card' }, [
      el('h2', { text: 'گفتار زندهٔ فارسی' }),
      el('p', {
        class: 'hint',
        text: 'دکمه را بزنید و فارسی حرف بزنید. متن هم‌زمان نوشته می‌شود. ' +
              'این بخش از موتور تشخیص گفتار خودِ مرورگر استفاده می‌کند: رایگان، بدون سقف و بدون کلید API.'
      }),
      el('div', { class: 'mic-wrap' }, [micBtn, stateLine]),
      out,
      el('div', { style: 'height:12px' }),
      actions
    ]));

    refreshActions();
    return root;
  }

  /* ——— پاک‌نویس با مدل متنی (روی سطح رایگان کار می‌کند) ——— */
  function polish(button, text, target) {
    var key = App.store.apiKey();
    if (!key) {
      toast('برای این کار کلید OpenRouter لازم است. در زبانهٔ تنظیمات واردش کنید.', 'err');
      return;
    }
    var old = button.textContent;
    button.disabled = true;
    button.lastChild.textContent = 'در حال ویرایش…';

    App.or.polish(text, {
      key: key,
      model: App.store.settings().textModel,
      onNotice: function (m) { toast(m); }
    }).then(function (clean) {
      if (!clean) throw new Error('مدل پاسخ خالی داد.');
      target.textContent = clean;
      state.liveText = clean;
      toast('متن ویرایش شد.', 'ok');
    }).catch(function (e) {
      toast(e.message, 'err');
    }).then(function () {
      button.disabled = false;
      button.lastChild.textContent = old.trim() ? old : ' ویرایش و نقطه‌گذاری';
    });
  }

  /* ================= زبانهٔ فایل صوتی ================= */

  function renderFile(root) {
    root.appendChild(el('div', { class: 'note' }, [
      el('strong', { text: 'وضعیت: نیازمند اعتبار. ' }),
      'آزمایش شد: OpenRouter ارسال صدا را برای حساب‌های با موجودی صفر مسدود می‌کند و ' +
      'خطای «at least $0.50 in balance for audio» می‌دهد — حتی برای مدل رایگان و حتی برای ' +
      'فایل دو ثانیه‌ای. این محدودیت به مدل ربطی ندارد، به موجودی حساب مربوط است. ' +
      'به‌محض شارژ حساب، همین بخش بدون تغییر کد کار می‌کند.'
    ]));

    var picked = null;
    var input = el('input', {
      type: 'file', accept: 'audio/*,video/*', class: 'hidden', id: 'file-input'
    });
    var drop = el('div', {
      class: 'drop', tabindex: '0', role: 'button',
      'aria-label': 'انتخاب فایل صوتی'
    }, [
      el('div', { html: icon('file', 30) }),
      el('div', { class: 'big-t', text: 'فایل صوتی را اینجا رها کنید' }),
      el('div', { class: 'small-t', text: 'یا کلیک کنید. mp3، wav، m4a، ogg، webm و صدای ویدیو' })
    ]);

    var info = el('div', { class: 'stage', id: 'file-info' });
    var bar = el('div', { class: 'bar' }, [el('i')]);
    var stage = el('div', { class: 'stage', id: 'file-stage' });
    var out = el('div', { class: 'out', id: 'file-out' });
    var actions = el('div', { class: 'row' });

    function setProgress(p) { bar.firstChild.style.width = Math.round(p * 100) + '%'; }

    function choose(f) {
      if (!f) return;
      picked = f;
      App.dom.clear(info);
      info.appendChild(document.createTextNode(f.name + ' — ' + fmt.bytes(f.size)));
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
        icon: 'wand', variant: 'primary', disabled: !picked || state.fileBusy,
        onClick: run
      }));
      if (state.fileBusy) {
        actions.appendChild(btn('لغو', {
          variant: 'danger',
          onClick: function () { App.transcribe.cancel(); }
        }));
      }
      var has = !!out.textContent.trim();
      actions.appendChild(btn('رونوشت', {
        icon: 'copy', disabled: !has || state.fileBusy,
        onClick: function () {
          navigator.clipboard.writeText(out.innerText)
            .then(function () { toast('متن رونوشت شد.', 'ok'); });
        }
      }));
      actions.appendChild(btn('ذخیرهٔ متن', {
        icon: 'down', disabled: !has || state.fileBusy,
        onClick: function () {
          App.file.download(App.file.stem(picked ? picked.name : 'متن') + '.txt', out.innerText);
        }
      }));
    }

    function run() {
      var key = App.store.apiKey();
      if (!key) {
        toast('اول کلید OpenRouter را در تنظیمات وارد کنید.', 'err');
        return;
      }
      var s = App.store.settings();
      state.fileBusy = true;
      App.dom.clear(out);
      setProgress(0);
      refresh();

      App.transcribe.file(picked, {
        key: key,
        model: s.model,
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
        if (s.autoPolish && res.text) {
          stage.textContent = 'در حال ویرایش و نقطه‌گذاری…';
          return App.or.polish(res.text, { key: key, model: s.textModel })
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
        text: 'فایل به صورت خودکار به WAV تک‌کاناله ۱۶ کیلوهرتز تبدیل، در صورت نیاز تکه‌تکه ' +
              'و به مدل انتخابی فرستاده می‌شود. همه‌چیز داخل مرورگر شما انجام می‌شود.'
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
              navigator.clipboard.writeText(r.text)
                .then(function () { toast('رونوشت شد.', 'ok'); });
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

    /* --- کلید --- */
    var keyInput = el('input', {
      type: 'password', id: 'api-key', value: App.store.apiKey(),
      placeholder: 'sk-or-v1-…', autocomplete: 'off', spellcheck: 'false'
    });
    var keyStatus = el('div', { class: 'stage' });

    var keyCard = el('div', { class: 'card' }, [
      el('h2', { text: 'کلید OpenRouter' }),
      el('p', {
        class: 'hint',
        text: 'کلید فقط در حافظهٔ همین مرورگر ذخیره می‌شود و هیچ‌جای دیگری نمی‌رود. ' +
              'گفتار زنده به کلید نیاز ندارد؛ کلید فقط برای رونویسی فایل و ویرایش متن لازم است.'
      }),
      field('کلید', keyInput),
      el('div', { class: 'row' }, [
        btn('ذخیره', {
          icon: 'check', variant: 'primary',
          onClick: function () {
            App.store.apiKey(keyInput.value);
            toast('کلید ذخیره شد.', 'ok');
          }
        }),
        btn('بررسی اعتبار', {
          icon: 'key',
          onClick: function () {
            var k = keyInput.value.trim();
            if (!k) { toast('کلید خالی است.', 'err'); return; }
            keyStatus.textContent = 'در حال بررسی…';
            App.or.keyInfo(k).then(function (d) {
              App.dom.clear(keyStatus);
              var free = d.is_free_tier;
              keyStatus.appendChild(badge(free ? 'warn' : 'good',
                free ? 'حساب رایگان — ارسال صدا مسدود است' : 'حساب دارای اعتبار — صدا فعال است'));
              var bits = [];
              if (d.limit !== null && d.limit !== undefined) {
                bits.push('سقف کلید: ' + fmt.num(d.limit, 2) + ' دلار');
              }
              bits.push('مصرف تاکنون: ' + fmt.num(d.usage || 0, 4) + ' دلار');
              if (d.expires_at) bits.push('انقضا: ' + fmt.stamp(new Date(d.expires_at)));
              keyStatus.appendChild(el('div', { style: 'margin-top:6px', text: bits.join('  •  ') }));
            }).catch(function (e) {
              App.dom.clear(keyStatus);
              keyStatus.appendChild(badge('crit', e.message));
            });
          }
        }),
        btn('حذف کلید', {
          icon: 'trash', variant: 'ghost',
          onClick: function () {
            App.store.apiKey(null); keyInput.value = '';
            App.dom.clear(keyStatus);
            toast('کلید حذف شد.');
          }
        })
      ]),
      keyStatus
    ]);

    /* --- مدل‌ها --- */
    var modelSel = el('select', { id: 'model-sel' }, [
      el('option', { value: s.model, text: s.model, selected: true })
    ]);
    modelSel.addEventListener('change', function () {
      App.store.setSetting('model', modelSel.value);
    });

    // فهرست را زنده از OpenRouter می‌گیریم تا با اضافه شدن مدل صوتی جدید، اپ خودش به‌روز شود
    App.or.listAudioModels().then(function (models) {
      App.dom.clear(modelSel);
      models.forEach(function (m) {
        var price = m.free ? 'رایگان' : ('$' + m.price.toFixed(6) + ' هر توکن صدا');
        modelSel.appendChild(el('option', {
          value: m.id, text: m.name + ' — ' + price, selected: m.id === s.model
        }));
      });
      if (!models.some(function (m) { return m.id === s.model; })) {
        modelSel.appendChild(el('option', { value: s.model, text: s.model, selected: true }));
      }
    }).catch(function () {
      // آفلاین یا خطای شبکه: همان مقدار ذخیره‌شده می‌ماند
    });

    var textSel = el('input', { type: 'text', value: s.textModel });
    textSel.addEventListener('change', function () {
      App.store.setSetting('textModel', textSel.value.trim());
    });

    var chunkInput = el('input', {
      type: 'number', min: '15', max: '600', step: '15', value: String(s.chunkSeconds)
    });
    chunkInput.addEventListener('change', function () {
      App.store.setSetting('chunkSeconds', Number(chunkInput.value) || cfg.CHUNK_SECONDS);
    });

    var autoCheck = el('input', { type: 'checkbox', checked: s.autoPolish });
    autoCheck.addEventListener('change', function () {
      App.store.setSetting('autoPolish', autoCheck.checked);
    });

    var modelCard = el('div', { class: 'card' }, [
      el('h2', { text: 'مدل‌ها' }),
      el('p', { class: 'hint', text: 'فهرست مدل‌های صوتی زنده از OpenRouter خوانده می‌شود.' }),
      el('div', { class: 'grid' }, [
        field('مدل رونویسی صدا', modelSel),
        field('مدل ویرایش متن', textSel),
        field('طول هر تکه (ثانیه)', chunkInput)
      ]),
      el('label', { class: 'check' }, [autoCheck, 'بعد از رونویسی، متن را خودکار ویرایش و نقطه‌گذاری کن'])
    ]);

    /* --- پوسته --- */
    var themeSel = el('select', {}, [
      el('option', { value: 'system', text: 'مطابق سیستم', selected: s.theme === 'system' }),
      el('option', { value: 'light', text: 'روشن', selected: s.theme === 'light' }),
      el('option', { value: 'dark', text: 'تاریک', selected: s.theme === 'dark' })
    ]);
    themeSel.addEventListener('change', function () { applyTheme(themeSel.value); });

    var themeCard = el('div', { class: 'card' }, [
      el('h2', { text: 'ظاهر' }),
      field('پوسته', themeSel)
    ]);

    root.appendChild(keyCard);
    root.appendChild(modelCard);
    root.appendChild(themeCard);
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
          if (state.live && state.live.running) {
            toast('اول ضبط را متوقف کنید.', 'err');
            return;
          }
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
    isRecording: function () { return !!(state.live && state.live.running); }
  };

})(window.App = window.App || {});
