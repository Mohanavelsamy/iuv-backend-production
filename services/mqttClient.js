const mqtt = require("mqtt");
const redis = require("./redisClient");
const supabase = require("../config/supabase");
let client;

async function connect() {
  if (client && client.connected) return client;

  if (!process.env.MQTT_HOST) {
    throw new Error("MQTT_HOST is required");
  }

  client = mqtt.connect(process.env.MQTT_HOST, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
  });

  client.on("connect", () => {
    console.log("[MQTT] Connected");
    // Subscribe once for device heartbeat ingestion.
    client.subscribe("iuv/taluk/+/heartbeat", { qos: 1 }, (err) => {
      if (err) {
        console.error("[MQTT] Heartbeat subscribe failed:", err.message || err);
      }
    });
  });

  client.on("error", (err) => {
    console.error("[MQTT] Error:", err.message);
  });

  client.on("message", async (topic, message) => {
    try {
      const data = JSON.parse(message.toString());

      // Example topic: iuv/taluk/NAMAKKAL/heartbeat
      if (topic.includes("heartbeat")) {
        const userId = data.userId;
        const talukId = data.talukId;

        if (!userId || !talukId) return;

        const now = Date.now();
        const lastSeenKey = `lastSeen:${userId}`;
        const activeKey = `active:taluk:${talukId}`;

        // Check whether user is already active in this taluk
        const isActive = await redis.sismember(activeKey, String(userId));

        await Promise.all([
          redis.sadd(activeKey, String(userId)),
          redis.set(lastSeenKey, String(now))
        ]);

        // First time online event
        if (!isActive) {
          console.log(`🟢 User ONLINE → ${userId}`);
          const nowIso = new Date().toISOString();
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayStartIso = todayStart.toISOString();

          // Daily first-login tracking:
          // update if older than today; if no row matched, try NULL fallback.
          const { data: olderUpdateRows, error: olderErr } = await supabase
            .from("pairing_database")
            .update({
              first_online_today: nowIso
            })
            .eq("user_id", String(userId))
            .lt("first_online_today", todayStartIso)
            .select("user_id");

          if (olderErr) {
            console.error("[MQTT] first_online_today older update failed:", olderErr.message || olderErr);
          } else if (!olderUpdateRows || olderUpdateRows.length === 0) {
            const { error: nullErr } = await supabase
              .from("pairing_database")
              .update({
                first_online_today: nowIso
              })
              .eq("user_id", String(userId))
              .is("first_online_today", null);

            if (nullErr) {
              console.error(
                "[MQTT] first_online_today null update failed:",
                nullErr.message || nullErr
              );
            }
          }
        }

        console.log(`💓 Heartbeat saved → ${userId}`);
      }
    } catch (err) {
      console.error("❌ Heartbeat error:", err);
    }
  });

  return client;
}

async function publish(topic, payload, options = {}) {
  if (!client || !client.connected) {
    await connect();
  }

  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), options, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function isMQTTConnected() {
  return Boolean(client && client.connected);
}

module.exports = { connect, publish, isMQTTConnected };

