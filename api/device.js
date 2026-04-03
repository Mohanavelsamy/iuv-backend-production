const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function generateDeviceId() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

router.get("/generate-device-id", async (req, res) => {
  try {
    let deviceId;
    let exists = true;

    while (exists) {
      deviceId = generateDeviceId();

      const { data } = await supabase
        .from("device_registry")
        .select("device_id")
        .eq("device_id", deviceId)
        .maybeSingle();

      if (!data) exists = false;
    }

    const { error } = await supabase
      .from("device_registry")
      .insert([
        {
          device_id: deviceId,
          pairing_status: "pending",
        },
      ]);

    if (error) throw error;

    res.json({ device_id: deviceId });

  } catch (err) {
    console.error("Device ID error:", err);
    res.status(500).json({ error: "Failed to generate device ID" });
  }
});

// ✅ VERY IMPORTANT
module.exports = router;