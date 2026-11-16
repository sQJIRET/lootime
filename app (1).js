(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n) + ' ₽';

  /** Создать элемент с текстом (без innerHTML, чтобы не было XSS). */
  function el(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'style') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const kid of kids) e.append(kid);
    return e;
  }

  const state = { shop: null, category: null, cart: [], method: null, promo: null };
  const CART_KEY = 'lt_cart_v1';
  const NS = 'http://www.w3.org/2000/svg';

  /** Иконки способов оплаты (инлайн SVG, чтобы не зависеть от внешних картинок). */
  const ICONS = {
    card: '<svg viewBox="0 0 24 24" width="30" height="30"><rect x="2" y="5" width="20" height="14" rx="3" fill="#3b6fe0"/><rect x="2" y="9" width="20" height="3" fill="#cfe0ff"/><rect x="5" y="14.5" width="6" height="1.8" rx=".9" fill="#cfe0ff"/></svg>',
    ru: '<svg viewBox="0 0 24 24" width="30" height="30"><rect x="2" y="5" width="20" height="14" rx="3" fill="#fff"/><path d="M2 12h20v4a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="#d52b1e"/><path d="M2 9h20v3H2z" fill="#0039a6"/><rect x="2" y="5" width="20" height="14" rx="3" fill="none" stroke="#c9ccd6"/></svg>',
    world: '<svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="10" fill="#3b6fe0"/><path d="M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20M2 12h20M4 7h16M4 17h16" stroke="#cfe0ff" stroke-width="1.2" fill="none"/></svg>',
    crypto: '<svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="11" fill="#26a17b"/><path d="M6.5 7h11v2.2h-4.4V10c2.6.1 4.4.7 4.4 1.5s-1.8 1.4-4.4 1.5V17h-2.2v-4c-2.6-.1-4.4-.7-4.4-1.5S8.3 10.1 10.9 10V9.2H6.5z" fill="#fff"/></svg>',
  };
  const METHOD_META = {
    2: { title: 'СБП', sub: 'Перевод по QR-коду', img: '/img/sbp.png' },
    10: { title: 'Российские карты', sub: 'Карты банков РФ', icon: 'ru' },
    11: { title: 'Банковская карта', sub: 'Visa, Mastercard, МИР', icon: 'card' },
    12: { title: 'Весь мир · Apple/Google Pay', sub: 'Visa, Mastercard, Apple Pay, Google Pay', icon: 'world' },
    13: { title: 'Криптовалюта', sub: 'USDT, LTC и другие', icon: 'crypto' },
  };

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  async function api(path, opts) {
    const r = await fetch(path, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Ошибка ' + r.status);
    return data;
  }

  function safeUrl(u) {
    return /^https?:\/\//i.test(u || '') ? u : '';
  }

  /** Картинка товара: полная ссылка http(s) или файл с этого же сайта (/img/...). */
  function imgUrl(u) {
    u = String(u || '');
    return /^\/(?!\/)[\w\-./]+$/.test(u) ? u : safeUrl(u);
  }

  function renderHeader(s) {
    document.title = s.shop_name + ' — магазин';
    $('brand').textContent = s.shop_name;
    $('title').textContent = s.shop_name;
    $('tagline').textContent = s.tagline;
    if (s.server_ip) {
      const ip = $('ip');
      ip.dataset.ip = s.server_ip;
      ip.querySelector('.ip-text').textContent = s.server_ip;
    }
    if ($('refund')) $('refund').textContent = s.refund_info;
  }

  // постоянные разделы (показываются, даже если в них пока нет товаров)
  const SECTIONS = ['Привилегии', 'Кейсы', 'Валюта', 'Другое'];

  function renderTabs() {
    const extra = state.shop.products.map((p) => p.category).filter((c) => !SECTIONS.includes(c));
    const cats = [...SECTIONS, ...new Set(extra)];
    const tabs = $('tabs');
    tabs.replaceChildren();
    for (const c of [null, ...cats]) {
      tabs.append(
        el('button', { class: 'tab' + (state.category === c ? ' on' : ''), onclick: () => { state.category = c; renderTabs(); renderGrid(); } }, c ?? 'Все'),
      );
    }
  }

  function renderGrid() {
    const grid = $('grid');
    grid.replaceChildren();
    const list = state.shop.products.filter((p) => !state.category || p.category === state.category);
    // в «Все»: сначала привилегии, потом кейсы, валюта (токены) и «Другое»; внутри раздела — порядок из админки
    const secRank = (c) => { const i = SECTIONS.indexOf(c); return i < 0 ? SECTIONS.length : i; };
    if (!state.category) list.sort((a, b) => secRank(a.category) - secRank(b.category));
    $('empty').hidden = list.length > 0;
    $('empty').textContent = state.category ? 'В разделе «' + state.category + '» пока нет товаров.' : 'Товаров пока нет.';
    // товары одной привилегии с разными сроками склеиваем в одну карточку
    const PERIOD_ORDER = ['30 дней', '90 дней', 'Навсегда'];
    const seen = new Map();
    const cards = [];
    for (const p of list) {
      if (!p.group_name) { cards.push([p]); continue; }
      if (!seen.has(p.group_name)) { const g = []; seen.set(p.group_name, g); cards.push(g); }
      seen.get(p.group_name).push(p);
    }
    for (const g of cards) {
      if (g.length > 1) g.sort((x, y) => PERIOD_ORDER.indexOf(x.period) - PERIOD_ORDER.indexOf(y.period));
      grid.append(productCard(g));
    }
  }

  function productCard(variants) {
    let cur = variants[0];
    const grouped = variants.length > 1;
    const card = el('div', { class: 'card' });
    const paint = () => {
      const p = cur;
      const img = imgUrl(p.image_url);
      const imgEl = el('div', { class: 'img' + (img.startsWith('/') ? ' contain' : ''), style: img ? { backgroundImage: `url("${encodeURI(img)}")` } : {} }, img ? '' : '🎁');
      const periods = grouped
        ? el('div', { class: 'periods' }, ...variants.map((v) =>
            el('button', { type: 'button', class: 'period' + (v === cur ? ' on' : ''), onclick: () => { cur = v; paint(); } }, v.period)))
        : '';
      card.replaceChildren(
        imgEl,
        el('div', { class: 'body' },
          el('h3', {}, grouped ? p.group_name : p.name),
          el('div', { class: 'desc' }, p.description),
          infoButton(p),
          periods,
          el('div', { class: 'price' }, fmt(p.price), p.allow_qty ? el('small', {}, ' за ' + (p.unit || 'шт.')) : ''),
          addButton(p),
        ),
      );
    };
    paint();
    return card;
  }

  // ---------------------------------------------------------------- корзина

  /** Сумма строки: цена указана за price_per единиц (для токенов — за 1000). */
  const lineSum = (p, qty) => Math.round((p.price * qty * 100) / (p.price_per || 1)) / 100;
  const stepOf = (p) => (p.price_per > 1 ? p.price_per : 1);
  const findProduct = (id) => state.shop.products.find((p) => p.id === id);
  const inCart = (id) => state.cart.find((l) => l.id === id);

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
    } catch {
      /* приватный режим */
    }
  }

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      state.cart = raw
        .filter((l) => findProduct(Number(l.id)))
        .map((l) => {
          const p = findProduct(Number(l.id));
          const q = p.allow_qty ? Math.min(p.qty_max, Math.max(p.qty_min, Math.floor(Number(l.qty)) || p.qty_min)) : 1;
          return { id: p.id, qty: q };
        });
    } catch {
      state.cart = [];
    }
  }

  /** Окно с полным описанием товара. */
  function openInfo(p) {
    const close = () => {
      bg.remove();
      document.removeEventListener('keydown', onKey);
      if (!$('sheetBg').classList.contains('show')) document.body.classList.remove('lock');
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const img = imgUrl(p.image_url);
    const unit = p.allow_qty ? ' за ' + (p.unit || 'шт.') : '';
    const bg = el('div', { class: 'info-bg', onclick: (e) => { if (e.target === bg) close(); } },
      el('div', { class: 'info', role: 'dialog', 'aria-modal': 'true' },
        el('button', { class: 'info-x', type: 'button', 'aria-label': 'Закрыть', onclick: close }, '×'),
        img ? el('div', { class: 'info-img', style: { backgroundImage: `url("${encodeURI(img)}")` } }) : '',
        el('h3', {}, p.name),
        el('div', { class: 'info-price' }, fmt(p.price), el('small', {}, unit)),
        el('div', { class: 'info-text' }, p.description),
        addButton(p),
      ),
    );
    document.body.append(bg);
    document.body.classList.add('lock');
    document.addEventListener('keydown', onKey);
  }

  /** Кнопка «Описание» (только если описание длинное). */
  function infoButton(p) {
    const long = (p.description || '').length > 70 || (p.description || '').includes('\n');
    if (!long) return '';
    return el('button', { class: 'more', type: 'button', onclick: () => openInfo(p) }, 'Описание ›');
  }

  function addButton(p) {
    const btn = el('button', { class: 'add', type: 'button' });
    const paint = () => {
      const on = Boolean(inCart(p.id));
      btn.textContent = on ? '✓ В корзине' : '+ В корзину';
      btn.classList.toggle('in', on);
    };
    btn.onclick = () => {
      if (inCart(p.id)) {
        openCart();
        return;
      }
      state.cart.push({ id: p.id, qty: p.allow_qty ? p.qty_min : 1 });
      saveCart();
      refreshCart();
      toast('«' + p.name + '» добавлен в корзину');
    };
    btn.paint = paint;
    paint();
    btn.dataset.pid = p.id;
    return btn;
  }

  function totals() {
    let sub = 0;
    for (const l of state.cart) sub += lineSum(findProduct(l.id), l.qty);
    const disc = state.promo ? Math.round(sub * state.promo.percent) / 100 : 0;
    return { sub, disc, total: sub - disc };
  }

  function refreshCart() {
    const count = state.cart.length;
    const badge = $('cartBadge');
    badge.hidden = count === 0;
    badge.textContent = count;
    document.querySelectorAll('button.add').forEach((b) => b.paint?.());
    renderCart();
  }

  function renderCart() {
    const empty = state.cart.length === 0;
    $('cartEmpty').hidden = !empty;
    $('cartFull').hidden = empty;
    $('sheetFoot').hidden = empty;
    if (empty) return;

    const box = $('cartItems');
    box.replaceChildren();
    for (const l of state.cart) {
      const p = findProduct(l.id);
      const img = imgUrl(p.image_url);
      const thumb = el('div', { class: 'thumb', style: img ? { backgroundImage: `url("${encodeURI(img)}")` } : {} }, img ? '' : '🎁');
      const priceEl = el('div', { class: 'ci-price' }, fmt(lineSum(p, l.qty)));
      const right = el('div', { class: 'ci-right' },
        priceEl,
        el('button', { class: 'soft rm', type: 'button', onclick: () => removeItem(p.id) }, 'Убрать'),
      );
      const info = el('div', { class: 'ci-info' }, el('div', { class: 'ci-name' }, p.name));
      if (p.allow_qty) {
        const input = el('input', { class: 'qty-in', type: 'number', min: p.qty_min, max: p.qty_max, step: 1, value: l.qty, inputmode: 'numeric' });
        // меняем число «на месте», без перерисовки: иначе нажатие на «+» после ввода терялось
        const clamp = (v) => Math.min(p.qty_max, Math.max(p.qty_min, Math.floor(Number(v)) || p.qty_min));
        const setQty = (v) => {
          const n = clamp(v);
          l.qty = n;
          input.value = n;
          priceEl.textContent = fmt(lineSum(p, n));
          saveCart();
          updateSummary();
        };
        input.addEventListener('input', () => {
          const n = Math.floor(Number(input.value));
          if (n >= p.qty_min && n <= p.qty_max) {
            l.qty = n;
            priceEl.textContent = fmt(lineSum(p, n));
            saveCart();
            updateSummary();
          }
        });
        input.addEventListener('change', () => setQty(input.value));
        info.append(
          el('div', { class: 'stepper' },
            el('button', { type: 'button', class: 'soft', onclick: () => setQty(Number(input.value) - stepOf(p)), 'aria-label': 'Меньше' }, '−'),
            input,
            el('button', { type: 'button', class: 'soft', onclick: () => setQty(Number(input.value) + stepOf(p)), 'aria-label': 'Больше' }, '+'),
          ),
          el('div', { class: 'ci-unit' }, fmt(p.price) + ' за ' + (p.unit || 'шт.') + (p.qty_min > 1 ? ' · минимум ' + new Intl.NumberFormat('ru-RU').format(p.qty_min) : '')),
        );
      }
      box.append(el('div', { class: 'cart-item' }, thumb, info, right));
    }

    // способы оплаты
    const wrap = $('methods');
    wrap.replaceChildren();
    if (!state.method || !state.shop.methods.some((m) => m.id === state.method)) state.method = state.shop.methods[0]?.id ?? null;
    for (const m of state.shop.methods) {
      const meta = METHOD_META[m.id] || { title: m.name, sub: '', icon: 'card' };
      const ic = el('span', { class: 'm-ic' });
      if (meta.img) ic.append(el('img', { src: meta.img, alt: '', width: 30, height: 30 }));
      else ic.innerHTML = ICONS[meta.icon] || ICONS.card; // статичный собственный SVG
      wrap.append(
        el('button', { type: 'button', class: 'method' + (state.method === m.id ? ' on' : ''), onclick: () => { state.method = m.id; renderCart(); } },
          ic,
          el('span', { class: 'm-tx' }, el('b', {}, meta.title), el('small', {}, meta.sub)),
        ),
      );
    }

    updateSummary();
  }

  /** Пересчитать итоги, не перерисовывая список товаров. */
  function updateSummary() {
    const t = totals();
    $('sSub').textContent = fmt(t.sub);
    $('sDiscRow').hidden = !state.promo;
    if (state.promo) {
      $('sPromo').textContent = state.promo.code + ' (−' + state.promo.percent + '%)';
      $('sDisc').textContent = '−' + fmt(t.disc);
    }
    $('sTotal').textContent = fmt(t.total);
    $('mPay').textContent = 'Оплатить ' + fmt(t.total);
    updatePayState();
  }

  function removeItem(id) {
    state.cart = state.cart.filter((l) => l.id !== id);
    saveCart();
    refreshCart();
  }

  function openCart() {
    $('mErr').textContent = '';
    $('nick').value = $('nick').value || localStorage.getItem('nick') || '';
    $('email').value = $('email').value || localStorage.getItem('email') || '';
    renderCart();
    $('sheetBg').classList.add('show');
    document.body.classList.add('lock');
  }

  function closeCart() {
    $('sheetBg').classList.remove('show');
    document.body.classList.remove('lock');
  }

  async function applyPromo() {
    const code = $('promo').value.trim();
    const msg = $('promoMsg');
    msg.className = 'promo-msg';
    if (!code) {
      state.promo = null;
      msg.textContent = '';
      renderCart();
      return;
    }
    try {
      const r = await api('/api/promo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      state.promo = { code: r.code, percent: r.percent };
      msg.className = 'promo-msg ok';
      msg.textContent = 'Промокод применён: скидка ' + r.percent + '%';
    } catch (e) {
      state.promo = null;
      msg.className = 'promo-msg bad';
      msg.textContent = e.message;
    }
    renderCart();
  }

  const NICK_RE = /^[A-Za-z0-9_.]{3,17}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /** Что мешает оплате: текст ошибки или '' если всё заполнено. */
  function payProblem() {
    if (!state.cart.length) return 'Корзина пуста';
    if (!NICK_RE.test($('nick').value.trim())) return 'Укажите ник: 3–16 символов, латинские буквы, цифры и _';
    if (!EMAIL_RE.test($('email').value.trim())) return 'Укажите корректный email для отправки чека';
    if (!$('consentPd').checked) return 'Отметьте согласие на обработку персональных данных';
    if (!$('consentTerms').checked) return 'Отметьте принятие Пользовательского соглашения';
    return '';
  }

  /** Кнопка «Оплатить» активна, только когда всё заполнено и оба согласия отмечены. */
  function updatePayState() {
    $('mPay').disabled = Boolean(payProblem());
    $('mErr').textContent = '';
    for (const id of ['consentPd', 'consentTerms']) $(id).closest('.consent').classList.remove('bad');
  }

  async function pay() {
    const nick = $('nick').value.trim();
    const email = $('email').value.trim();
    $('mErr').textContent = '';
    const problem = payProblem();
    if (problem) {
      $('mErr').textContent = problem;
      for (const id of ['consentPd', 'consentTerms']) $(id).closest('.consent').classList.toggle('bad', !$(id).checked);
      return;
    }
    $('mPay').disabled = true;
    try {
      try {
        localStorage.setItem('nick', nick);
        localStorage.setItem('email', email);
      } catch {
        /* ignore */
      }
      const r = await api('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: state.cart.map((l) => ({ productId: l.id, qty: l.qty })),
          nick,
          email,
          consentPd: $('consentPd').checked,
          consentTerms: $('consentTerms').checked,
          promo: state.promo?.code ?? '',
          method: state.method,
        }),
      });
      location.href = r.redirect;
    } catch (e) {
      $('mErr').textContent = e.message;
      updatePayState();
      $('mErr').textContent = e.message;
    }
  }

  // ---- статус заказа после возврата с оплаты
  async function showOrder(id, failed) {
    const b = $('banner');
    if (!failed) {
      state.cart = [];
      saveCart();
      refreshCart();
    }
    b.hidden = false;
    if (failed) {
      b.className = 'banner bad';
      b.textContent = 'Оплата не прошла или была отменена. Деньги не списаны, можно попробовать ещё раз.';
      return;
    }
    let tries = 0;
    const tick = async () => {
      try {
        const o = await api('/api/order/' + encodeURIComponent(id));
        if (o.status === 'paid' && o.delivered) {
          b.className = 'banner ok';
          b.textContent = `Готово! «${o.product}» выдан игроку ${o.nick}. Спасибо за поддержку сервера!`;
          return;
        }
        if (o.status === 'paid') {
          b.className = 'banner wait';
          b.textContent = `Оплата получена. Выдаём «${o.product}» игроку ${o.nick}…`;
        } else if (o.status === 'pending') {
          b.className = 'banner wait';
          b.textContent = 'Ждём подтверждение оплаты от банка…';
        } else if (o.status === 'review') {
          b.className = 'banner bad';
          b.textContent = `Платёж по заказу ${o.id} требует проверки администратором. Напишите нам с этим номером.`;
          return;
        } else {
          b.className = 'banner bad';
          b.textContent = 'Заказ отменён.';
          return;
        }
      } catch (e) {
        // заказ не найден / ошибка сети: ничего не показываем и убираем параметры из адреса
        b.hidden = true;
        b.textContent = '';
        try { history.replaceState(null, '', location.pathname + location.hash); } catch (_) {}
        return;
      }
      if (++tries < 60) setTimeout(tick, 3000);
      else b.textContent += ' Если товар не появился, напишите нам и укажите номер заказа: ' + id;
    };
    tick();
  }

  async function init() {
    $('cartBtn').onclick = openCart;
    $('cartClose').onclick = closeCart;
    $('toShop').onclick = () => { closeCart(); location.hash = '#shop'; };
    $('sheetBg').addEventListener('click', (e) => { if (e.target === $('sheetBg')) closeCart(); });
    $('mPay').onclick = pay;
    for (const id of ['nick', 'email']) $(id).addEventListener('input', updatePayState);
    for (const id of ['consentPd', 'consentTerms']) $(id).addEventListener('change', updatePayState);
    $('promoBtn').onclick = applyPromo;
    $('promo').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyPromo(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCart(); });

    try {
      state.shop = await api('/api/shop');
    } catch (e) {
      $('empty').hidden = false;
      $('empty').textContent = 'Не удалось загрузить магазин: ' + e.message;
      return;
    }
    renderHeader(state.shop.settings);
    loadCart();
    renderTabs();
    renderGrid();
    refreshCart();

    const q = new URLSearchParams(location.search);
    if (q.get('order')) showOrder(q.get('order'), q.get('failed') === '1');
  }

  init();
})();
