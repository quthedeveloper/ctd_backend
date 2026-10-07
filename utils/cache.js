import { getRedis, isRedisUp } from "../config/redis.js";

const CACHE_PACKAGES_TTL_SECONDS = Number(
    process.env.CACHE_PACKAGES_TTL_SECONDS ?? 300
);

// JSON cache helpers. No-ops when Redis is unavailable so callers can
// stay simple: `const hit = await cacheGet(key)` then fall back to Postgres.
const cacheGet = async (key) => {
    if (!isRedisUp()) return null;
    try {
        const raw = await getRedis().get(key);
        return raw === null ? null : JSON.parse(raw);
    } catch (error) {
        console.error("cacheGet error:", error.message);
        return null;
    }
};

const cacheSet = async (key, value, ttlSeconds) => {
    if (!isRedisUp()) return;
    try {
        await getRedis().set(
            key,
            JSON.stringify(value),
            "EX",
            ttlSeconds
        );
    } catch (error) {
        console.error("cacheSet error:", error.message);
    }
};

const cacheDel = async (...keys) => {
    if (!isRedisUp() || keys.length === 0) return;
    try {
        await getRedis().del(...keys);
    } catch (error) {
        console.error("cacheDel error:", error.message);
    }
};

// Package cache: list + single-package entries share one invalidation point
const PACKAGES_LIST_KEY = "cache:packages:list";
const packageKey = (id) => `cache:packages:${id}`;

const invalidatePackages = async (id) => {
    if (id) {
        await cacheDel(PACKAGES_LIST_KEY, packageKey(id));
    } else {
        await cacheDel(PACKAGES_LIST_KEY);
    }
};

export {
    cacheGet,
    cacheSet,
    cacheDel,
    invalidatePackages,
    PACKAGES_LIST_KEY,
    packageKey,
    CACHE_PACKAGES_TTL_SECONDS,
};
