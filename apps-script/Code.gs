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
 * ВАЖНО: токен живёт в свойствах скрипта и на сайт не попадает.
 * Никогда не вписывайте его прямо в этот файл — он лежит в публичном репозитории.
 */

var SHEET_LEADS = 'Лиды';

var HEADERS = [
  'Дата', 'Имя', 'Телефон', 'Telegram', 'Лига',
  'Язык', 'Страница', 'Источник', 'UTM', 'IP-метка'
];

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

    var row = {
      date: new Date(),
      name: name,
      phone: phone,
      telegram: normalizeTelegram(telegram),
      league: clean(data.league, 40),
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

/** Проверка, что развёртывание живое: откройте адрес /exec в браузере. */
function doGet() {
  return ok({ status: 'ok', service: 'marketgame-leads' });
}

function appendLead(row) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet();
    sheet.appendRow([
      row.date, row.name, row.phone, row.telegram, row.league,
      row.lang, row.page, row.referrer, row.utm, ''
    ]);
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
  }
  return sheet;
}

function notifyTelegram(row) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('BOT_TOKEN');
  var chatId = props.getProperty('CHAT_ID');
  if (!token || !chatId) return;   // ключи ещё не прописаны — заявка всё равно в таблице

  var lines = [
    '<b>Новая заявка</b>',
    '',
    'Имя: ' + esc(row.name),
    row.phone ? 'Телефон: ' + esc(row.phone) : '',
    row.telegram ? 'Telegram: ' + esc(row.telegram) : '',
    row.league ? 'Лига: ' + esc(row.league) : '',
    'Язык страницы: ' + esc(row.lang || '—'),
    row.utm ? 'Метки: ' + esc(row.utm) : '',
    row.referrer ? 'Пришёл с: ' + esc(row.referrer) : ''
  ].filter(function (l) { return l !== ''; });

  var payload = {
    chat_id: chatId,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };

  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    // Telegram недоступен — заявка уже записана в таблицу, не теряем её.
    console.error(err);
  }
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
 * Разовая проверка связки с Telegram.
 * Запустите эту функцию в редакторе (кнопка «Выполнить») — в группу
 * должно прийти тестовое сообщение. Если не пришло, смотрите журнал.
 */
function testTelegram() {
  notifyTelegram({
    name: 'Тестовая заявка',
    phone: '+7 000 000-00-00',
    telegram: '@test',
    league: 'Лига 12',
    lang: 'ru',
    utm: '',
    referrer: ''
  });
}
