require('dotenv').config();

const PORT = process.env.PORT;
const RPC_URL = process.env.RPC_URL
const WS_URL = process.env.WS_URL
const LOCAL_HOST = process.env.LOCAL_HOST

// Statuses
const STATUS_HEALTHY = "healthy";
const STATUS_HEALTHY_UNKNOWN = "healthy unknown";
const STATUS_LAGGING = "lagging";
const STATUS_OFFLINE = "offline";

// Telegram configuration
const TELEGRAM_API_URL = process.env.TELEGRAM_API_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Notification interval
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL, 10) || 10000;

module.exports = {
    PORT,
    RPC_URL,
    WS_URL,
    LOCAL_HOST,
    CHECK_INTERVAL,
    STATUS_HEALTHY,
    STATUS_HEALTHY_UNKNOWN,
    STATUS_LAGGING,
    STATUS_OFFLINE,
    TELEGRAM_API_URL,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID
};