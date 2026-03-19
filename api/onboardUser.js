const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");

router.post("/onboard", async (req, res) => {
  try {
    const { phone, business_name, taluk, business_category } = req.body;

    if (!phone || !business_name || !taluk || !business_category) {
      return res.status(400).json({
        error:
          "Missing required fields: phone, business_name, taluk, business_category"
      });
    }

    // 1) Create user
    const { data: user, error: userError } = await supabase
      .from("users")
      .insert([{ phone, business_name, taluk, business_category }])
      .select()
      .single();

    if (userError) throw userError;

    // 2) Create device
    const deviceId = "tv_" + Date.now();

    const { error: deviceError } = await supabase.from("devices").insert([
      {
        id: deviceId,
        user_id: user.id,
        taluk,
        business_category,
        excluded_devices: [],
        online: true,
        last_seen: new Date(),
        join_time: new Date(),
        last_paired_cycle: 0
      }
    ]);

    if (deviceError) throw deviceError;

    // 3) Create matchmaking entry (used by workers/matchmaker.js)
    const { data: pairingData, error: pairingError } = await supabase
      .from("pairing_database")
      .insert([
        {
          user_id: user.id,
          taluk,
          business_category,
          device_status: "online",
          subscription_status: "active"
        }
      ])
      .select();

    console.log("PAIRING INSERT:", pairingData, pairingError);

    if (pairingError) throw pairingError;

    res.json({
      success: true,
      user,
      deviceId
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = router;

