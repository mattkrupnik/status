require('dotenv').config();

const express = require("express");
const axios = require("axios");
const WebSocket = require("ws");

const status = express();
const PORT = process.env.PORT;

const RPC_URL = process.env.RPC_URL
const WS_URL = process.env.WS_URL
const MAX_SLOT_LAG = parseInt(process.env.MAX_SLOT_LAG, 10);

let uptimeStart = Date.now();
let isWebSocketConnected = false;
let ws;

async function getValidatorSlot() {
    try {
        const response = await axios.post(RPC_URL, {jsonrpc: "2.0", id: 1, method: "getSlot"});
        return response.data.result;
    } catch (error) {
        console.error("❌ Error fetching validator slot:", error.message);
        return null;
    }
}

async function getFinalizedSlot() {
    try {
        const response = await axios.post(RPC_URL, {jsonrpc: "2.0", id: 1, method: "getMaxRetransmitSlot"});
        return response.data.result;
    } catch (error) {
        console.error("❌ Error fetching finalized slot:", error.message);
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
        if (response.data.result) {
            return response.data.result.blockhash;
        }
        return null;
    } catch (error) {
        console.error("❌ Error fetching block hash:", error.message);
        return null;
    }
}

async function checkValidatorHealth() {
    const validatorSlot = await getValidatorSlot();
    const finalizedSlot = await getFinalizedSlot();

    if (validatorSlot === null || finalizedSlot === null) {
        return {status: "offline", message: "Validator might be offline or unresponsive"};
    }

    const slotLag = finalizedSlot - validatorSlot;
    if (slotLag > MAX_SLOT_LAG) {
        return {status: "lagging", message: `Validator is behind by ${slotLag} slots`};
    }

    return {status: "healthy", validatorSlot, finalizedSlot};
}

function getUptime() {
    const uptimeMs = Date.now() - uptimeStart;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}

function connectWebSocket() {
    console.log("🔌 Connecting to WebSocket...");

    ws = new WebSocket(WS_URL);

    ws.on("open", () => {
        console.log("✅ WebSocket connected");
        isWebSocketConnected = true;
        uptimeStart = Date.now();
    });

    ws.on("close", () => {
        console.log("❌ WebSocket disconnected! Reconnecting...");
        isWebSocketConnected = false;
        setTimeout(connectWebSocket, 5000);
    });

    ws.on("error", (err) => {
        console.error("⚠️ WebSocket error:", err.message);
    });
}

status.get("/status", async (req, res) => {
    const validatorStatus = await checkValidatorHealth();
    const blockHash = await getBlockHash();

    const slotLag = validatorStatus.finalizedSlot - validatorStatus.validatorSlot;

    res.json({
        ...validatorStatus,
        blockHash: blockHash || "N/A",
        slotLag: slotLag,
        uptime: getUptime(),
        websocket: isWebSocketConnected ? "connected" : "disconnected",
    });
});

connectWebSocket();

status.listen(PORT, () => {
    console.log(`🚀 X1 Validator status checker running on ${process.env.LOCAL_HOST}:${process.env.PORT}`);
});
