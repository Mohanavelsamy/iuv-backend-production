const supabase = require("../config/supabase");

async function sync() {
  try {
    console.log("🔄 Syncing pairing_database → devices...");

    const { data, error } = await supabase.from("pairing_database").select("*");

    if (error) {
      console.error("❌ Fetch error:", error);
      return;
    }

    const rows = data || [];

    for (const row of rows) {
      const isActive = String(row.subscription_status).toLowerCase() === "active";
      const isOnline = String(row.device_status).toLowerCase() === "online";

      if (!isActive || !isOnline) continue;

      const device = {
        id: String(row.user_id), // IMPORTANT
        taluk: row.taluk || "unknown",
        business_category: row.business_category || "",
        excluded_devices: [],
        online: true,
        last_seen: new Date(),
        join_time: new Date()
      };

      const { error: upsertError } = await supabase
        .from("devices")
        .upsert(device, { onConflict: "id" });

      if (upsertError) {
        console.error("❌ Upsert error:", upsertError);
      } else {
        console.log(`✅ Synced device ${device.id}`);
      }
    }

    console.log("✅ Sync complete\n");
  } catch (err) {
    console.error("❌ Unexpected error:", err);
  }
}

// Run every 30 seconds
setInterval(sync, 30000);

// Run immediately
sync();

