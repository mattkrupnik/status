require('dotenv').config();

const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");

const status = express();
const PORT = process.env.PORT;

const RPC_URL = process.env.RPC_URL
const WS_URL = process.env.WS_URL
const MAX_SLOT_LAG = parseInt(process.env.MAX_SLOT_LAG, 10);
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL, 10);

const STATUS_HEALTHY = "healthy";
const STATUS_LAGGING = "lagging";
const STATUS_OFFLINE = "offline";

const TELEGRAM_API_URL = process.env.TELEGRAM_API_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

let uptimeStart = Date.now();
let isWebSocketConnected = false;
let ws;
let lastValidatorStatus = null;
let lastAlertTime = 0;

async function sendTelegramMessage(message) {

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        logWithTimestamp("⚠️ Telegram Bot Token or Chat ID is missing, skipping message.");
        return; // Exit the function early without sending the message
    }

    const url = `${TELEGRAM_API_URL}${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {chat_id: TELEGRAM_CHAT_ID, text: message};

    try {
        const response = await axios.post(url, payload);
        if (!response.data.ok) {
            logWithTimestamp("❌ Error sending Telegram message:", response.data.description);
        } else {
            logWithTimestamp("✅ Telegram message sent");
        }
    } catch (error) {
        logWithTimestamp("❌ Error sending Telegram message:", error.message);
    }
}

async function getValidatorSlot() {
    try {
        const response = await axios.post(RPC_URL, {jsonrpc: "2.0", id: 1, method: "getSlot"});
        return response.data.result;
    } catch (error) {
        logWithTimestamp("❌ Error fetching validator slot:", error.message);
        return null;
    }
}

async function getFinalizedSlot() {
    try {
        const response = await axios.post(RPC_URL, {jsonrpc: "2.0", id: 1, method: "getMaxRetransmitSlot"});
        return response.data.result;
    } catch (error) {
        logWithTimestamp("❌ Error fetching finalized slot:", error.message);
        return null;
    }
}

async function getBlockHash() {
    try {
        const validatorSlot = await getValidatorSlot();
        const response = await axios.post(RPC_URL, {
            jsonrpc: "2.0",
            id: 1,
            method: "getBlock",
            params: [validatorSlot]
        });
        return response.data.result ? response.data.result.blockhash : null;
    } catch (error) {
        logWithTimestamp("❌ Error fetching block hash:", error.message);
        return null;
    }
}

async function checkValidatorHealth() {
    const validatorSlot = await getValidatorSlot();
    const finalizedSlot = await getFinalizedSlot();

    if (validatorSlot === null || finalizedSlot === null || finalizedSlot === 0) {
        return {status: STATUS_OFFLINE, message: "Validator might be offline or unresponsive"};
    }

    const slotLag = finalizedSlot - validatorSlot;
    if (slotLag > MAX_SLOT_LAG) {
        return {status: STATUS_LAGGING, message: `Validator is behind by ${slotLag} slots`};
    }

    return {status: STATUS_HEALTHY, validatorSlot, finalizedSlot};
}

async function monitorValidatorStatus() {
    const validatorStatus = await checkValidatorHealth();

    if (lastValidatorStatus && lastValidatorStatus.status !== validatorStatus.status) {
        const now = Date.now();

        // Check if the status is healthy
        if (validatorStatus.status === STATUS_HEALTHY) {
            await sendTelegramMessage(`✅ Status: ${STATUS_HEALTHY}`);
            logWithTimestamp(validatorStatus);
        }
        // Check if the status is lagging
        else if (validatorStatus.status === STATUS_LAGGING) {
            await sendTelegramMessage(`⚠️ Status: ${STATUS_LAGGING}\n💬 ${validatorStatus.message}`);
            logWithTimestamp(validatorStatus);
        }
        // Check if the status is offline
        else if (validatorStatus.status === STATUS_OFFLINE) {
            await sendTelegramMessage(`❌ Status: ${STATUS_OFFLINE}\n💬 ${validatorStatus.message}`);
            logWithTimestamp(validatorStatus);
        }

        lastAlertTime = now;
    }

    lastValidatorStatus = validatorStatus;
}

setInterval(monitorValidatorStatus, CHECK_INTERVAL);

function getUptime() {
    const uptimeMs = Date.now() - uptimeStart;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}

function logWithTimestamp(message) {
    const now = new Date().toISOString();

    if (typeof message === 'object' && message !== null) {
        message = JSON.stringify(message, null, 2);
    }

    console.log(`[${now}] ${message}`);
}

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        logWithTimestamp("✅ WebSocket already connected");
        return;
    }

    logWithTimestamp("🔌 Connecting to WebSocket...");
    ws = new WebSocket(WS_URL);

    ws.on("open", () => {
        logWithTimestamp("✅ WebSocket connected");
        isWebSocketConnected = true;
        uptimeStart = Date.now();
    });

    ws.on("close", () => {
        logWithTimestamp("❌ WebSocket disconnected! Reconnecting...");
        isWebSocketConnected = false;
        setTimeout(connectWebSocket, 5000);
    });

    ws.on("error", (err) => {
        logWithTimestamp("⚠️ WebSocket error:", err.message);
    });
}

status.get("/status", async (req, res) => {
    const validatorStatus = await checkValidatorHealth();
    const blockHash = await getBlockHash();

    const slotLag = validatorStatus.finalizedSlot - validatorStatus.validatorSlot;

    const response = {
        ...validatorStatus,
        slotLag: slotLag >= 0 ? slotLag : "N/A",
        blockHash: validatorStatus.status === STATUS_HEALTHY ? blockHash || "N/A" : "N/A",
        uptime: getUptime(),
        websocket: isWebSocketConnected ? "connected" : "disconnected"
    };

    res.json(response);

});

connectWebSocket();

try {
    status.listen(PORT, () => {
        logWithTimestamp(`🚀 X1 Validator status checker running on ${process.env.LOCAL_HOST}:${PORT}`);
        sendTelegramMessage('🚀 X1 Validator Status Checker has started! Monitoring the validator status...')
            .then(() => logWithTimestamp("✅ Startup message sent to Telegram"))
            .catch((err) => logWithTimestamp("❌ Failed to send startup message:", err.message));
    });
} catch (error) {
    logWithTimestamp("❌ Failed to start server:", error.message);
    process.exit(1);
}
