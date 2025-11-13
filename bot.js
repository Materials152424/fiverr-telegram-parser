const { chromium } = require('playwright');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');

// === НАСТРОЙКИ ===
const token = process.env.TOKEN || '7613508430:AAFLWdjJgKs4V-XcKufyOE78-1nJDiWHJ68';
const bot = new TelegramBot(token, { polling: true });

// Файлы
const SETTINGS_FILE = path.join(__dirname, 'userSettings.json');
const SENT_FILE = path.join(__dirname, 'sentData.json');
const PROFILE_DIR = path.join(__dirname, 'profile');

// Создаём папку профиля
fs.ensureDirSync(PROFILE_DIR);

// Загрузка данных
let userSettings = fs.existsSync(SETTINGS_FILE) ? fs.readJsonSync(SETTINGS_FILE) : {};
let sentData = fs.existsSync(SENT_FILE) ? fs.readJsonSync(SENT_FILE) : { links: [], sellers: [] };
const sentLinks = new Set(sentData.links);
const sentSellers = new Set(sentData.sellers);

// Сохранение
function saveData() {
  fs.writeJsonSync(SETTINGS_FILE, userSettings, { spaces: 2 });
  fs.writeJsonSync(SENT_FILE, { links: [...sentLinks], sellers: [...sentSellers] }, { spaces: 2 });
}

// Флаги
function getFlag(code) {
  return code.replace(/./g, char => String.fromCodePoint(0x1F1E6 + char.charCodeAt(0) - 65));
}

// Страны
const COUNTRIES = {
  'US': 'США', 'GB': 'Великобритания', 'CA': 'Канада', 'AU': 'Австралия',
  'DE': 'Германия', 'FR': 'Франция', 'IT': 'Италия', 'ES': 'Испания',
  'NL': 'Нидерланды', 'PL': 'Польша', 'BR': 'Бразилия', 'IN': 'Индия',
  'CN': 'Китай', 'JP': 'Япония', 'KR': 'Южная Корея', 'ID': 'Индонезия',
  'PK': 'Пакистан', 'NG': 'Нигерия', 'ZA': 'ЮАР', 'EG': 'Египет',
  'TR': 'Турция', 'TH': 'Таиланд', 'VN': 'Вьетнам', 'PH': 'Филиппины',
  'UA': 'Украина', 'RO': 'Румыния', 'IL': 'Израиль', 'MX': 'Мексика',
  'AE': 'ОАЭ', 'SA': 'Саудовская Аравия', 'QA': 'Катар', 'SG': 'Сингапур',
};

// === ФУНКЦИИ ===
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildFiverrUrl(query, countries) {
  const countryCodes = countries.join('%2C');
  return `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(query)}&source=drop_down_filters&ref=seller_level%3Ana%7Cis_seller_online%3Atrue%7Cseller_location%3A${countryCodes}&filter=new`;
}

async function parseFiverr(url) {
  let browser;
  try {
    browser = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(randomDelay(3000, 7000));

    await page.waitForSelector('.gig-card-layout', { timeout: 30000 });
    await page.waitForTimeout(randomDelay(2000, 5000));

    const gigs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.gig-card-layout')).map(gig => {
        const titleEl = gig.querySelector('.f2YMuU6');
        const linkEl = gig.querySelector('a');
        if (titleEl && linkEl) {
          const title = titleEl.innerText.trim();
          const href = linkEl.getAttribute('href');
          const url = `https://www.fiverr.com${href}`;
          const seller = href.split('/')[1];
          return { title, url, seller };
        }
      }).filter(Boolean);
    });

    return gigs;
  } catch (error) {
    console.error("Парсинг ошибка:", error.message);
    return [];
  } finally {
    if (browser) {
      for (const page of browser.pages()) await page.close().catch(() => {});
      await browser.close();
    }
  }
}

