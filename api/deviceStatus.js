const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.get("/device-status/:deviceId", async (req, res) => {
  const { deviceId } = req.params;

  const { data: device, error } = await supabase
    .from("device_registry")
    .select("device_id, user_id, pairing_status, verification_status")
    .eq("device_id", deviceId)
    .single();

  if (error || !device) {
    return res.json({
      pairingStatus: "pending",
      verificationStatus: "pending",
    });
  }

  let verificationStatus = "pending";

  if (device.user_id && device.pairing_status === "paired") {
    const { data: verifiedUser } = await supabase
      .from("pairing_database")
      .select("user_id")
      .eq("user_id", device.user_id)
      .maybeSingle();

    if (verifiedUser) {
      verificationStatus = "verified";

      if (device.verification_status !== "verified") {
        await supabase
          .from("device_registry")
          .update({ verification_status: "verified" })
          .eq("device_id", deviceId);
      }
    }
  }

  res.json({
    deviceId: device.device_id,
    pairingStatus: device.pairing_status,
    userId: device.user_id,
    verificationStatus,
  });
});

module.exports = router;
