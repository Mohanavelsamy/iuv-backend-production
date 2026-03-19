require("dotenv").config();

const redis = require("./services/redisClient");

async function test() {
  try {
    await redis.set("test", "working");
    const val = await redis.get("test");
    console.log("Redis test value:", val);
    process.exit(0);
  } catch (err) {
    console.error("Redis test failed:", err);
    process.exit(1);
  }
}

test();