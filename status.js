const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");
const status = express();
const {
    PORT,
    RPC_URL,
    WS_URL,
    LOCAL_HOST,
    MAX_WS_RECONNECT_ATTEMPTS,
    CHECK_INTERVAL,
    MAX_SLOTS_BEHIND_NOTIFICATIONS,
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
let wsReconnectAttempts = 0;
let isProcessing = false;
let lastNumSlotsBehind = null;
let slotsBehindCounter = 0;

async function sendTelegramMessage(message, logData = null) {
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
            if (logData) {
                logWithTimestamp(logData);
            }
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

        if (data.error?.data?.numSlotsBehind > 0) {
            const {message, data: errorData} = data.error;
            return {status: STATUS_LAGGING, message: message, numSlotsBehind: errorData?.numSlotsBehind ?? 0};
        }

        return {status: STATUS_HEALTHY_UNKNOWN};
    } catch (err) {
        return {status: STATUS_OFFLINE};
    }
}

async function monitorValidatorStatus() {
    if (isProcessing) {
        console.log("⏳ monitorValidatorStatus is already running, skipping...");
        return;
    }

    isProcessing = true;

    try {
        const healthStatus = await getHealth();

        let message = "";

        if (lastValidatorStatus === null || lastValidatorStatus !== healthStatus.status) {
            if (healthStatus.status === STATUS_HEALTHY) {
                message = `✅ Status: ${STATUS_HEALTHY}`;
            } else if (healthStatus.status === STATUS_LAGGING) {
                message = `⚠️ Status: ${STATUS_LAGGING}\n💬 ${healthStatus.message}`;
            } else if (healthStatus.status === STATUS_HEALTHY_UNKNOWN) {
                message = `❌ Status: ${STATUS_HEALTHY_UNKNOWN}`;
            } else if (healthStatus.status === STATUS_OFFLINE) {
                message = `❌ Status: ${STATUS_OFFLINE}`;
            }

            lastNumSlotsBehind = healthStatus.numSlotsBehind ?? 0;
            slotsBehindCounter = 0;
        } else if (healthStatus.status === STATUS_LAGGING && healthStatus.numSlotsBehind !== lastNumSlotsBehind) {
            if (slotsBehindCounter < MAX_SLOTS_BEHIND_NOTIFICATIONS) {
                message = `⚠️ Slots behind: ${healthStatus.numSlotsBehind}`;
                slotsBehindCounter++;
            } else if (slotsBehindCounter === MAX_SLOTS_BEHIND_NOTIFICATIONS) {
                message = "⚠️ Validator is behind, we will inform you when the status changes.";
                slotsBehindCounter++;
            }
            lastNumSlotsBehind = healthStatus.numSlotsBehind;
        }

        if (message) {
            await sendTelegramMessage(message, healthStatus);
        }

        lastValidatorStatus = healthStatus.status;

    } catch (err) {
        console.log(`❌ Error in monitorValidatorStatus: ${err.message}`);
    } finally {
        isProcessing = false;
        setTimeout(monitorValidatorStatus, CHECK_INTERVAL);
    }
}

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        logWithTimestamp("✅ WebSocket already connected");
        return;
    }

    if (wsReconnectAttempts >= MAX_WS_RECONNECT_ATTEMPTS) {
        logWithTimestamp("❌ Max WebSocket reconnect attempts reached. Stopping reconnection.");
        return;
    }

    logWithTimestamp(`🔌 Connecting to WebSocket... (Attempt ${wsReconnectAttempts + 1}/${MAX_WS_RECONNECT_ATTEMPTS})`);
    ws = new WebSocket(WS_URL);

    ws.on("open", () => {
        logWithTimestamp("✅ WebSocket connected");
        isWebSocketConnected = true;
        uptimeStart = Date.now();
        wsReconnectAttempts = 0;
    });

    ws.on("close", () => {
        logWithTimestamp("❌ WebSocket disconnected!");

        isWebSocketConnected = false;
        wsReconnectAttempts += 1;

        if (wsReconnectAttempts < MAX_WS_RECONNECT_ATTEMPTS) {
            const retryDelay = 15000;
            logWithTimestamp(`🔄 Reconnecting in ${retryDelay / 1000} seconds...`);
            setTimeout(connectWebSocket, retryDelay);
        } else {
            logWithTimestamp("⛔ Stopped WebSocket reconnection after maximum attempts.");
        }
    });

    ws.on("error", (err) => {
        logWithTimestamp("⚠️ WebSocket error: " + err.message);
        sendTelegramMessage(`❌ Cannot connect to WebSocket server (Attempt ${wsReconnectAttempts + 1}/${MAX_WS_RECONNECT_ATTEMPTS})`)
            .catch((err) => logWithTimestamp("❌ Error sending Telegram message for WebSocket error:", err.message));
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

status.listen(PORT, async () => {
    try {
        await sendTelegramMessage('🚀 X1 Validator Status Checker has started! Monitoring the validator status...');
        logWithTimestamp(`🚀 X1 Validator status checker running on ${LOCAL_HOST}:${PORT}`);

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
            monitorValidatorStatus().catch(err => logWithTimestamp("❌ Error in monitorValidatorStatus:", err.message));
        }

    } catch (err) {
        logWithTimestamp("❌ Failed to send startup message:", err.message);
    }
});

status.on("error", (err) => {
    logWithTimestamp("❌ Failed to start server:", err.message);
    process.exit(1);
});