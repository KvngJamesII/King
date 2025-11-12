const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
const fs = require('fs');
const config = require('./config');

puppeteer.use(StealthPlugin());

// Single instance protection
let botInstance = null;
let lastSmsId = 0;
let isPolling = false;
let browser = null;
let page = null;

function createAuthHeader() {
  const credentials = `${config.API_USERNAME}:${config.API_PASSWORD}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

async function initializeBrowser() {
  try {
    console.log('🌐 Initializing browser...');

    let chromePath = '/usr/bin/google-chrome';

    if (!fs.existsSync(chromePath)) {
      console.log('⚠️ System Chrome not found, checking Puppeteer...');
      try {
        chromePath = puppeteer.executablePath();
        if (!fs.existsSync(chromePath)) throw new Error('Puppeteer Chrome missing');
        console.log('🧭 Using Puppeteer Chrome at:', chromePath);
      } catch {
        console.log('⚙️ Installing Chromium manually...');
        execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
        chromePath = puppeteer.executablePath();
        console.log('✅ Installed Chromium at:', chromePath);
      }
    } else {
      console.log('🧭 Using system Chrome at:', chromePath);
    }

    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Authorization': createAuthHeader() });

    console.log('🔄 Navigating to API...');
    await page.goto(config.API_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    console.log('✅ Browser initialized and ready');
    return true;
  } catch (err) {
    console.error('❌ Failed to initialize browser:', err.message);
    return false;
  }
}

async function fetchLatestSMS() {
  try {
    if (!page) {
      console.log('No browser page, initializing...');
      const success = await initializeBrowser();
      if (!success) return [];
    }

    const url = lastSmsId > 0
      ? `${config.API_URL}?per-page=${config.MAX_PER_PAGE}&id=${lastSmsId}`
      : `${config.API_URL}?per-page=${config.MAX_PER_PAGE}`;

    const smsData = await page.evaluate(async (apiUrl, authHeader) => {
      try {
        const response = await fetch(apiUrl, { 
          headers: { 
            'Authorization': authHeader, 
            'Accept': 'application/json' 
          } 
        });
        if (response.ok) {
          return { success: true, data: await response.json() };
        } else {
          return { success: false, status: response.status, statusText: response.statusText };
        }
      } catch (err) {
        return { success: false, error: err.message };
      }
    }, url, createAuthHeader());

    if (smsData && smsData.success && Array.isArray(smsData.data)) {
      return smsData.data;
    }
    
    if (smsData && !smsData.success) {
      if (smsData.status === 429) {
        console.log('⚠️ API Rate limit hit - consider increasing poll interval');
      } else {
        console.log(smsData.status ? `API status: ${smsData.status}` : `Fetch error: ${smsData.error}`);
      }
    }
    return [];
  } catch (err) {
    console.error('Error fetching SMS:', err.message);
    if (browser) await browser.close().catch(() => {});
    browser = null; 
    page = null;
    return [];
  }
}

async function sendOTPToTelegram(sms) {
  try {
    const source = sms.source_addr || 'Unknown';
    const destination = sms.destination_addr || 'Unknown';
    let message = (sms.short_message || 'No content').replace(/\u0000/g, '');

    const formatted = `
🔔 *NEW OTP RECEIVED*
━━━━━━━━━━━━━━━━━━━━
📤 *Source:* \`${source}\`
📱 *Destination:* \`${destination}\`

💬 *Message:*
\`\`\`
${message}
\`\`\`
━━━━━━━━━━━━━━━━━━━━
⏰ _${new Date().toLocaleString()}_
`;
    await botInstance.sendMessage(config.TELEGRAM_CHAT_ID, formatted, { parse_mode: 'Markdown' });
    console.log(`✓ Sent OTP from ${source} to Telegram`);
  } catch (err) {
    console.error('Failed to send Telegram message:', err.message);
  }
}

async function pollSMSAPI() {
  if (isPolling) return;
  isPolling = true;

  try {
    const messages = await fetchLatestSMS();
    if (messages.length) {
      console.log(`📬 Found ${messages.length} new SMS`);
      for (const sms of messages) {
        if ((sms.id || 0) > lastSmsId) {
          await sendOTPToTelegram(sms);
          lastSmsId = sms.id || lastSmsId;
        }
      }
    } else {
      console.log('📭 No new SMS messages');
    }
  } catch (err) {
    console.error('Polling error:', err.message);
  } finally {
    isPolling = false;
  }
}

async function startBot() {
  // Prevent multiple instances
  if (botInstance) {
    console.log('⚠️ Bot instance already running');
    return;
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Telegram OTP Bot Starting...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Initialize bot with single instance
  botInstance = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { 
    polling: {
      interval: 300,
      autoStart: true,
      params: {
        timeout: 10
      }
    }
  });

  // Bot commands
  botInstance.onText(/\/start/, (msg) => 
    botInstance.sendMessage(msg.chat.id, '🤖 OTP Bot active!')
  );

  botInstance.onText(/\/status/, (msg) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    botInstance.sendMessage(msg.chat.id,
      `📊 Bot Status:\n✅ Running\n🆔 Last SMS ID: ${lastSmsId}\n⏱️ Poll Interval: ${config.POLL_INTERVAL/1000}s\n🌐 Browser: ${browser ? 'Active' : 'Not initialized'}\n⏰ Uptime: ${hours}h ${minutes}m`
    );
  });

  // Error handling
  botInstance.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.code);
    if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
      console.error('💥 CRITICAL: Multiple bot instances detected!');
      console.error('Please stop all other instances and redeploy as Background Worker');
    }
  });

  console.log(`📡 Polling every ${config.POLL_INTERVAL/1000}s`);
  console.log(`💬 Forwarding to: ${config.TELEGRAM_CHAT_ID}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await initializeBrowser();
  await pollSMSAPI();
  setInterval(pollSMSAPI, config.POLL_INTERVAL);
}

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Shutting down bot...');
  if (botInstance) {
    await botInstance.stopPolling();
  }
  if (browser) {
    await browser.close();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the bot
startBot();
