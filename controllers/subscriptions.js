import { pool } from "../config/db.js";

async function getInternalUserId(authUserId) {
    const r = await pool.query(
        `SELECT id FROM users WHERE auth_user_id = $1`,
        [authUserId]
    );
    return r.rows[0]?.id ?? null;
}

// Lazy expiry: flip this user's active-but-past-due subscriptions to expired.
// Runs on every read so no cron job is needed for V1.
async function refreshExpired(internalId) {
    await pool.query(
        `UPDATE subscriptions
         SET status = 'expired'
         WHERE user_id = $1 AND status = 'active' AND expires_at <= NOW()`,
        [internalId]
    );
}

// Enrich a subscription row with live remaining quota/time for the client.
function decorate(sub) {
    const quota = Number(sub.quota_bytes);
    const used = Number(sub.used_bytes ?? 0);
    const remainingMs = Math.max(
        0,
        new Date(sub.expires_at).getTime() - Date.now()
    );
    return {
        ...sub,
        remaining_bytes: Math.max(0, quota - used),
        remaining_seconds: Math.floor(remainingMs / 1000),
        is_expired: remainingMs === 0 || sub.status !== "active",
    };
}

// GET /subscriptions — my subscriptions, newest first
const listSubscriptions = async (req, res) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = await getInternalUserId(authUser.id);
        if (!internalId) {
            return res.status(404).json({ message: "User not found." });
        }

        await refreshExpired(internalId);

        const result = await pool.query(
            `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY starts_at DESC`,
            [internalId]
        );

        return res.status(200).json({
            subscriptions: result.rows.map(decorate)
        });
    } catch (error) {
        console.error("listSubscriptions error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /subscriptions/active — my current active subscription (null when none)
const getActiveSubscription = async (req, res) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = await getInternalUserId(authUser.id);
        if (!internalId) {
            return res.status(404).json({ message: "User not found." });
        }

        await refreshExpired(internalId);

        const result = await pool.query(
            `SELECT * FROM subscriptions
             WHERE user_id = $1 AND status = 'active'
             ORDER BY starts_at DESC LIMIT 1`,
            [internalId]
        );

        return res.status(200).json({
            subscription: result.rows.length > 0 ? decorate(result.rows[0]) : null
        });
    } catch (error) {
        console.error("getActiveSubscription error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// POST /subscriptions — activate a subscription for a package.
// Body: { package_id }
// Copies quota/duration from the package. One active subscription per user.
// (In the full flow this is called after a verified payment — task #7.)
const createSubscription = async (req, res) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = await getInternalUserId(authUser.id);
        if (!internalId) {
            return res.status(404).json({
                message: "User not found. Call GET /auth/user/me first to sync your profile."
            });
        }

        const { package_id } = req.body ?? {};
        if (!package_id) {
            return res.status(400).json({ message: "package_id is required" });
        }

        await refreshExpired(internalId);

        const active = await pool.query(
            `SELECT id FROM subscriptions
             WHERE user_id = $1 AND status = 'active' LIMIT 1`,
            [internalId]
        );
        if (active.rows.length > 0) {
            return res.status(409).json({
                message: "You already have an active subscription. Renew it after it expires."
            });
        }

        const result = await pool.query(
            `INSERT INTO subscriptions
                (user_id, package_id, status, starts_at, expires_at, quota_bytes, used_bytes)
             SELECT
                $1, id, 'active', NOW(),
                NOW() + (duration_hours::double precision * INTERVAL '1 hour'),
                quota_bytes, 0
             FROM packages
             WHERE id = $2
             RETURNING *`,
            [internalId, package_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Package not found" });
        }

        return res.status(201).json({
            message: "Subscription activated",
            subscription: decorate(result.rows[0])
        });
    } catch (error) {
        console.error("createSubscription error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// POST /subscriptions/:id/suspend — suspend an active subscription
const suspendSubscription = async (req, res) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = await getInternalUserId(authUser.id);
        if (!internalId) {
            return res.status(404).json({ message: "User not found." });
        }

        const result = await pool.query(
            `UPDATE subscriptions
             SET status = 'suspended'
             WHERE id = $1 AND user_id = $2 AND status = 'active'
             RETURNING *`,
            [req.params.id, internalId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Subscription not found or not active"
            });
        }

        return res.status(200).json({
            message: "Subscription suspended",
            subscription: decorate(result.rows[0])
        });
    } catch (error) {
        console.error("suspendSubscription error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// POST /subscriptions/:id/renew — start a fresh period on an
// expired/suspended/cancelled subscription (fresh quota, starts now)
const renewSubscription = async (req, res) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = await getInternalUserId(authUser.id);
        if (!internalId) {
            return res.status(404).json({ message: "User not found." });
        }

        const sub = await pool.query(
            `SELECT * FROM subscriptions WHERE id = $1 AND user_id = $2`,
            [req.params.id, internalId]
        );
        if (sub.rows.length === 0) {
            return res.status(404).json({ message: "Subscription not found" });
        }
        if (sub.rows[0].status === "active") {
            return res.status(409).json({
                message: "Subscription is already active"
            });
        }

        const pkg = await pool.query(
            `SELECT quota_bytes, duration_hours FROM packages WHERE id = $1`,
            [sub.rows[0].package_id]
        );
        if (pkg.rows.length === 0) {
            return res.status(404).json({ message: "Package not found" });
        }

        const result = await pool.query(
            `UPDATE subscriptions
             SET status = 'active',
                 starts_at = NOW(),
                 expires_at = NOW() + ($3::double precision * INTERVAL '1 hour'),
                 quota_bytes = $4,
                 used_bytes = 0
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [
                req.params.id,
                internalId,
                Number(pkg.rows[0].duration_hours),
                pkg.rows[0].quota_bytes,
            ]
        );

        return res.status(200).json({
            message: "Subscription renewed",
            subscription: decorate(result.rows[0])
        });
    } catch (error) {
        console.error("renewSubscription error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export {
    listSubscriptions,
    getActiveSubscription,
    createSubscription,
    suspendSubscription,
    renewSubscription,
};
