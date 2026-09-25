/* Форма заявки. Одна на все языковые версии.
   Тексты, адрес приёмника и запасной контакт приходят из window.FORM_CONFIG,
   который объявлен в самой странице — тем же приёмом, что и у sim.js.

   Кнопка открывает форму, если у неё есть атрибут data-lead.
   Значение атрибута — ключ лиги из FORM_CONFIG.leagues, например data-lead="l12".
   data-lead="" открывает форму без заранее выбранной лиги. */

(function () {
  'use strict';

  var C = window.FORM_CONFIG;
  if (!C) return;

  var T = C.text;
  var doc = document;
  var dialog, form, statusBox, submitBtn, openedAt, lastFocus;

  function el(tag, attrs, children) {
    var node = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') node.textContent = attrs[k];
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function field(id, label, type, placeholder, hint) {
    var input = el('input', {
      type: type, id: id, name: id, placeholder: placeholder,
      autocomplete: id === 'name' ? 'name' : (id === 'phone' ? 'tel' : 'off')
    });
    var wrap = el('div', { class: 'lf__row' }, [
      el('label', { for: id, text: label }),
      input
    ]);
    if (hint) wrap.appendChild(el('span', { class: 'lf__hint', text: hint }));
    return wrap;
  }

  function build() {
    dialog = el('dialog', { class: 'lf', 'aria-labelledby': 'lfTitle' });

    var leagueSelect = el('select', { id: 'league', name: 'league' });
    Object.keys(C.leagues).forEach(function (key) {
      leagueSelect.appendChild(el('option', { value: key, text: C.leagues[key] }));
    });

    var consentId = 'lfConsent';
    var consent = el('input', { type: 'checkbox', id: consentId, name: 'consent' });
    var consentLabel = el('label', { for: consentId, class: 'lf__consent' });
    consentLabel.appendChild(doc.createTextNode(T.consent + ' '));
    consentLabel.appendChild(el('a', {
      href: C.privacyUrl, target: '_blank', rel: 'noopener', text: T.privacy
    }));

    // Выбор мессенджера — только там, где он задан в настройках страницы
    // (на пхукетской: адрес встречи присылаем в личку, и надо знать куда).
    // В заявку уходит ключ — whatsapp / telegram / line, а не подпись.
    var messengerRow = null;
    if (C.messengers) {
      var messengerSelect = el('select', { id: 'messenger', name: 'messenger' });
      Object.keys(C.messengers).forEach(function (key) {
        messengerSelect.appendChild(el('option', { value: key, text: C.messengers[key] }));
      });
      messengerRow = el('div', { class: 'lf__row' }, [
        el('label', { for: 'messenger', text: T.messenger }),
        messengerSelect
      ]);
    }

    form = el('form', { class: 'lf__form', novalidate: 'novalidate' }, [
      field('name', T.name, 'text', T.namePh),
      field('phone', T.phone, 'tel', T.phonePh),
      field('telegram', T.telegram, 'text', T.telegramPh)
    ].concat(messengerRow ? [messengerRow] : []).concat([
      el('div', { class: 'lf__row' }, [
        el('label', { for: 'league', text: T.league }),
        leagueSelect
      ]),
      // ловушка для роботов: человек её не видит и не заполняет
      el('div', { class: 'lf__trap', 'aria-hidden': 'true' }, [
        el('label', { for: 'company', text: 'Company' }),
        el('input', { type: 'text', id: 'company', name: 'company', tabindex: '-1', autocomplete: 'off' })
      ]),
      el('div', { class: 'lf__check' }, [consent, consentLabel])
    ]));

    statusBox = el('p', { class: 'lf__status', role: 'status', 'aria-live': 'polite' });
    submitBtn = el('button', { type: 'submit', class: 'btn', text: T.submit });
    form.appendChild(el('div', { class: 'lf__actions' }, [submitBtn]));
    form.appendChild(statusBox);

    var closeBtn = el('button', {
      type: 'button', class: 'lf__x', 'aria-label': T.close
    });
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', close);

    dialog.appendChild(el('div', { class: 'lf__in' }, [
      closeBtn,
      el('h2', { id: 'lfTitle', class: 'lf__t', text: T.title }),
      el('p', { class: 'lf__sub', text: T.subtitle }),
      form
    ]));

    doc.body.appendChild(dialog);
    form.addEventListener('submit', submit);
    dialog.addEventListener('close', function () {
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    });
  }

  // Из календаря форма открывается кнопкой конкретной игры. Дату и поток
  // никуда не показываем, но передаём менеджеру: без этого заявка «Лига 24»
  // не говорит, на какую из четырёх еженедельных игр человек нацелился.
  var pickedGame = '';

  function open(league, game) {
    if (!dialog) build();
    reset();
    pickedGame = game || '';
    if (league && C.leagues[league]) form.league.value = league;
    lastFocus = doc.activeElement;
    openedAt = Date.now();
    dialog.showModal();
    form.name.focus();
  }

  function close() { if (dialog && dialog.open) dialog.close(); }

  function reset() {
    form.reset();
    pickedGame = '';
    submitBtn.disabled = false;
    submitBtn.textContent = T.submit;
    setStatus('', '');
    form.classList.remove('lf__form--done');
    dropDoneBox();
    Array.prototype.forEach.call(form.querySelectorAll('.lf__row'), function (r) {
      r.classList.remove('lf__row--bad');
    });
  }

  function dropDoneBox() {
    var done = dialog.querySelector('.lf__done');
    if (done) done.parentNode.removeChild(done);
  }

  function setStatus(message, kind, html) {
    statusBox.className = 'lf__status' + (kind ? ' lf__status--' + kind : '');
    if (html) statusBox.innerHTML = html;
    else statusBox.textContent = message;
  }

  function markBad(input) {
    var row = input.closest('.lf__row');
    if (row) row.classList.add('lf__row--bad');
    input.focus();
  }

  function digits(s) { return (s.match(/\d/g) || []).length; }

  function validate() {
    Array.prototype.forEach.call(form.querySelectorAll('.lf__row'), function (r) {
      r.classList.remove('lf__row--bad');
    });

    var name = form.name.value.trim();
    var phone = form.phone.value.trim();
    var tg = form.telegram.value.trim();

    if (!name) { setStatus(T.errName, 'bad'); markBad(form.name); return null; }
    if (!phone && !tg) { setStatus(T.errContact, 'bad'); markBad(form.phone); return null; }
    if (phone && digits(phone) < 6) { setStatus(T.errPhone, 'bad'); markBad(form.phone); return null; }
    if (!form.consent.checked) { setStatus(T.errConsent, 'bad'); form.consent.focus(); return null; }

    return {
      name: name,
      phone: phone,
      telegram: tg,
      // Префикс видит только менеджер: по нему в таблице отличают заявки
      // пхукетского сообщества от заявок основного сайта.
      // managerLeagues — подписи для таблицы, если они на другом языке, чем
      // страница (на пхукетских страницах менеджерам уходит по-русски).
      league: C.leagues[form.league.value]
        ? (C.leaguePrefix || '') +
          ((C.managerLeagues || C.leagues)[form.league.value] || C.leagues[form.league.value]) : '',
      game: pickedGame,
      messenger: form.messenger ? form.messenger.value : '',
      company: form.company.value,
      elapsed: Date.now() - openedAt,
      lang: C.lang,
      page: location.href,
      referrer: doc.referrer,
      utm: location.search.replace(/^\?/, '')
    };
  }

  // Apps Script отвечает медленно: холодный старт, запись в таблицу и вызов
  // Telegram идут по очереди, и десять секунд для него — норма. Держать
  // человека перед крутящейся кнопкой всё это время незачем: показываем
  // подтверждение через SHOW_AFTER, а запрос продолжает идти в фоне.
  // Если он всё-таки не дойдёт, подменим подтверждение на ошибку.
  var SHOW_AFTER = 1200;
  var shown;

  function submit(event) {
    event.preventDefault();
    var payload = validate();
    if (!payload) return;

    submitBtn.disabled = true;
    submitBtn.textContent = T.sending;
    setStatus('', '');
    shown = false;

    var timer = setTimeout(succeed, SHOW_AFTER);

    // text/plain — «простой» запрос, браузер не делает предварительный
    // OPTIONS, который Apps Script не обрабатывает.
    // keepalive досылает заявку, даже если вкладку закроют сразу после отправки.
    fetch(C.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      keepalive: true
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
      .then(function (res) {
        if (!res || res.status !== 'ok') throw new Error('backend');
        clearTimeout(timer);
        succeed();
      })
      .catch(function () {
        clearTimeout(timer);
        fail();
      });
  }

  function succeed() {
    if (shown) return;
    shown = true;
    form.classList.add('lf__form--done');
    setStatus('', '');
    var box = el('div', { class: 'lf__done' }, [
      el('h3', { text: T.successTitle }),
      el('p', { text: T.successText }),
      el('button', { type: 'button', class: 'btn', text: T.close })
    ]);
    box.querySelector('button').addEventListener('click', close);
    form.parentNode.insertBefore(box, form.nextSibling);
    box.querySelector('button').focus();
  }

  function fail() {
    // Отказ мог прийти уже после того, как мы показали подтверждение —
    // тогда убираем его и честно говорим, что заявка не ушла.
    shown = true;
    dropDoneBox();
    form.classList.remove('lf__form--done');
    submitBtn.disabled = false;
    submitBtn.textContent = T.submit;
    var link = '<a href="' + C.fallback.url + '" target="_blank" rel="noopener">' +
               C.fallback.label + '</a>';
    setStatus('', 'bad', T.errSend + ' ' + T.errSendFallback + ' ' + link);
    if (!dialog.open) dialog.showModal();
  }

  doc.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-lead]');
    if (!trigger) return;
    event.preventDefault();
    open(trigger.getAttribute('data-lead'), trigger.getAttribute('data-game'));
  });
})();
