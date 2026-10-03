import { pool } from "../config/db.js";

// Trial policy (PDF section 9): 5 GB for 24 hours. Overridable via env.
const TRIAL_QUOTA_BYTES = Number(process.env.TRIAL_QUOTA_BYTES ?? 5 * 1024 ** 3);
const TRIAL_DURATION_HOURS = Number(process.env.TRIAL_DURATION_HOURS ?? 24);

async function getInternalUserId(authUserId) {
    const r = await pool.query(
        `SELECT id FROM users WHERE auth_user_id = $1`,
        [authUserId]
    );
    return r.rows[0]?.id ?? null;
}

// Enrich a trial row with live remaining quota/time for the client.
function decorate(trial) {
    const quota = Number(trial.quota_bytes);
    const used = Number(trial.used_bytes ?? 0);
    const remainingMs = Math.max(
        0,
        new Date(trial.expires_at).getTime() - Date.now()
    );
    return {
        ...trial,
        remaining_bytes: Math.max(0, quota - used),
        remaining_seconds: Math.floor(remainingMs / 1000),
        is_expired: remainingMs === 0 || trial.status !== "active",
    };
}

// POST /trials — claim the free trial. Body: { device_id? }
// Eligibility: one trial per user, ever.
const claimTrial = async (req, res) => {
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

        const existing = await pool.query(
            `SELECT id FROM trials WHERE user_id = $1 LIMIT 1`,
            [internalId]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ message: "Trial already claimed" });
        }

        const { device_id } = req.body ?? {};
        if (device_id !== undefined && device_id !== null) {
            const dev = await pool.query(
                `SELECT id FROM devices WHERE id = $1 AND user_id = $2`,
                [device_id, internalId]
            );
            if (dev.rows.length === 0) {
                return res.status(400).json({
                    message: "device_id does not belong to this user"
                });
            }
        }

        const result = await pool.query(
            `INSERT INTO trials
                (user_id, device_id, quota_bytes, used_bytes, starts_at, expires_at, status)
             VALUES (
                $1, $2, $3, 0, NOW(),
                NOW() + ($4::double precision * INTERVAL '1 hour'),
                'active'
             )
             RETURNING *`,
            [internalId, device_id ?? null, TRIAL_QUOTA_BYTES, TRIAL_DURATION_HOURS]
        );

        return res.status(201).json({
            message: "Trial started",
            trial: decorate(result.rows[0])
        });
    } catch (error) {
        console.error("claimTrial error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /trials — my trials with live remaining quota/time
const listTrials = async (req, res) => {
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
            `SELECT * FROM trials WHERE user_id = $1`,
            [internalId]
        );

        return res.status(200).json({
            trials: result.rows.map(decorate)
        });
    } catch (error) {
        console.error("listTrials error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export { claimTrial, listTrials };
