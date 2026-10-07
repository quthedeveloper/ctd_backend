import { pool } from "../config/db.js";
import { enqueueCommand } from "./gatewayCommands.js";

async function resolvePeer(gatewayId, tunnel_ip) {
    const r = await pool.query(
        `SELECT gp.id AS peer_id, gp.device_id, gp.tunnel_ip,
                gp.public_key, d.user_id
         FROM gateway_peers gp
         JOIN devices d ON d.id = gp.device_id
         WHERE gp.gateway_id = $1 AND gp.tunnel_ip = $2
           AND gp.status = 'active'`,
        [gatewayId, tunnel_ip]
    );
    return r.rows[0] ?? null;
}

// POST /gateways/usage — gateway reports traffic for a reporting interval.
// Body: { tunnel_ip, period_start, period_end, bytes_rx, bytes_tx, report_id? }
// Records the usage, aggregates it into the active trial/subscription, and
// revokes the peer when quota is exhausted (PDF section 12).
// (gatewayAuth — the gateway calls this, not a user.)
const reportUsage = async (req, res) => {
    try {
        const {
            tunnel_ip,
            period_start,
            period_end,
            bytes_rx,
            bytes_tx,
            report_id,
        } = req.body ?? {};

        if (!tunnel_ip || typeof tunnel_ip !== "string") {
            return res.status(400).json({ message: "tunnel_ip is required" });
        }
        const rx = Number(bytes_rx);
        const tx = Number(bytes_tx);
        if (!Number.isInteger(rx) || rx < 0 || !Number.isInteger(tx) || tx < 0) {
            return res.status(400).json({
                message: "bytes_rx and bytes_tx must be non-negative integers"
            });
        }

        // usage_records.period_start/period_end are NOT NULL with a
        // period_end > period_start check — reject bad input as 400
        // instead of letting Postgres throw a 500.
        if (
            !period_start || !period_end ||
            Number.isNaN(Date.parse(period_start)) ||
            Number.isNaN(Date.parse(period_end))
        ) {
            return res.status(400).json({
                message: "period_start and period_end are required and must be valid timestamps"
            });
        }

        // Idempotency: gateways retry on network failure — never double-count
        if (report_id) {
            const dup = await pool.query(
                `SELECT * FROM usage_records WHERE report_id = $1`,
                [report_id]
            );
            if (dup.rows.length > 0) {
                return res.status(200).json({
                    message: "Duplicate report ignored",
                    usage: dup.rows[0],
                });
            }
        }

        const peer = await resolvePeer(req.gateway.id, tunnel_ip);
        if (!peer) {
            return res.status(404).json({
                message: "No active peer for this tunnel_ip on this gateway"
            });
        }

        // Attach to the open session, or open one implicitly if the gateway
        // restarted and lost session state
        let session = (
            await pool.query(
                `SELECT * FROM sessions
                 WHERE gateway_id = $1 AND device_id = $2 AND status = 'active'
                 ORDER BY connected_at DESC LIMIT 1`,
                [req.gateway.id, peer.device_id]
            )
        ).rows[0];

        if (!session) {
            session = (
                await pool.query(
                    `INSERT INTO sessions
                        (user_id, device_id, gateway_id, tunnel_ip, status, connected_at)
                     VALUES ($1, $2, $3, $4, 'active', NOW())
                     RETURNING *`,
                    [peer.user_id, peer.device_id, req.gateway.id, tunnel_ip]
                )
            ).rows[0];
        }

        const total = rx + tx;

        const usage = await pool.query(
            `INSERT INTO usage_records
                (session_id, user_id, gateway_id, period_start, period_end,
                 bytes_rx, bytes_tx, report_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
                session.id,
                peer.user_id,
                req.gateway.id,
                period_start,
                period_end,
                rx,
                tx,
                report_id ?? null,
            ]
        );

        // Aggregate into the active trial / subscription
        const trialUpd = await pool.query(
            `UPDATE trials SET used_bytes = used_bytes + $2
             WHERE user_id = $1 AND status = 'active'
             RETURNING id, quota_bytes, used_bytes`,
            [peer.user_id, total]
        );
        const subUpd = await pool.query(
            `UPDATE subscriptions SET used_bytes = used_bytes + $2
             WHERE user_id = $1 AND status = 'active'
             RETURNING id, quota_bytes, used_bytes`,
            [peer.user_id, total]
        );

        // Quota enforcement: expire the entitlement and revoke the peer
        const exhausted = [];
        for (const t of trialUpd.rows) {
            if (Number(t.used_bytes) >= Number(t.quota_bytes)) {
                await pool.query(
                    `UPDATE trials SET status = 'expired' WHERE id = $1`,
                    [t.id]
                );
                exhausted.push({ kind: "trial", id: t.id });
            }
        }
        for (const s of subUpd.rows) {
            if (Number(s.used_bytes) >= Number(s.quota_bytes)) {
                await pool.query(
                    `UPDATE subscriptions SET status = 'expired' WHERE id = $1`,
                    [s.id]
                );
                exhausted.push({ kind: "subscription", id: s.id });
            }
        }

        let revocation_command = null;
        if (exhausted.length > 0) {
            await pool.query(
                `UPDATE gateway_peers SET status = 'revoking' WHERE id = $1`,
                [peer.peer_id]
            );
            const cmd = await enqueueCommand(req.gateway.id, "REVOKE_PEER", {
                peer_id: peer.peer_id,
                device_id: peer.device_id,
                public_key: peer.public_key,
                tunnel_ip: peer.tunnel_ip,
                reason: "quota_exhausted",
            });
            revocation_command = cmd.message_id;
        }

        return res.status(201).json({
            message: "Usage recorded",
            usage: usage.rows[0],
            quota_exhausted: exhausted,
            revocation_command,
        });
    } catch (error) {
        console.error("reportUsage error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /usage — my usage records, newest first
const listUsage = async (req, res) => {
    try {
        if (!req.authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = (
            await pool.query(
                `SELECT id FROM users WHERE auth_user_id = $1`,
                [req.authUser.id]
            )
        ).rows[0]?.id;

        if (!internalId) {
            return res.status(404).json({ message: "User not found." });
        }

        const result = await pool.query(
            `SELECT u.*, g.name AS gateway_name
             FROM usage_records u
             LEFT JOIN gateways g ON g.id = u.gateway_id
             WHERE u.user_id = $1
             ORDER BY u.period_end DESC NULLS LAST, u.created_at DESC
             LIMIT 100`,
            [internalId]
        );

        return res.status(200).json({ usage: result.rows });
    } catch (error) {
        console.error("listUsage error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /usage/summary — totals across all my usage records
const usageSummary = async (req, res) => {
    try {
        if (!req.authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = (
            await pool.query(
                `SELECT id FROM users WHERE auth_user_id = $1`,
                [req.authUser.id]
            )
        ).rows[0]?.id;

        if (!internalId) {
            return res.status(404).json({ message: "User not found." });
        }

        const result = await pool.query(
            `SELECT COUNT(*) AS reports,
                    COALESCE(SUM(bytes_rx), 0) AS bytes_rx,
                    COALESCE(SUM(bytes_tx), 0) AS bytes_tx
             FROM usage_records WHERE user_id = $1`,
            [internalId]
        );

        const row = result.rows[0];
        return res.status(200).json({
            summary: {
                reports: Number(row.reports),
                bytes_rx: Number(row.bytes_rx),
                bytes_tx: Number(row.bytes_tx),
                bytes_total: Number(row.bytes_rx) + Number(row.bytes_tx),
            },
        });
    } catch (error) {
        console.error("usageSummary error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export { reportUsage, listUsage, usageSummary };