// === БОТ ===
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const opts = {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Поиск гигов', callback_data: 'search_gigs' }],
        [{ text: 'Настройки стран', callback_data: 'settings_countries' }],
        [{ text: 'Сброс отправленных', callback_data: 'reset_sent' }],
      ]
    }
  };
  bot.sendMessage(chatId, 'Привет! Я парсер Fiverr\n\nВыбери действие:', opts);
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  setTimeout(() => bot.answerCallbackQuery(query.id).catch(() => {}), 100);

  try {
    if (data === 'search_gigs') {
      const settings = userSettings[chatId] || { query: 'design', countries: ['US', 'GB', 'CA'] };
      const countryNames = settings.countries.map(code => `${getFlag(code)} ${COUNTRIES[code] || code}`).join(', ');

      const keyboard = {
        inline_keyboard: [
          [{ text: 'Изменить запрос', callback_data: 'change_query' }],
          [{ text: 'Изменить страны', callback_data: 'settings_countries' }],
          [{ text: 'Начать поиск', callback_data: 'start_parsing' }],
          [{ text: 'Назад', callback_data: 'back_to_menu' }],
        ]
      };

      await bot.sendMessage(chatId, `
Текущие настройки:
Поиск: *${settings.query}*
Страны: ${countryNames || '—'}

Выбери действие:
      `.trim(), { parse_mode: 'Markdown', reply_markup: keyboard });

    } else if (data === 'change_query') {
      await bot.sendMessage(chatId, 'Введи слово для поиска (например: logo, video, seo):');
      bot.once('message', (msg) => {
        const q = msg.text.trim();
        if (!userSettings[chatId]) userSettings[chatId] = {};
        userSettings[chatId].query = q;
        saveData();
        bot.sendMessage(chatId, `Запрос: *${q}*`, { parse_mode: 'Markdown' });
      });

    } else if (data === 'settings_countries') {
      await updateCountryKeyboard(chatId, query.message.message_id);

    } else if (data.startsWith('toggle_')) {
      const code = data.split('_')[1];
      if (!userSettings[chatId]) userSettings[chatId] = { countries: [] };
      const idx = userSettings[chatId].countries.indexOf(code);
      if (idx === -1) userSettings[chatId].countries.push(code);
      else userSettings[chatId].countries.splice(idx, 1);
      saveData();
      await updateCountryKeyboard(chatId, query.message.message_id);

    } else if (data === 'countries_done') {
      await bot.sendMessage(chatId, 'Страны сохранены!', {
        reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'search_gigs' }]] }
      });

    } else if (data === 'start_parsing') {
      const settings = userSettings[chatId];
      if (!settings || !settings.query || !settings.countries.length) {
        await bot.sendMessage(chatId, 'Настрой запрос и страны!');
        return;
      }
      await bot.sendMessage(chatId, 'Сколько гигов? (1–20)');
      bot.once('message', async (msg) => {
        const count = parseInt(msg.text);
        if (isNaN(count) || count < 1 || count > 20) {
          await bot.sendMessage(chatId, '1–20');
          return;
        }
        const url = buildFiverrUrl(settings.query, settings.countries);
        await bot.sendMessage(chatId, `Поиск: *${settings.query}*`, { parse_mode: 'Markdown' });
        const gigs = await parseFiverr(url);
        let sent = 0;
        for (const gig of gigs) {
          if (sent >= count) break;
          if (!sentLinks.has(gig.url) && !sentSellers.has(gig.seller)) {
            await bot.sendMessage(chatId, `*${gig.title}*\n[Открыть](${gig.url})`, {
              parse_mode: 'Markdown', disable_web_page_preview: true
            });
            sentLinks.add(gig.url);
            sentSellers.add(gig.seller);
            sent++;
            await new Promise(r => setTimeout(r, randomDelay(1500, 3500)));
          }
        }
        saveData();
        await bot.sendMessage(chatId, sent > 0 ? `Отправлено: ${sent}` : 'Новых нет');
      });

    } else if (data === 'reset_sent') {
      sentLinks.clear();
      sentSellers.clear();
      saveData();
      await bot.sendMessage(chatId, 'Очищено!', {
        reply_markup: { inline_keyboard: [[{ text: 'Назад', callback_data: 'back_to_menu' }]] }
      });

    } else if (data === 'back_to_menu') {
      await bot.deleteMessage(chatId, query.message.message_id).catch(() => {});
      await bot.sendMessage(chatId, 'Главное меню:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Поиск гигов', callback_data: 'search_gigs' }],
            [{ text: 'Настройки стран', callback_data: 'settings_countries' }],
            [{ text: 'Сброс отправленных', callback_data: 'reset_sent' }],
          ]
        }
      });
    }
  } catch (err) {
    console.error(err);
  }
});

// Обновление клавиатуры стран
async function updateCountryKeyboard(chatId, messageId) {
  const settings = userSettings[chatId] || { countries: [] };
  const rows = [];
  const codes = Object.keys(COUNTRIES);
  for (let i = 0; i < codes.length; i += 2) {
    const c1 = codes[i], c2 = codes[i + 1];
    const t1 = `${settings.countries.includes(c1) ? '✅' : '⬜'} ${getFlag(c1)} ${COUNTRIES[c1]}`;
    const t2 = c2 ? `${settings.countries.includes(c2) ? '✅' : '⬜'} ${getFlag(c2)} ${COUNTRIES[c2]}` : null;
    const row = [{ text: t1, callback_data: `toggle_${c1}` }];
    if (t2) row.push({ text: t2, callback_data: `toggle_${c2}` });
    rows.push(row);
  }
  rows.push([{ text: 'Готово', callback_data: 'countries_done' }]);

  await bot.editMessageText('Выбери страны:', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: rows }
  }).catch(() => {});
}

process.on('SIGINT', () => { saveData(); process.exit(); });
console.log("Бот запущен...");
