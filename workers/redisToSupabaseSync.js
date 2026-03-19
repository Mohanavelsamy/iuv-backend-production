require("dotenv").config();

const redis = require("../services/redisClient");
const supabase = require("../config/supabase");

const SYNC_INTERVAL = 60 * 1000; // 60 sec

async function syncLastSeen() {
  try {
    const keys = await redis.keys("lastSeen:*");

    if (!keys.length) {
      console.log("⏳ No active users to sync");
      return;
    }

    for (const key of keys) {
      const userId = key.split(":")[1];
      const lastSeen = await redis.get(key);

      if (!lastSeen) continue;

      await supabase
        .from("pairing_database")
        .update({
          last_seen: new Date(Number(lastSeen)).toISOString()
        })
        .eq("user_id", userId);
    }

    console.log(`✅ Synced ${keys.length} users to Supabase`);
  } catch (err) {
    console.error("❌ Sync error:", err.message || err);
  }
}

setInterval(syncLastSeen, SYNC_INTERVAL);

console.log("🔄 Redis → Supabase sync started");

