require("dotenv").config();

const express = require("express");
const onboardRoute = require("./api/onboardUser");

// ✅ ADD THIS LINE
const deviceRoutes = require("./api/device");

const startScheduler = require("./workers/scheduler");
const startRecoveryWorker = require("./workers/recovery");
const startCleanupWorker = require("./workers/cleanup");
const startMatchmaker = require("./workers/matchmaker");
const mqttClient = require("./services/mqttClient");
require("./workers/redisToSupabaseSync");
require("./workers/offlineDetector");

console.log("Content pipeline started...");

// HTTP API server (for onboarding)
const app = express();
app.use(express.json());

app.use("/api", onboardRoute);

// ✅ ADD THIS LINE
app.use("/api", deviceRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[HTTP] API server listening on port ${PORT}`);
});

// Start scheduler
startScheduler();

// MQTT connection warmup (must not block startup)
mqttClient.connect().catch((err) => {
  console.error("[MQTT] warmup connect failed:", err.message || err);
});

// ✅ ADD THIS
startMatchmaker();

// Recovery worker
setInterval(startRecoveryWorker, 2 * 60 * 1000);

// Cleanup worker
setInterval(startCleanupWorker, 60 * 60 * 1000);