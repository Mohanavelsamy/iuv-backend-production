require("dotenv").config();

const redis = require("../services/redisClient");
const supabase = require("../config/supabase");

const TIMEOUT = 3 * 60 * 1000; // 3 minutes
const CHECK_INTERVAL = 30 * 1000;

async function detectOfflineUsers() {
  try {
    const keys = await redis.keys("lastSeen:*");
    const now = Date.now();

    for (const key of keys) {
      const userId = key.split(":")[1];
      const lastSeen = await redis.get(key);

      if (!lastSeen) continue;

      const diff = now - Number(lastSeen);

      if (diff > TIMEOUT) {
        console.log(`🔴 User OFFLINE → ${userId}`);

        // Remove from all taluks (safe)
        const talukKeys = await redis.keys("active:taluk:*");

        for (const tKey of talukKeys) {
          await redis.srem(tKey, userId);
        }

        await redis.del(key);

        // Update Supabase
        await supabase
          .from("pairing_database")
          .update({
            last_offline_today: new Date().toISOString()
          })
          .eq("user_id", userId);
      }
    }
  } catch (err) {
    console.error("❌ Offline detection error:", err.message || err);
  }
}

setInterval(detectOfflineUsers, CHECK_INTERVAL);

console.log("👀 Offline detector started");

