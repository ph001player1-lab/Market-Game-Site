/* Календарь игр. Один на все языковые версии.

   Расписание не хранится готовым списком, а вычисляется от сегодняшней даты
   по правилам ниже. Поэтому оно не может устареть: страница всегда показывает
   ближайшие игры, без чьего-либо вмешательства.

   Время каждого потока привязано к своему городу, а не к UTC. Это важно:
   при переходе на летнее время игра остаётся в те же 19:00 по местному,
   а сдвигается её UTC-время. Привязка к UTC давала бы обратное — время игры
   «уезжало» бы для участников дважды в год.

   Подписи, язык и список отменённых игр приходят из window.SCHEDULE_CONFIG,
   объявленного в самой странице. Сетка игр общая для всех языков: на сайте
   показываются все игры всех потоков, независимо от выбранного языка. */

(function () {
  'use strict';

  var C = window.SCHEDULE_CONFIG;
  if (!C) return;

  var host = document.getElementById('schedule');
  if (!host) return;

  // Сетка игр. weekday: 0 — воскресенье … 6 — суббота.
  // nth заполняется только для ежемесячных игр: 1 — первая такая-то неделя месяца.
  var RULES = [
    // Лига 12 · 2 часа · еженедельно
    { league: 'l12', stream: 'ru', weekday: 3, time: '19:00', tz: 'Europe/Moscow',       hours: 2 },
    { league: 'l12', stream: 'eu', weekday: 4, time: '19:00', tz: 'Europe/London',       hours: 2 },
    { league: 'l12', stream: 'us', weekday: 6, time: '11:00', tz: 'America/New_York',    hours: 2 },
    { league: 'l12', stream: 'vi', weekday: 0, time: '15:00', tz: 'Asia/Ho_Chi_Minh',    hours: 2 },

    // Лига 24 · 2,5 часа · еженедельно
    { league: 'l24', stream: 'eu', weekday: 2, time: '19:00', tz: 'Europe/London',       hours: 2.5 },
    { league: 'l24', stream: 'us', weekday: 3, time: '19:00', tz: 'America/New_York',    hours: 2.5 },
    { league: 'l24', stream: 'ru', weekday: 6, time: '12:00', tz: 'Europe/Moscow',       hours: 2.5 },
    { league: 'l24', stream: 'vi', weekday: 6, time: '19:30', tz: 'Asia/Ho_Chi_Minh',    hours: 2.5 },

    // Лига 36 · 4 часа · раз в месяц
    { league: 'l36', stream: 'us', weekday: 6, nth: 1, time: '10:00', tz: 'America/New_York', hours: 4 },
    { league: 'l36', stream: 'ru', weekday: 6, nth: 2, time: '11:00', tz: 'Europe/Moscow',    hours: 4 },
    { league: 'l36', stream: 'eu', weekday: 6, nth: 3, time: '10:00', tz: 'Europe/London',    hours: 4 },
    { league: 'l36', stream: 'vi', weekday: 6, nth: 4, time: '14:00', tz: 'Asia/Ho_Chi_Minh', hours: 4 }
  ];

  var HORIZON_DAYS = 75;
  var LIMIT = C.limit || 8;

  // --- работа с часовыми поясами -------------------------------------------

  /** Смещение часового пояса в миллисекундах в конкретный момент времени. */
  function zoneOffset(ts, tz) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(ts));
    var p = {};
    parts.forEach(function (x) { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
  }

  /**
   * Момент времени, соответствующий указанному местному времени в часовом поясе.
   * Считаем в два приближения: первое даёт смещение, второе учитывает случай,
   * когда поправка сама переносит момент через границу перевода часов.
   */
  function zonedInstant(y, month, day, hh, mm, tz) {
    var target = Date.UTC(y, month, day, hh, mm);
    var ts = target;
    for (var i = 0; i < 2; i++) ts = target - zoneOffset(ts, tz);
    return new Date(ts);
  }

  /** Календарная дата в часовом поясе — как {y, m, d}. */
  function dateIn(ts, tz) {
    var p = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(ts)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month - 1, d: +p.day };
  }

  function iso(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  // --- построение списка игр -----------------------------------------------

  /**
   * Отменена ли игра. В C.exceptions можно записать либо всю дату
   * «2026-01-03» — тогда в этот день не проводится ничего, либо одну игру
   * «2026-01-03 l12 ru» — тогда остальные потоки в этот день остаются.
   */
  function cancelled(skip, day, rule) {
    return skip.indexOf(day) !== -1 ||
           skip.indexOf(day + ' ' + rule.league + ' ' + rule.stream) !== -1;
  }

  function upcoming(now) {
    var skip = C.exceptions || [];
    var out = [];

    RULES.forEach(function (rule) {
      // идём по календарю часового пояса самого потока — тогда «вторая суббота»
      // считается по его месяцу, а не по месяцу посетителя
      var start = dateIn(now.getTime(), rule.tz);
      var cursor = new Date(Date.UTC(start.y, start.m, start.d));

      for (var i = 0; i <= HORIZON_DAYS; i++) {
        var y = cursor.getUTCFullYear(), m = cursor.getUTCMonth(), d = cursor.getUTCDate();

        if (cursor.getUTCDay() === rule.weekday &&
            (!rule.nth || Math.ceil(d / 7) === rule.nth)) {
          var hm = rule.time.split(':');
          var at = zonedInstant(y, m, d, +hm[0], +hm[1], rule.tz);
          if (at > now && !cancelled(skip, iso(y, m, d), rule)) {
            out.push({
              at: at,
              ends: new Date(at.getTime() + rule.hours * 3600000),
              league: rule.league, stream: rule.stream, hours: rule.hours
            });
          }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    });

    return out.sort(function (a, b) { return a.at - b.at; });
  }

  // --- отрисовка -----------------------------------------------------------

  var T = C.text;
  // C.hour12 включает 12-часовой формат: для английской версии «7:00 PM»
  // привычнее, чем «19:00», а для русской и вьетнамской — наоборот.
  var hourOpts = C.hour12
    ? { hour: 'numeric', minute: '2-digit', hour12: true }
    : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

  var dayFmt = new Intl.DateTimeFormat(C.locale, { day: 'numeric', month: 'long', weekday: 'long' });
  var timeFmt = new Intl.DateTimeFormat(C.locale, hourOpts);
  var rel = typeof Intl.RelativeTimeFormat === 'function'
    ? new Intl.RelativeTimeFormat(C.locale, { numeric: 'auto' }) : null;

  function clockFmt(tz) {
    var o = { timeZone: tz };
    for (var k in hourOpts) o[k] = hourOpts[k];
    return new Intl.DateTimeFormat(C.locale, o);
  }
  var clocks = (C.clocks || []).map(function (c) {
    return { label: c.label, tz: c.tz, fmt: clockFmt(c.tz) };
  });

  /**
   * На сколько суток дата в городе расходится с датой у посетителя.
   * Между Лос-Анджелесом и Бангкоком четырнадцать часов, и «Бангкок 01:00»
   * под заголовком «четверг» — это на самом деле пятница. Без этой пометки
   * человек запишется не на тот день.
   */
  function dayDelta(at, tz) {
    var there = dateIn(at.getTime(), tz);
    var here = Date.UTC(at.getFullYear(), at.getMonth(), at.getDate());
    return Math.round((Date.UTC(there.y, there.m, there.d) - here) / 86400000);
  }

  function daysUntil(at, now) {
    var a = new Date(at), b = new Date(now);
    a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
    return Math.round((a - b) / 86400000);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function hoursLabel(h) {
    return T.duration.replace('{h}', String(h).replace('.', T.decimal || ','));
  }

  function render() {
    var now = new Date();
    var games = upcoming(now);

    if (!games.length) {
      host.innerHTML = '<p class="mute">' + esc(T.empty) + '</p>';
      return;
    }

    // сколько игр приходится на ближайшие 30 дней — для строки над списком
    var month = games.filter(function (g) {
      return g.at - now < 30 * 86400000;
    }).length;

    var rows = games.slice(0, LIMIT).map(function (g, i) {
      var dleft = daysUntil(g.at, now);
      var when = rel && dleft <= 14 ? rel.format(dleft, 'day') : '';
      var label = C.leagues[g.league] + ' · ' + C.streams[g.stream];

      var clockCells = clocks.map(function (c) {
        var shift = dayDelta(g.at, c.tz);
        var mark = shift === 0 ? ''
          : '<i title="' + esc(T.otherDay || '') + '">' + (shift > 0 ? '+' : '\u2212') +
            Math.abs(shift) + '</i>';
        return '<span><b>' + esc(c.label) + '</b> ' + esc(c.fmt.format(g.at)) + mark + '</span>';
      }).join('');

      return '' +
        '<article class="game' + (i === 0 ? ' game--next' : '') + '">' +
          '<div class="game__when">' +
            '<span class="game__date">' + esc(dayFmt.format(g.at)) + '</span>' +
            (when ? '<span class="game__rel">' + esc(when) + '</span>' : '') +
          '</div>' +
          '<div class="game__what">' +
            (i === 0 ? '<span class="game__flag">' + esc(T.soonest) + '</span>' : '') +
            '<h3>' + esc(label) + '</h3>' +
            '<p class="game__time">' + esc(timeFmt.format(g.at)) + '–' +
              esc(timeFmt.format(g.ends)) + ' · ' + esc(T.yourTime) +
              ' · ' + esc(hoursLabel(g.hours)) + '</p>' +
            '<p class="game__clocks">' + clockCells + '</p>' +
          '</div>' +
          '<div class="game__go">' +
            '<button type="button" class="btn" data-lead="' + esc(g.league) + '" ' +
              'data-game="' + esc(dayFmt.format(g.at) + ' · ' + label) + '">' +
              esc(T.cta) + '</button>' +
          '</div>' +
        '</article>';
    }).join('');

    host.innerHTML =
      '<p class="schedule__count">' + esc(T.monthCount.replace('{n}', month)) + '</p>' +
      '<div class="games">' + rows + '</div>';
  }

  render();
  // страницу могут оставить открытой надолго — пересобираем раз в полчаса,
  // чтобы прошедшая игра не висела в списке
  setInterval(render, 30 * 60 * 1000);
})();
