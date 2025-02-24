const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");
const status = express();
const {
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
} = require('./env');
const {logWithTimestamp, getUptime} = require('./helper');

let uptimeStart = Date.now();
let isWebSocketConnected = false;
let ws;
let lastValidatorStatus = null;
let lastAlertTime = 0;
let wsReconnectAttempts = 0;

async function sendTelegramMessage(message, logData = {}) {

    if (!TELEGRAM_BOT_TOKEN && !TELEGRAM_CHAT_ID) {
        logWithTimestamp("⚠️ Telegram Bot Token or Chat ID is missing, skipping message.");
        return;
    }

    const url = `${TELEGRAM_API_URL}${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {chat_id: TELEGRAM_CHAT_ID, text: message};

    try {
        const response = await axios.post(url, payload);
        if (!response.data.ok) {
            logWithTimestamp("❌ Error sending Telegram message:", response.data.description);
        } else {
            logWithTimestamp("✅ Telegram message sent");
            logWithTimestamp(logData);
        }
    } catch (error) {
        logWithTimestamp("❌ Error sending Telegram message:", error.message);
    }
}

async function getSlotWithCommitment(commitment) {
    try {
        const response = await axios.post(RPC_URL, {
            jsonrpc: "2.0", id: 1, method: "getSlot", params: [{commitment}]
        });

        return response.data.result;
    } catch (error) {
        logWithTimestamp(`❌ Error fetching ${commitment} slot:`, error.message);
        return null;
    }
}

async function fetchSlots() {
    const finalizedSlot = await getSlotWithCommitment("finalized");
    const confirmedSlot = await getSlotWithCommitment("confirmed");
    const processedSlot = await getSlotWithCommitment("processed");

    return {
        finalizedSlot: finalizedSlot,
        confirmedSlot: confirmedSlot,
        processedSlot: processedSlot
    }
}

async function getHealth() {
    try {
        const response = await axios.post(RPC_URL, {
            jsonrpc: "2.0", id: 1, method: "getHealth"
        });

        const {data} = response;

        if (data.result === 'ok') {
            return {status: STATUS_HEALTHY};
        }

        if (data.error) {
            const {message, data: errorData} = data.error;
            if (message === 'Node is unhealthy') {
                return {status: STATUS_HEALTHY_UNKNOWN, message: message};
            }

            return {status: STATUS_LAGGING, message: message, numSlotsBehind: errorData?.numSlotsBehind ?? 0};
        }

        return {status: STATUS_HEALTHY_UNKNOWN};
    } catch (err) {
        return {status: STATUS_OFFLINE};
    }
}

async function monitorValidatorStatus() {
    const healthStatus = await getHealth();
    const sendMessage = (lastValidatorStatus && lastValidatorStatus !== healthStatus.status) || healthStatus.status === STATUS_LAGGING;

    if (sendMessage) {
        const now = Date.now();

        // Check if the status is healthy
        if (healthStatus.status === STATUS_HEALTHY) {
            await sendTelegramMessage(`✅ Status: ${STATUS_HEALTHY}`, healthStatus);
        }
        // Check if the status is lagging
        else if (healthStatus.status === STATUS_LAGGING) {
            await sendTelegramMessage(`⚠️ Status: ${STATUS_LAGGING}\n💬 ${healthStatus.message}`, healthStatus);
        }
        // Check if the status is healthy unknown
        else if (healthStatus.status === STATUS_HEALTHY_UNKNOWN) {
            await sendTelegramMessage(`❌ Status: ${STATUS_HEALTHY_UNKNOWN}`, healthStatus);
        }
        // Check if the status is offline
        else if (healthStatus.status === STATUS_OFFLINE) {
            await sendTelegramMessage(`❌ Status: ${STATUS_OFFLINE}`, healthStatus);
        }

        lastAlertTime = now;
    }

    lastValidatorStatus = healthStatus.status;
}

if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    setInterval(monitorValidatorStatus, CHECK_INTERVAL);
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
        wsReconnectAttempts = 0;
    });

    ws.on("close", () => {
        logWithTimestamp("❌ WebSocket disconnected! Reconnecting...");
        isWebSocketConnected = false;
        setTimeout(connectWebSocket, Math.min(5000 * Math.pow(2, wsReconnectAttempts), 30000));
        wsReconnectAttempts += 1;
    });

    ws.on("error", (err) => {
        sendTelegramMessage(`❌ Status: ${STATUS_OFFLINE}`);
        logWithTimestamp("⚠️ WebSocket error:", err.message);
    });
}

status.get("/status", async (req, res) => {
    const healthStatus = await getHealth();
    const fetchedSlots = await fetchSlots();

    const response = {
        ...healthStatus,
        ...fetchedSlots,
        ...(healthStatus.numSlotsBehind > 0 && {numSlotsBehind: healthStatus.numSlotsBehind}),
        uptime: getUptime(),
        websocket: isWebSocketConnected ? "connected" : "disconnected"
    };

    res.json(response);

});

connectWebSocket();

try {
    status.listen(PORT, () => {
        sendTelegramMessage('🚀 X1 Validator Status Checker has started! Monitoring the validator status...')
            .then(() => logWithTimestamp(`🚀 X1 Validator status checker running on ${LOCAL_HOST}:${PORT}`))
            .catch((err) => logWithTimestamp("❌ Failed to send startup message:", err.message));
    });
} catch (error) {
    logWithTimestamp("❌ Failed to start server:", error.message);
    process.exit(1);
}
