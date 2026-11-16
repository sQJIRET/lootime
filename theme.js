(function () {
  var root = document.documentElement;
  function get() {
    try { var v = localStorage.getItem('theme'); if (v) return v; } catch (e) {}
    var m = document.cookie.match(/(?:^|; )theme=(light|dark)/);
    return m ? m[1] : null;
  }
  function set(v) {
    try { localStorage.setItem('theme', v); } catch (e) {}
    document.cookie = 'theme=' + v + '; path=/; max-age=31536000; SameSite=Lax';
  }
  var t = get();
  if (t !== 'dark' && t !== 'light') t = 'light'; // по умолчанию светлая, дальше запоминаем выбор
  root.setAttribute('data-theme', t);
  document.addEventListener('DOMContentLoaded', function () {
    var path = location.pathname.replace(/\/+$/, '');
    var cur = path === '/rules' || path === '/rules.html' ? 'rules' : (path === '/contacts' || path === '/contacts.html' ? 'contacts' : (location.hash === '#shop' ? 'shop' : 'home'));
    var a = document.querySelector('nav a[data-nav="' + cur + '"]');
    if (a) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
    var b = document.getElementById('themeBtn');
    if (!b) return;
    b.addEventListener('click', function () {
      var n = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', n);
      set(n);
    });
  });
})();
