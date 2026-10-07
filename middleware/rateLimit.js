import { getRedis, isRedisUp } from "../config/redis.js";

// Fixed-window rate limiter backed by Redis (INCR + EXPIRE, atomic per key).
// Fails open when Redis is unavailable: the request is allowed through
// and the incident is logged, so a Redis outage never takes the API down.
//
//   rateLimit({ key: (req) => req.ip, limit: 20, windowSeconds: 60 })
const rateLimit = ({ key, limit, windowSeconds, message }) => {
    return async (req, res, next) => {
        if (!isRedisUp()) {
            return next();
        }

        try {
            const redis = getRedis();
            const redisKey = `rl:${key(req)}`;
            const count = await redis.incr(redisKey);
            if (count === 1) {
                await redis.expire(redisKey, windowSeconds);
            }

            res.setHeader("X-RateLimit-Limit", limit);
            res.setHeader(
                "X-RateLimit-Remaining",
                Math.max(0, limit - count)
            );

            if (count > limit) {
                return res.status(429).json({
                    message:
                        message ??
                        "Too many requests — please slow down and try again",
                });
            }
            return next();
        } catch (error) {
            // Redis hiccup mid-request: fail open, don't block the caller
            console.error("rateLimit error (failing open):", error.message);
            return next();
        }
    };
};

// Convenience: limit by client IP
const perIp = (req) => req.ip ?? "unknown";

// Convenience: limit by authenticated gateway (falls back to IP)
const perGateway = (req) => req.gateway?.id ?? req.ip ?? "unknown";

export { rateLimit, perIp, perGateway };
