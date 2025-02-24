
let uptimeStart = Date.now();

function logWithTimestamp(message) {
    const now = new Date().toISOString();

    if (typeof message === 'object' && message !== null) {
        message = JSON.stringify(message, null, 2);
    }

    console.log(`[${now}] ${message}`);
}

function getUptime() {
    const uptimeMs = Date.now() - uptimeStart;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}

module.exports = {
    logWithTimestamp,
    getUptime
};
