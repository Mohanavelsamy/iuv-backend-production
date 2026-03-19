const supabase = require("../config/supabase");
const mqttClient = require("../services/mqttClient");
const redis = require("../services/redisClient");

const CYCLE_MS = 30_000;
const HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;

let currentCycle = 0;
let isRunning = false;

// Per-user fairness memory: who this user has already paired with.
const userPartnerHistory = {};

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeCategory(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function toCategorySet(categoryValue) {
  if (!categoryValue) return new Set();
  if (Array.isArray(categoryValue)) {
    return new Set(categoryValue.map(normalizeCategory).filter(Boolean));
  }
  return new Set(
    String(categoryValue)
      .split(",")
      .map(normalizeCategory)
      .filter(Boolean)
  );
}

function tokenOverlap(setA, setB) {
  for (const token of setA) {
    if (setB.has(token)) return true;
  }
  return false;
}

function parsePreferences(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      // fall back to CSV parsing
    }
    return raw.split(",").map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

function canPair(a, b) {
  if (a.id === b.id) return false;
  if (!a.online || !b.online) return false;
  if (a.taluk !== b.taluk) return false;
  if (tokenOverlap(a.categorySet, b.categorySet)) return false;
  return true;
}

function getPairKey(a, b) {
  return [a.id, b.id].sort().join("-");
}

function exclusionPenalty(a, b) {
  if (a.excluded.includes(b.id) || b.excluded.includes(a.id)) {
    return 1000;
  }
  return 0;
}

async function getActiveUsersFromRedis(talukId) {
  const users = await redis.smembers(`active:taluk:${talukId}`);
  return users || [];
}

function generatePairs(devicesList, cycle) {
  const pairs = [];
  const used = new Set();
  const byTaluk = {};

  devicesList.forEach((d) => {
    if (!byTaluk[d.taluk]) byTaluk[d.taluk] = [];
    byTaluk[d.taluk].push(d);
  });

  for (const taluk in byTaluk) {
    const pool = byTaluk[taluk].filter((d) => d.online);
    if (pool.length < 2) continue;

    const candidates = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i];
        const b = pool[j];
        if (!canPair(a, b)) continue;

        const historyA = userPartnerHistory[a.id];
        const historyB = userPartnerHistory[b.id];
        const alreadyPaired = historyA.has(b.id) || historyB.has(a.id);
        const freshnessScore = alreadyPaired ? -10000 : 1000;

        const deviceScore =
          (cycle - (a.lastPairedCycle || 0)) +
          (cycle - (b.lastPairedCycle || 0));
        const penalty = exclusionPenalty(a, b);

        const score = freshnessScore + deviceScore - penalty;
        candidates.push({ a, b, score });
      }
    }

    candidates.sort((x, y) => y.score - x.score);

    for (const c of candidates) {
      if (used.has(c.a.id) || used.has(c.b.id)) continue;

      pairs.push({
        userA: c.a.id,
        userB: c.b.id,
        contentA: {
          url: `https://example.com/${c.a.id}_${c.b.id}_${cycle}.jpg`,
          hash: `hash_${c.a.id}_${c.b.id}_${cycle}`
        },
        contentB: {
          url: `https://example.com/${c.b.id}_${c.a.id}_${cycle}.jpg`,
          hash: `hash_${c.b.id}_${c.a.id}_${cycle}`
        }
      });

      userPartnerHistory[c.a.id].add(c.b.id);
      userPartnerHistory[c.b.id].add(c.a.id);

      c.a.lastPairedCycle = cycle;
      c.b.lastPairedCycle = cycle;

      used.add(c.a.id);
      used.add(c.b.id);
    }

    // Per-user partner history reset once all partners in this taluk are exhausted.
    for (const d of pool) {
      const totalPossiblePartners = pool.length - 1;
      if (userPartnerHistory[d.id].size >= totalPossiblePartners) {
        userPartnerHistory[d.id].clear();
      }
    }
  }

  return pairs;
}

async function publishPerDevice(cycle, pairs, allDeviceIds) {
  const pairedIds = new Set();

  for (const p of pairs) {
    const topicA = `tv/${p.userA}/pair`;
    const payloadA = {
      partnerId: p.userB,
      cycle,
      content: p.contentA
    };
    await mqttClient.publish(topicA, payloadA, { qos: 1, retain: false, attempts: 3 });
    pairedIds.add(String(p.userA));

    const topicB = `tv/${p.userB}/pair`;
    const payloadB = {
      partnerId: p.userA,
      cycle,
      content: p.contentB
    };
    await mqttClient.publish(topicB, payloadB, { qos: 1, retain: false, attempts: 3 });
    pairedIds.add(String(p.userB));
  }

  for (const idRaw of allDeviceIds) {
    const id = String(idRaw);
    if (pairedIds.has(id)) continue;
    await mqttClient.publish(
      `tv/${id}/pair`,
      { type: "fallback", cycle },
      { qos: 1, retain: false, attempts: 3 }
    );
  }
}

