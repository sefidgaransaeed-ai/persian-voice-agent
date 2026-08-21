/* راه‌اندازی و اتصال‌های سراسری */
(function (App) {
  'use strict';

  function boot() {
    try {
      App.ui.boot();
    } catch (e) {
      var host = document.getElementById('app');
      if (host) {
        host.innerHTML = '<div class="note crit"><strong>اپ بالا نیامد. </strong>' +
          String(e && e.message ? e.message : e) + '</div>';
      }
      throw e;
    }
  }

  // بستن ناگهانی صفحه وسط ضبط یعنی از دست رفتن متن
  window.addEventListener('beforeunload', function (e) {
    if (App.ui && App.ui.isRecording && App.ui.isRecording()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window.App = window.App || {});
