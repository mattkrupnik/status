# X1 Validator Status Checker

The application provides an HTTP API (/status) to access the current status of the validator.

## Features

- Fetches the current validator slot.
- Fetches the finalized slot.
- Fetches the current block hash for the validator's slot.
- Monitors WebSocket connection to the validator.
- Tracks application uptime.
- Checks if the validator is lagging behind (based on slot lag).
- Returns a status of the validator (healthy, lagging, or offline).

## Installation

**1. Clone the repository:**
```
git clone https://github.com/mattkrupnik/status.git
```

**2. Navigate into the project directory:**
```
cd status
```

**3. Install dependencies:**

**Node.js is required to run this application.** Once Node.js is installed, run the following command to install the necessary dependencies:
```
npm install
```

**4. Copy the `.env.sample` file to create the `.env` file:**
```
cp .env.sample .env
```
If needed, you can change the values in the .env file. The default values are set, but you can customize them according to your setup.

```dotenv
PORT=3340
RPC_URL=http://localhost:8899
WS_URL=ws://localhost:8900
MAX_SLOT_LAG=50
LOCAL_HOST=localhost
```
- `PORT`: The port on which the server will run.
- `RPC_URL`: The RPC URL of the validator to monitor.
- `WS_URL`: The WebSocket URL for the validator.
- `MAX_SLOT_LAG`: The maximum acceptable slot lag for the validator.
- `LOCAL_HOST`: The host of the application.

**5. Allow access to the application port**
```shell
sudo ufw enable
sudo ufw allow 3340/tcp
sudo ufw reload
```
**6. Run the application:**
```shell
pm2 start status.js --name validator-status
```
You can **define** your custom name instead of `validator-status`.

**7. Save the PM2 process list and enable auto-start on system reboot**
```shell
pm2 save
pm2 startup
```
The server will start on the specified port (default: 3340).
## Stopping and Managing the Application

To stop the application
```shell
pm2 stop validator-status
```
To restart the application
```shell
pm2 restart validator-status
```
To delete the application from PM2
```shell
pm2 delete validator-status
```
To check the application logs
```shell
pm2 logs validator-status
```
To check the status of all running PM2 applications
```shell
pm2 list
```

## API
### GET `/status`
This endpoint provides the current status of the validator.

### Response:
```json
{
    "status": "healthy",
    "message": "Validator is synced",
    "validatorSlot": 53941760,
    "finalizedSlot": 53941765,
    "slotLag": 5,
    "blockHash": "abcd1234efgh5678",
    "uptime": "54h 10m 45s",
    "websocket": "connected"
}
```

- `status`: The health status of the validator (`healthy`, `lagging`, `offline`).
- `message`: A description of the validator's health status.
- `validatorSlot`: The current validator slot.
- `finalizedSlot`: The finalized slot in the network.
- `slotLag`: The difference between the finalized slot and the validator's slot.
- `blockHash`: The block hash of the current validator's slot.
- `uptime`: The uptime of the application since the last restart.
- `websocket`: The WebSocket connection status (`connected`, `disconnected`).

## WebSocket Connection

The application will attempt to connect to the WebSocket URL specified in the .env file. If the connection is lost, the application will automatically attempt to reconnect every 5 seconds.

## Troubleshooting

- **Port and Firewall Issues:** Ensure the PORT specified in .env is open and accessible, and that firewall settings (e.g., UFW) allow incoming traffic on that port.
- **Validator Slot and Finalized Slot Difference (Slot Lag):** If the validator is behind the network by more than the defined `MAX_SLOT_LAG`, the validator's status will be **lagging**. You can increase `MAX_SLOT_LAG` if needed.
- **WebSocket Connection Issues:** Ensure that the WebSocket URL (`WS_URL`) is correct and accessible. If the WebSocket connection fails, the application will retry every 5 seconds.
