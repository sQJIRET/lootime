/* Общий подвал для всех страниц сайта. Ссылки и способы оплаты меняются здесь. */
(function () {
  var LINKS = {
    discord: 'https://discord.gg/emdcZRzS5x',
    telegram: 'https://t.me/loontime_pro',
    privacy: 'https://telegra.ph/Politika-konfidencialnosti-08-01-83',
    terms: 'https://telegra.ph/Polzovatelskoe-soglashenie-08-01-39',
  };
  var PAY = [
    { title: 'СБП', icon: '<img src="/img/sbp.png" alt="" width="22" height="22">' },
    { title: 'Карты РФ', icon: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="3" fill="#fff"/><path d="M2 12h20v4a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="#d52b1e"/><path d="M2 9h20v3H2z" fill="#0039a6"/><rect x="2" y="5" width="20" height="14" rx="3" fill="none" stroke="#c9ccd6"/></svg>' },
    { title: 'Криптовалюта', icon: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#26a17b"/><path d="M6.5 7h11v2.2h-4.4V10c2.6.1 4.4.7 4.4 1.5s-1.8 1.4-4.4 1.5V17h-2.2v-4c-2.6-.1-4.4-.7-4.4-1.5S8.3 10.1 10.9 10V9.2H6.5z" fill="#fff"/></svg>' },
  ];
  var DISCORD = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>';
  var TG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21.5 3.6 2.7 10.9c-1.3.5-1.2 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.1.8.7.8.5 0 .7-.2 1-.5l2.3-2.3 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.8c.3-1.3-.5-1.9-1.2-1.8zM8.3 13.5l9.7-6.1c.5-.3.9-.1.5.2l-8 7.2-.3 3.4z"/></svg>';

  var f = document.createElement('footer');
  f.className = 'site-footer';
  f.innerHTML =
    '<div class="wrap sf-grid">' +
      '<div class="sf-col sf-brand">' +
        '<a class="sf-logo" href="/"><img src="/img/logo.png" alt="" width="32" height="32"><span>Loontime</span></a>' +
        '<div class="sf-copy">© ' + new Date().getFullYear() + ' Loontime</div>' +
        '<div class="sf-pay-title">Способы оплаты</div>' +
        '<div class="sf-pay">' + PAY.map(function (p) {
          return '<span class="sf-chip" title="' + p.title + '">' + p.icon + '<span>' + p.title + '</span></span>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="sf-col"><h4>Правовое</h4>' +
        '<a href="' + LINKS.terms + '" target="_blank" rel="noopener noreferrer">Соглашение</a>' +
        '<a href="' + LINKS.privacy + '" target="_blank" rel="noopener noreferrer">Конфиденциальность</a>' +
      '</div>' +
      '<div class="sf-col"><h4>Связаться</h4>' +
        '<a href="' + LINKS.discord + '" target="_blank" rel="noopener noreferrer">' + DISCORD + 'Discord</a>' +
        '<a href="' + LINKS.telegram + '" target="_blank" rel="noopener noreferrer">' + TG + 'Telegram</a>' +
        '<a href="/contacts">Все контакты</a>' +
      '</div>' +
    '</div>' +
    '<div class="wrap sf-note" id="refund"></div>';
  var s = document.currentScript;
  if (s && s.parentNode) s.parentNode.insertBefore(f, s); else document.body.appendChild(f);
})();
