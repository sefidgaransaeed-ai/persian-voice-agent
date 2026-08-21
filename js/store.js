/* ماندگاری در localStorage — کلید API، تنظیمات و بایگانی رونوشت‌ها */
(function (App) {
  'use strict';

  var K_KEY = 'fa-voice.apiKey';
  var K_SET = 'fa-voice.settings';
  var K_ARC = 'fa-voice.archive';

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  var DEFAULTS = {
    model: App.config.DEFAULT_MODEL,
    textModel: App.config.TEXT_MODEL,
    chunkSeconds: App.config.CHUNK_SECONDS,
    autoPolish: false,
    theme: 'system'
  };

  App.store = {
    apiKey: function (v) {
      if (v === undefined) return read(K_KEY, '');
      if (v === null) { localStorage.removeItem(K_KEY); return ''; }
      write(K_KEY, String(v).trim());
      return String(v).trim();
    },

    settings: function () {
      var s = read(K_SET, {});
      var out = {};
      Object.keys(DEFAULTS).forEach(function (k) {
        out[k] = (s && s[k] !== undefined) ? s[k] : DEFAULTS[k];
      });
      return out;
    },
    setSetting: function (k, v) {
      var s = App.store.settings();
      s[k] = v;
      write(K_SET, s);
      return s;
    },

    archive: function () { return read(K_ARC, []); },
    addToArchive: function (entry) {
      var list = App.store.archive();
      list.unshift({
        id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6),
        title: entry.title || 'بدون عنوان',
        text: entry.text || '',
        source: entry.source || 'file',
        model: entry.model || '',
        seconds: entry.seconds || 0,
        at: new Date().toISOString()
      });
      // بایگانی را کوتاه نگه می‌داریم؛ localStorage سقف چندمگابایتی دارد
      write(K_ARC, list.slice(0, 50));
      return list;
    },
    removeFromArchive: function (id) {
      var list = App.store.archive().filter(function (r) { return r.id !== id; });
      write(K_ARC, list);
      return list;
    },
    clearArchive: function () { localStorage.removeItem(K_ARC); return []; }
  };

})(window.App = window.App || {});
