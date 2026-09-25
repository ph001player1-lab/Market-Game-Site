/* Календарь встреч пхукетского сообщества. Один на все языковые версии.

   Как и календарь на главной, расписание не хранится списком, а вычисляется
   от сегодняшней даты по правилам — поэтому не устаревает само по себе.

   Отличие от главной: встреч в месяц не поровну, а от двух до шести, чтобы
   расписание выглядело как у живого клуба, а не как сетка. Какие правила
   сработают в каком месяце, решает хеш от «год-месяц + правило». Он даёт
   одинаковый результат у всех посетителей и при каждой загрузке: план
   месяца не прыгает, и организатор видит на сайте ровно то, что видят люди.
   Весь план на два с половиной месяца вперёд — по адресу страницы с ?plan.

   Встречи офлайн, поэтому время всегда показывается пхукетское,
   а не по часам посетителя: ехать нужно к этому времени на острове.

   Подписи, темы и список отмен приходят из window.MEETUPS_CONFIG. */

(function () {
  'use strict';

  var C = window.MEETUPS_CONFIG;
  if (!C) return;

  var TZ = 'Asia/Bangkok';

  // weekday: 0 — воскресенье … 6 — суббота.
  // nth: какая по счёту такая неделя месяца; -1 — последняя.
  // chance: доля месяцев, в которые правило срабатывает; без него — каждый месяц.
  var RULES = [
    { id: 'game-sat',  format: 'game',      weekday: 6, nth: 2,  time: '14:00', hours: 2 },
    { id: 'game-tue',  format: 'game',      weekday: 2, nth: 4,  time: '11:00', hours: 2,   chance: 0.6 },
    { id: 'breakfast', format: 'breakfast', weekday: 3, nth: 1,  time: '09:00', hours: 1.5, chance: 0.75 },
    { id: 'workshop',  format: 'workshop',  weekday: 4, nth: 3,  time: '18:30', hours: 2,   chance: 0.6 },
    { id: 'talk',      format: 'talk',      weekday: 2, nth: 2,  time: '18:30', hours: 1.5, chance: 0.5 },
    { id: 'mixer',     format: 'mixer',     weekday: 5, nth: -1, time: '18:30', hours: 2.5, chance: 0.5 }
  ];

  // если в месяце выпало меньше двух встреч, добавляется это правило
  var FALLBACK = 'breakfast';
  var MIN_PER_MONTH = 2;

  var HORIZON_DAYS = 75;
  var planMode = /[?&]plan\b/.test(location.search);

  // --- время и даты --------------------------------------------------------

  // В Таиланде нет перехода на летнее время, UTC+7 круглый год.
  // Поэтому пересчёт местного времени в момент — простой сдвиг.
  var OFFSET = 7 * 3600000;

  function instant(y, m, d, hh, mm) { return new Date(Date.UTC(y, m, d, hh, mm) - OFFSET); }

  function phuketDate(ts) {
    var t = new Date(ts + OFFSET);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), wd: t.getUTCDay() };
  }

  function iso(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function daysIn(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }

  // --- какие встречи есть в месяце ----------------------------------------

  /** FNV-1a: стабильное число от строки, без случайности. */
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }

  function monthRules(y, m) {
    var key = y + '-' + (m + 1) + ':';
    var on = RULES.filter(function (r) {
      return r.chance == null || hash(key + r.id) < r.chance;
    });
    if (on.length < MIN_PER_MONTH) {
      RULES.forEach(function (r) {
        if (on.length < MIN_PER_MONTH && on.indexOf(r) === -1 && r.id === FALLBACK) on.push(r);
      });
    }
    return on;
  }

  function matches(rule, y, m, d, wd) {
    if (wd !== rule.weekday) return false;
    if (rule.nth === -1) return d + 7 > daysIn(y, m);
    return Math.ceil(d / 7) === rule.nth;
  }

  /** Номер темы: по кругу от месяца к месяцу. Списки тем на всех языках
      одной длины и в одном порядке, поэтому номер общий. */
  function topicIndex(y, m) { return y * 12 + m; }

  function pick(list, i) { return list && list.length ? list[i % list.length] : ''; }

  function cancelled(day, id) {
    var skip = C.exceptions || [];
    return skip.indexOf(day) !== -1 || skip.indexOf(day + ' ' + id) !== -1;
  }

  function upcoming(now) {
    var out = [];
    var start = phuketDate(now.getTime());
    var cache = {};

    for (var i = 0; i <= HORIZON_DAYS; i++) {
      var t = Date.UTC(start.y, start.m, start.d + i);
      var c = new Date(t);
      var y = c.getUTCFullYear(), m = c.getUTCMonth(), d = c.getUTCDate(), wd = c.getUTCDay();
      var mk = y + '-' + m;
      var rules = cache[mk] || (cache[mk] = monthRules(y, m));

      rules.forEach(function (r) {
        if (!matches(r, y, m, d, wd)) return;
        var day = iso(y, m, d);
        if (cancelled(day, r.id)) return;
        var hm = r.time.split(':');
        var at = instant(y, m, d, +hm[0], +hm[1]);
        if (at <= now) return;
        out.push({
          at: at, ends: new Date(at.getTime() + r.hours * 3600000),
          id: r.id, format: r.format, hours: r.hours,
          topic: pick((C.topics || {})[r.format], topicIndex(y, m)),
          managerTopic: pick(((C.manager || {}).topics || {})[r.format], topicIndex(y, m))
        });
      });
    }

    // Разовые встречи, которые организатор добавил вручную
    (C.extra || []).forEach(function (e) {
      var p = e.date.split('-'), hm = e.time.split(':');
      var at = instant(+p[0], +p[1] - 1, +p[2], +hm[0], +hm[1]);
      if (at <= now || at - now > HORIZON_DAYS * 86400000) return;
      out.push({
        at: at, ends: new Date(at.getTime() + (e.hours || 2) * 3600000),
        id: 'extra', format: e.format, hours: e.hours || 2,
        topic: e.topic || '', managerTopic: e.topic || ''
      });
    });

    return out.sort(function (a, b) { return a.at - b.at; });
  }

  // --- отрисовка -----------------------------------------------------------

  var T = C.text;
  function fmt(opts) {
    var o = { timeZone: TZ };
    for (var k in opts) o[k] = opts[k];
    return new Intl.DateTimeFormat(C.locale, o);
  }
  var wdFmt = fmt({ weekday: 'short' });
  var dayFmt = fmt({ day: 'numeric' });
  var monFmt = fmt({ month: 'short' });
  var longFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
  var timeFmt = fmt(C.hour12
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  // Подпись встречи для заявки. Посетитель видит страницу на своём языке,
  // а менеджеры читают таблицу и Telegram по-русски — поэтому в заявку
  // встреча уходит на языке из C.manager, а не на языке страницы.
  var MG = C.manager || { locale: C.locale, formats: {} };
  var mgDayFmt = new Intl.DateTimeFormat(MG.locale, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  var mgTimeFmt = new Intl.DateTimeFormat(MG.locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  function managerLabel(g) {
    var name = MG.formats[g.format] || (C.formats[g.format] || {}).name || g.format;
    return mgDayFmt.format(g.at) + ' · ' + mgTimeFmt.format(g.at) + ' · ' + name +
           (g.managerTopic ? ' — ' + g.managerTopic : '');
  }

  var rel = typeof Intl.RelativeTimeFormat === 'function'
    ? new Intl.RelativeTimeFormat(C.locale, { numeric: 'auto' }) : null;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Сколько дней до встречи — по пхукетскому календарю. */
  function daysUntil(at, now) {
    var a = phuketDate(at.getTime()), b = phuketDate(now.getTime());
    return Math.round((Date.UTC(a.y, a.m, a.d) - Date.UTC(b.y, b.m, b.d)) / 86400000);
  }

  function hoursLabel(h) {
    return T.duration.replace('{h}', String(h).replace('.', T.decimal || '.'));
  }

  function card(g, i, now, compact) {
    var f = C.formats[g.format] || { name: g.format };
    var dleft = daysUntil(g.at, now);
    var when = rel && dleft <= 14 ? rel.format(dleft, 'day') : '';
    var title = g.topic || f.title || f.name;
    var gameLabel = managerLabel(g);

    return '' +
      '<article class="meet meet--' + esc(g.format) + (i === 0 ? ' meet--next' : '') + '">' +
        '<div class="meet__date" aria-hidden="true">' +
          '<span>' + esc(wdFmt.format(g.at)) + '</span>' +
          '<b>' + esc(dayFmt.format(g.at)) + '</b>' +
          '<span>' + esc(monFmt.format(g.at)) + '</span>' +
        '</div>' +
        '<div class="meet__body">' +
          '<span class="meet__tag">' + esc(f.name) + '</span>' +
          '<h3>' + esc(title) + '</h3>' +
          '<p class="meet__time"><span class="sr">' + esc(longFmt.format(g.at)) + ', </span>' +
            esc(timeFmt.format(g.at)) + '–' + esc(timeFmt.format(g.ends)) +
            ' · ' + esc(hoursLabel(g.hours)) +
            (when ? ' · <em>' + esc(when) + '</em>' : '') + '</p>' +
          (!compact && f.blurb ? '<p class="meet__blurb">' + esc(f.blurb) + '</p>' : '') +
        '</div>' +
        '<div class="meet__go">' +
          '<button type="button" class="btn' + (compact ? ' btn--sm' : '') + '" data-lead="pk_meet" ' +
            'data-game="' + esc(gameLabel) + '">' + esc(T.cta) + '</button>' +
        '</div>' +
      '</article>';
  }

  // Разметка Event для поисковиков — из того же списка, что видит человек.
  // Адрес площадки раскрываем только лично, поэтому место указано до острова.
  function markup(games) {
    var seo = C.seo;
    if (!seo) return;
    var node = document.getElementById('meetups-ld');
    if (!node) {
      node = document.createElement('script');
      node.type = 'application/ld+json';
      node.id = 'meetups-ld';
      document.head.appendChild(node);
    }
    function isoLocal(d) {
      var p = phuketDate(d.getTime()), t = new Date(d.getTime() + OFFSET);
      return iso(p.y, p.m, p.d) + 'T' + String(t.getUTCHours()).padStart(2, '0') + ':' +
             String(t.getUTCMinutes()).padStart(2, '0') + ':00+07:00';
    }
    node.textContent = JSON.stringify(games.map(function (g) {
      var f = C.formats[g.format] || { name: g.format };
      var e = {
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: seo.name + ' — ' + (g.topic ? f.name + ': ' + g.topic : f.name),
        startDate: isoLocal(g.at),
        endDate: isoLocal(g.ends),
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        eventStatus: 'https://schema.org/EventScheduled',
        location: {
          '@type': 'Place',
          name: seo.place,
          address: { '@type': 'PostalAddress', addressLocality: 'Phuket',
                     addressRegion: 'Phuket', addressCountry: 'TH' }
        },
        organizer: { '@type': 'Organization', name: seo.name, url: seo.url },
        url: seo.url + '#calendar'
      };
      if (f.blurb) e.description = f.blurb;
      if (seo.prices && seo.prices[g.format] != null) {
        e.offers = {
          '@type': 'Offer', price: String(seo.prices[g.format]),
          priceCurrency: seo.currency, availability: 'https://schema.org/InStock',
          url: seo.url + '#calendar'
        };
      }
      return e;
    }));
  }

  function render() {
    var now = new Date();
    var games = upcoming(now);

    var month = games.filter(function (g) { return g.at - now < 30 * 86400000; }).length;

    (C.hosts || []).forEach(function (h) {
      var host = document.getElementById(h.id);
      if (!host) return;
      if (!games.length) {
        host.innerHTML = '<p class="mute">' + esc(T.empty) + '</p>';
        return;
      }
      var limit = planMode && !h.compact ? games.length : (h.limit || 6);
      var list = games.slice(0, limit).map(function (g, i) {
        return card(g, i, now, h.compact);
      }).join('');
      // Счётчик на Пхукете по умолчанию выключен: при 2–6 встречах в месяц
      // цифра «3» говорит скорее о затишье, чем об активности.
      host.innerHTML =
        (h.compact || !T.monthCount ? '' : '<p class="meets__count">' +
          esc(T.monthCount.replace('{n}', month)) + '</p>') +
        '<div class="meets' + (h.compact ? ' meets--mini' : '') + '">' + list + '</div>';
    });

    markup(games.slice(0, 8));
  }

  render();
  setInterval(render, 30 * 60 * 1000);

  // для проверки в тестах
  window.__meetups = { upcoming: upcoming, monthRules: monthRules };
})();
