const mqtt = require("mqtt");
const supabase = require("./config/supabase");

const BROKER = "mqtts://f22118c1.ala.asia-southeast1.emqxsl.com:8883";

const options = {
  username: "iuv_user",
  password: "strong_password",
};

function getPairTopic(deviceId) {
  // DO NOT CHANGE TOPIC STRUCTURE — used by TV clients
  return `tv/${deviceId}/pair`;
}

class TVSimulator {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.currentContent = null;
    this.lastCycle = null;
    this.timer = null;
    this.heartbeatTimer = null;

    this.client = mqtt.connect(BROKER, options);

    this.client.on("connect", () => {
      console.log(`[${this.deviceId}] 📺 Connected`);
      this.client.subscribe(getPairTopic(this.deviceId), { qos: 1 });

      // Simulate device heartbeat every 20s.
      this.sendHeartbeat();
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
      }
      this.heartbeatTimer = setInterval(() => {
        this.sendHeartbeat();
      }, 20_000);
    });

    this.client.on("reconnect", () => {
      console.log(`[${this.deviceId}] 🔄 Reconnecting...`);
    });

    this.client.on("close", () => {
      console.log(`[${this.deviceId}] ⚠️ Connection closed`);
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    });

    this.client.on("offline", () => {
      console.log(`[${this.deviceId}] ⚠️ Offline`);
    });

    this.client.on("message", (topic, message) => {
      let payload;

      try {
        payload = JSON.parse(message.toString());
      } catch (err) {
        console.log(`[${this.deviceId}] ❌ Invalid JSON`);
        return;
      }

      this.handlePayload(payload);
    });
  }

  handlePayload(payload) {
    if (!payload || typeof payload !== "object") {
      console.log(`[${this.deviceId}] ❌ Invalid payload structure`);
      return;
    }

    if (payload.type === "fallback") {
      console.log(`[${this.deviceId}] 🔁 Fallback → continue last content`);
      if (this.currentContent) {
        console.log(`[${this.deviceId}] 🖥 CONTINUE → ${this.currentContent.url}`);
      }
      return;
    }

    const { partnerId, cycle, content } = payload;

    if (cycle == null) {
      console.log(`[${this.deviceId}] ❌ Missing cycle in payload`);
      return;
    }
    if (this.lastCycle === cycle) {
      return;
    }
    this.lastCycle = cycle;

    if (!content || !content.url || !content.hash) {
      console.log(`[${this.deviceId}] ❌ Invalid content structure`);
      return;
    }

    console.log(`[${this.deviceId}] 🔗 Paired with ${partnerId} (cycle ${cycle})`);

    // Clear any pending timer to avoid stale renders
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.display(content);
  }

  display(content) {
    if (!content) {
      console.log(`[${this.deviceId}] ⚠️ No content`);
      return;
    }

    if (
      this.currentContent &&
      this.currentContent.hash === content.hash
    ) {
      console.log(`[${this.deviceId}] ⏭ No change (skip render)`);
      return;
    }

    this.currentContent = content;

    console.log(
      `[${this.deviceId}] 🖥 DISPLAY → ${content.url}`
    );
  }

  sendHeartbeat() {
    try {
      console.log(`[${this.deviceId}] 🔍 Sending heartbeat...`);

      const payload = {
        userId: this.deviceId,
        talukId: "NAMAKKAL",
        timestamp: Date.now(),
      };

      this.client.publish(
        `iuv/taluk/${payload.talukId}/heartbeat`,
        JSON.stringify(payload),
        { qos: 1 }
      );

      console.log(`[${this.deviceId}] 💓 Heartbeat sent`);
    } catch (err) {
      console.error(`[${this.deviceId}] ❌ Heartbeat error:`, err.message || err);
    }
  }
}

function createTV(deviceId) {
  return new TVSimulator(deviceId);
}

async function loadDevices() {
  const { data, error } = await supabase
    .from("pairing_database")
    .select("user_id, device_status");

  if (error) {
    console.error("❌ Failed to fetch devices:", error);
    return [];
  }

  return (data || [])
    .filter((d) => String(d.device_status).toLowerCase() === "online")
    .map((d) => String(d.user_id));
}

async function startSimulator() {
  const deviceIds = await loadDevices();
  console.log(`📺 Starting TV simulators for ${deviceIds.length} devices`);

  deviceIds.forEach((id) => {
    createTV(id);
  });
}

startSimulator().catch((err) => {
  console.error("❌ Failed to start TV simulator:", err);
});