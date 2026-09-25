/**
 * «Захвати рынок» — приём заявок с сайта.
 *
 * Что делает: принимает заявку с сайта, дописывает строку в Google-таблицу
 * и присылает уведомление в закрытую группу Telegram.
 *
 * Как поставить — подробная инструкция в README репозитория, раздел
 * «Приём заявок». Коротко:
 *   1. Расширения → Apps Script в вашей Google-таблице.
 *   2. Вставить этот файл целиком вместо содержимого Code.gs.
 *   3. Настройки проекта → Свойства скрипта, добавить два свойства:
 *        BOT_TOKEN  — токен бота от @BotFather
 *        CHAT_ID    — id закрытой группы, куда писать (с минусом, напр. -1001234567890)
 *   4. Развернуть → Новое развёртывание → Веб-приложение,
 *      «Запуск от имени: я», «Доступ: все».
 *   5. Скопировать адрес вида .../exec и прислать его мне.
 *
 * ЕСЛИ ЧТО-ТО НЕ РАБОТАЕТ: выберите наверху функцию checkSetup и нажмите
 * «Выполнить». Она проверит ключи, токен, доступ к группе и таблицу,
 * и прямо напишет, что именно сломалось.
 *
 * ВАЖНО: токен живёт в свойствах скрипта и на сайт не попадает.
 * Никогда не вписывайте его прямо в этот файл — он лежит в публичном репозитории.
 */

var SHEET_LEADS = 'Лиды';

// Порядок важен только для нового листа. В существующем строка пишется
// по названиям колонок, а недостающие колонки дописываются справа —
// поэтому новые поля добавляйте в КОНЕЦ списка, и старые строки не поедут.
var HEADERS = [
  'Дата', 'Имя', 'Телефон', 'Telegram', 'Лига',
  'Язык', 'Страница', 'Источник', 'UTM', 'IP-метка',
  'Игра', 'Мессенджер'
];

// Ключи мессенджеров, которые присылает форма. Ключ, а не подпись: подпись
// зависит от языка страницы, а в таблице нужно одно значение на всех.
var MESSENGERS = { whatsapp: 'WhatsApp', telegram: 'Telegram', line: 'LINE' };

/** Форма шлёт POST. Apps Script отдаёт ответ с CORS-заголовком по умолчанию. */
function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // Ловушка от ботов: поле скрыто в вёрстке, человек его не заполнит.
    if (data.company) return ok({ status: 'ok' });

    // Слишком быстрая отправка — почти наверняка робот.
    if (typeof data.elapsed === 'number' && data.elapsed < 2000) {
      return ok({ status: 'ok' });
    }

    var name = clean(data.name, 100);
    var phone = clean(data.phone, 40);
    var telegram = clean(data.telegram, 80);

    if (!name || (!phone && !telegram)) {
      return ok({ status: 'error', message: 'not enough contact data' });
    }

    var messenger = MESSENGERS[data.messenger] || '';

    var row = {
      date: new Date(),
      name: name,
      phone: phone,
      // во второе поле пишут и Telegram, и LINE; @ нужна только первому
      telegram: messenger === 'LINE' ? telegram : normalizeTelegram(telegram),
      messenger: messenger,
      league: clean(data.league, 40),
      game: clean(data.game, 120),
      lang: clean(data.lang, 10),
      page: clean(data.page, 200),
      referrer: clean(data.referrer, 200),
      utm: clean(data.utm, 300)
    };

    appendLead(row);
    notifyTelegram(row);

    return ok({ status: 'ok' });
  } catch (err) {
    // Пишем в журнал, но наружу подробности не отдаём.
    console.error(err);
    return ok({ status: 'error', message: 'internal' });
  }
}

/**
 * Проверка, что развёртывание живое: откройте адрес /exec в браузере.
 * Показывает, заданы ли ключи, но сами значения не раскрывает.
 */
function doGet() {
  var props = PropertiesService.getScriptProperties();
  return ok({
    status: 'ok',
    service: 'marketgame-leads',
    hasToken: !!props.getProperty('BOT_TOKEN'),
    hasChatId: !!props.getProperty('CHAT_ID')
  });
}

