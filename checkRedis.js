require("dotenv").config();
const redis = require("./services/redisClient");

async function check() {
  const users = await redis.smembers("active:taluk:NAMAKKAL");
  console.log("🔥 Active users in Redis:", users);
}

check();