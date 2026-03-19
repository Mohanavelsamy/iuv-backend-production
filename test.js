const mqtt = require("mqtt");

const client = mqtt.connect("mqtts://f22118c1.ala.asia-southeast1.emqxsl.com:8883", {
  username: "iuv_user",
  password: "strong_password",
});

client.on("connect", () => {
  console.log("✅ Connected");

  const payload = {
    cycle: 1,
    server_time: Date.now(),
    display_at: Date.now() + 3000,
    pairs: [
      {
        deviceA: "tv1",
        deviceB: "tv2",
        content: {
          url: "https://example.com/ad1.jpg",
          hash: "abc123",
        },
      },
    ],
  };

  client.publish(
    "iuv/taluk/test/pairing",
    JSON.stringify(payload),
    { qos: 1 },
    () => {
      console.log("📤 Pairing sent");
    }
  );
});