function appendLead(row) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet();
    var values = {
      'Дата': row.date, 'Имя': row.name, 'Телефон': row.phone,
      'Telegram': row.telegram, 'Лига': row.league, 'Язык': row.lang,
      'Страница': row.page, 'Источник': row.referrer, 'UTM': row.utm,
      'Игра': row.game || '', 'Мессенджер': row.messenger || ''
    };
    // Раскладываем по заголовкам листа, а не по позиции: менеджер мог
    // переставить колонки, а лист мог остаться от прошлой версии кода.
    sheet.appendRow(headerRow(sheet).map(function (h) {
      return values.hasOwnProperty(h) ? values[h] : '';
    }));
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_LEADS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_LEADS);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Лист мог остаться от прошлой версии кода, где колонок было меньше.
  // Недостающие колонки дописываем справа. Переписывать заголовок целиком
  // нельзя: старые строки остались бы под чужими названиями.
  var have = headerRow(sheet);
  var missing = HEADERS.filter(function (h) { return have.indexOf(h) === -1; });
  if (missing.length) {
    sheet.getRange(1, have.length + 1, 1, missing.length)
      .setValues([missing]).setFontWeight('bold');
  }
  return sheet;
}

function headerRow(sheet) {
  var width = sheet.getLastColumn();
  if (!width) return [];
  return sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
}

/**
 * Отправка в Telegram. Возвращает {ok, error} и НИКОГДА не бросает исключение:
 * заявка к этому моменту уже лежит в таблице, и терять её из-за Telegram нельзя.
 * Всё, что пошло не так, попадает в журнал выполнения.
 */
function sendToTelegram(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('BOT_TOKEN');
  var chatId = props.getProperty('CHAT_ID');

  if (!token) return { ok: false, error: 'В свойствах скрипта не задан BOT_TOKEN' };
  if (!chatId) return { ok: false, error: 'В свойствах скрипта не задан CHAT_ID' };

  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      muteHttpExceptions: true
    });

    var body = {};
    try { body = JSON.parse(res.getContentText()); } catch (e) {}

    if (body.ok) return { ok: true };

    var reason = body.description || ('HTTP ' + res.getResponseCode());
    console.error('Telegram отказал: ' + reason);
    return { ok: false, error: reason, hint: explainTelegramError(reason) };
  } catch (err) {
    console.error('Не удалось обратиться к Telegram: ' + err);
    return { ok: false, error: String(err) };
  }
}

/** Перевод ответов Telegram на человеческий язык. */
function explainTelegramError(reason) {
  var r = String(reason).toLowerCase();
  if (r.indexOf('chat not found') > -1) {
    return 'CHAT_ID неверный. У групп он отрицательный и обычно начинается с -100. ' +
           'Проверьте, что скопировали его целиком, вместе с минусом.';
  }
  if (r.indexOf('unauthorized') > -1 || r.indexOf('401') > -1) {
    return 'BOT_TOKEN неверный или бот удалён. Возьмите токен заново у @BotFather.';
  }
  if (r.indexOf('kicked') > -1 || r.indexOf('not a member') > -1) {
    return 'Бота нет в группе. Добавьте его обратно.';
  }
  if (r.indexOf('not enough rights') > -1 || r.indexOf('have no rights') > -1) {
    return 'Бот в группе, но ему запрещено писать. Сделайте его администратором.';
  }
  if (r.indexOf('bots can\'t send messages to bots') > -1) {
    return 'CHAT_ID указывает на бота, а не на группу.';
  }
  return 'Полный текст ошибки выше — он от Telegram.';
}

function notifyTelegram(row) {
  var lines = [
    '<b>Новая заявка</b>',
    '',
    'Имя: ' + esc(row.name),
    row.phone ? 'Телефон: ' + esc(row.phone) : '',
    row.telegram ? 'Telegram: ' + esc(row.telegram) : '',
    row.league ? 'Лига: ' + esc(row.league) : '',
    row.game ? 'Игра: ' + esc(row.game) : '',
    row.messenger ? 'Написать в: ' + esc(row.messenger) : '',
    'Язык страницы: ' + esc(row.lang || '—'),
    row.utm ? 'Метки: ' + esc(row.utm) : '',
    row.referrer ? 'Пришёл с: ' + esc(row.referrer) : ''
  ].filter(function (l) { return l !== ''; });

  return sendToTelegram(lines.join('\n'));
}

