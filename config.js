require('dotenv').config();

module.exports = {
  API_USERNAME: process.env.API_USERNAME,
  API_PASSWORD: process.env.API_PASSWORD,
  API_URL: process.env.API_URL || 'https://d-group.stats.direct/rest/sms',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_IDS: [
    '-1003420206708',  // Original channel
    '-1003151782333',  // Second channel
    '-1002085925533'   // Third channel
  ],
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL) || 10000,
  MAX_PER_PAGE: parseInt(process.env.MAX_PER_PAGE) || 100
};