async function runMatchmakerOnce() {
  currentCycle++;
  const cycle = currentCycle;

  const devices = [];
  try {
    const talukKeys = await redis.keys("active:taluk:*");
    const talukIds = talukKeys.map((k) => k.split("active:taluk:")[1]).filter(Boolean);

    for (const talukId of talukIds) {
      const users = await getActiveUsersFromRedis(talukId);
      if (!users || users.length < 2) {
        console.log(`⚠️ Not enough users in ${talukId}`);
      }
      if (!users || users.length === 0) {
        continue;
      }

      const { data, error } = await supabase
        .from("pairing_database")
        .select(
          `user_id,
          taluk,
          business_category,
          device_status,
          last_seen,
          preferences,
          last_paired_cycle,
          subscription_status`
        )
        .in("user_id", users);

      if (error) throw error;

      const nowMs = Date.now();
      for (const row of data || []) {
        const isActive = normalize(row.subscription_status) === "active";
        const isOnline = normalize(row.device_status) === "online";
        const lastSeenMs = row.last_seen ? new Date(row.last_seen).getTime() : NaN;
        const freshHeartbeat =
          Number.isFinite(lastSeenMs) &&
          lastSeenMs > nowMs - HEARTBEAT_WINDOW_MS;
        if (!isActive || !isOnline || !freshHeartbeat) continue;

        const id = String(row.user_id);
        if (!userPartnerHistory[id]) userPartnerHistory[id] = new Set();

        devices.push({
          id,
          taluk: row.taluk ?? talukId ?? "unknown",
          categorySet: toCategorySet(row.business_category ?? ""),
          excluded: parsePreferences(row.preferences),
          online: true,
          lastPairedCycle: row.last_paired_cycle ?? 0
        });
      }
    }
  } catch (err) {
    console.error("[Matchmaker] Redis/Supabase fetch failed:", err.message || err);
    return;
  }

  if (devices.length < 2) {
    console.log("[Matchmaker] <2 eligible users, skipping cycle");
    return;
  }

  const pairs = generatePairs(devices, cycle);
  const allDeviceIds = devices.map((d) => d.id);
  const pairedIds = new Set(pairs.flatMap((p) => [p.userA, p.userB]));

  if (pairs.length > 0) {
    const cycleTimestamp = new Date();
    const pairRows = pairs.map((p) => ({
      device_a: p.userA,
      device_b: p.userB,
      cycle,
      cycle_timestamp: cycleTimestamp
    }));
    const { error: insertErr } = await supabase.from("pairs").insert(pairRows);
    if (insertErr) {
      console.error("[Matchmaker] Supabase pairs insert error:", insertErr);
    }
  }

  if (pairedIds.size > 0) {
    const { error: updErr } = await supabase
      .from("pairing_database")
      .update({ last_paired_cycle: cycle })
      .in("user_id", Array.from(pairedIds));
    if (updErr) {
      console.error("[Matchmaker] Supabase last_paired_cycle update error:", updErr);
    }
  }

  try {
    await publishPerDevice(cycle, pairs, allDeviceIds);
  } catch (err) {
    console.error("[Matchmaker] MQTT publish error:", err.message || err);
  }

  console.log(
    `[Matchmaker] Cycle ${cycle} | eligible=${devices.length} pairs=${pairs.length} fallback=${allDeviceIds.length - pairedIds.size}`
  );
}

function getNextSyncDelay() {
  const now = new Date();
  const seconds = now.getSeconds();
  return (seconds < 30 ? 30 - seconds : 60 - seconds) * 1000;
}

function startScheduler(runCycle) {
  const delay = getNextSyncDelay();
  console.log(`[Matchmaker] Waiting ${delay}ms for next :00/:30 sync`);

  setTimeout(() => {
    runCycle();
    setInterval(runCycle, CYCLE_MS);
  }, delay);
}

function startMatchmaker() {
  console.log("[Matchmaker] Matchmaker started");
  startScheduler(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await runMatchmakerOnce();
    } finally {
      isRunning = false;
    }
  });
}

module.exports = startMatchmaker;