function clean(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeTelegram(value) {
  if (!value) return '';
  var v = value.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '').trim();
  return v ? '@' + v : '';
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ok(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ГЛАВНАЯ ФУНКЦИЯ ДЛЯ НАСТРОЙКИ.
 *
 * Выберите её в списке функций наверху редактора и нажмите «Выполнить».
 * Она проверит всё по шагам и прямо скажет, что не так. Результат виден
 * в панели выполнения внизу — читать журнал отдельно не нужно.
 */
function checkSetup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('BOT_TOKEN');
  var chatId = props.getProperty('CHAT_ID');
  var out = [];

  function say(line) { out.push(line); console.log(line); }
  function stop(line) {
    say('✗ ' + line);
    throw new Error('\n\n' + out.join('\n') + '\n');
  }

  say('--- Проверка настройки ---');

  // 1. Ключи на месте?
  if (!token) {
    stop('Не задан BOT_TOKEN.\n' +
         '  Настройки проекта (шестерёнка слева) → Свойства скрипта →\n' +
         '  Добавить свойство. Имя ровно BOT_TOKEN, значение — токен от @BotFather.');
  }
  say('✓ BOT_TOKEN задан (' + token.length + ' символов)');

  if (!chatId) {
    stop('Не задан CHAT_ID.\n' +
         '  Там же добавьте свойство CHAT_ID со значением id группы.');
  }
  say('✓ CHAT_ID задан: ' + chatId);

  if (String(chatId).indexOf('-') !== 0) {
    say('⚠ CHAT_ID не начинается с минуса. У групп он отрицательный,\n' +
        '  обычно вида -1001234567890. Если это id личного чата — сообщения\n' +
        '  будут приходить вам лично, а не в группу.');
  }

  // 2. Токен рабочий?
  var me;
  try {
    var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe',
                              { muteHttpExceptions: true });
    me = JSON.parse(r.getContentText());
  } catch (err) {
    stop('Не удалось обратиться к Telegram: ' + err + '\n' +
         '  Если Google показал окно с запросом доступа — согласитесь и запустите снова.');
  }

  if (!me.ok) {
    stop('Telegram не принял токен: ' + (me.description || 'неизвестная ошибка') + '\n' +
         '  ' + explainTelegramError(me.description || ''));
  }
  say('✓ Токен рабочий, бот: @' + me.result.username);

  // 3. Сообщение доходит?
  var sent = sendToTelegram(
    '<b>Проверка настройки</b>\n\nЕсли вы это читаете — приём заявок настроен верно.');

  if (!sent.ok) {
    stop('Бот не смог написать в группу.\n' +
         '  Ответ Telegram: ' + sent.error + '\n' +
         '  ' + (sent.hint || ''));
  }
  say('✓ Сообщение отправлено — проверьте группу');

  // 4. Таблица на месте?
  try {
    var sheet = getSheet();
    say('✓ Лист «' + sheet.getName() + '» готов, строк с данными: ' +
        Math.max(0, sheet.getLastRow() - 1));
  } catch (err) {
    stop('Не удалось открыть таблицу: ' + err + '\n' +
         '  Скрипт должен быть привязан к таблице: откройте таблицу →\n' +
         '  Расширения → Apps Script, и вставьте код там.');
  }

  say('');
  say('ВСЁ ГОТОВО. Осталось развернуть: Развернуть → Управление развёртываниями →');
  say('карандаш → Версия: новая → Развернуть.');

  var report = out.join('\n');
  console.log(report);
  return report;
}

/**
 * Полный прогон: делает вид, что с сайта пришла заявка.
 * Пишет строку в таблицу и шлёт сообщение — ровно как в боевом режиме.
 * Строку потом удалите из таблицы вручную.
 */
function testLead() {
  var row = {
    date: new Date(),
    name: 'Тестовая заявка',
    phone: '+7 000 000-00-00',
    telegram: '@test',
    league: 'Лига 12 · Старт — $25',
    game: 'суббота, 3 января · Лига 12 · Русский',
    lang: 'ru',
    page: 'проверка из редактора',
    referrer: '',
    utm: ''
  };

  appendLead(row);
  var sent = notifyTelegram(row);

  if (!sent.ok) {
    throw new Error('\nСтрока в таблицу записана, но в Telegram не ушло.\n' +
                    'Ответ Telegram: ' + sent.error + '\n' +
                    (sent.hint || '') + '\n');
  }
  return 'Готово: строка в таблице и сообщение в группе.';
}
