/* ابزارهای پایه: ساخت DOM، شکل‌دهی عدد فارسی، دانلود فایل */
(function (App) {
  'use strict';

  var FA = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  App.dom = {
    el: function (tag, attrs, children) {
      var n = document.createElement(tag);
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          var v = attrs[k];
          if (v === null || v === undefined || v === false) return;
          if (k === 'class') n.className = v;
          else if (k === 'text') n.textContent = v;
          else if (k === 'html') n.innerHTML = v;
          else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
          else n.setAttribute(k, v === true ? '' : v);
        });
      }
      App.dom.append(n, children);
      return n;
    },
    append: function (node, children) {
      if (children === null || children === undefined) return node;
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' || typeof c === 'number'
          ? document.createTextNode(String(c)) : c);
      });
      return node;
    },
    clear: function (node) { while (node.firstChild) node.removeChild(node.firstChild); return node; },
    $: function (sel, root) { return (root || document).querySelector(sel); }
  };

  App.fmt = {
    // ارقام لاتین را به فارسی برمی‌گرداند تا در متن راست‌به‌چپ جا بیفتد
    fa: function (v) {
      return String(v).replace(/[0-9]/g, function (d) { return FA[+d]; });
    },
    num: function (n, digits) {
      var s = (typeof digits === 'number') ? Number(n).toFixed(digits) : String(n);
      return App.fmt.fa(s);
    },
    // ثانیه → «۱:۲۳:۴۵» یا «۲:۰۵»
    dur: function (sec) {
      sec = Math.max(0, Math.round(sec));
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
      var pad = function (x) { return x < 10 ? '0' + x : String(x); };
      return App.fmt.fa(h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s));
    },
    bytes: function (b) {
      var u = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'], i = 0;
      while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
      return App.fmt.num(b, i === 0 ? 0 : 1) + ' ' + u[i];
    },
    stamp: function (d) {
      d = d || new Date();
      try {
        return new Intl.DateTimeFormat('fa-IR', {
          dateStyle: 'medium', timeStyle: 'short'
        }).format(d);
      } catch (e) { return d.toLocaleString(); }
    }
  };

  App.file = {
    download: function (name, content, mime) {
      var blob = content instanceof Blob ? content
        : new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = App.dom.el('a', { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    },
    // نامِ فایل بدون پسوند، برای ساختن نام خروجی
    stem: function (name) { return String(name).replace(/\.[^.]+$/, ''); }
  };

  App.sleep = function (ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  };

})(window.App = window.App || {});
