import Redis from "ioredis";

// Optional Redis connection. The app runs fine without Redis:
// caching becomes a pass-through to Postgres and the rate limiter
// fails open (allows the request) when Redis is unreachable.
let redis = null;
let redisReady = false;

const initRedis = () => {
    if (!process.env.REDIS_URL) {
        console.log("Redis: REDIS_URL not set — caching and rate limiting disabled");
        return;
    }

    redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        lazyConnect: false,
        retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    redis.on("ready", () => {
        redisReady = true;
        console.log("Redis: connected");
    });
    redis.on("end", () => {
        redisReady = false;
        console.log("Redis: connection lost — failing open");
    });
    redis.on("error", (error) => {
        console.error("Redis error:", error.message);
    });
};

const getRedis = () => redis;

const isRedisUp = () =>
    redisReady && redis !== null && redis.status === "ready";

export { initRedis, getRedis, isRedisUp };
