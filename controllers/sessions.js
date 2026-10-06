import { pool } from "../config/db.js";

// Resolve the active WireGuard peer for this gateway + tunnel IP,
// including the owning user.
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

// POST /gateways/sessions — gateway reports a session event.
// Body: { tunnel_ip, event: 'connected' | 'disconnected' }
// (gatewayAuth — the gateway calls this, not a user.)
const reportSession = async (req, res) => {
    try {
        const { tunnel_ip, event } = req.body ?? {};

        if (!tunnel_ip || typeof tunnel_ip !== "string") {
            return res.status(400).json({ message: "tunnel_ip is required" });
        }
        if (!["connected", "disconnected"].includes(event)) {
            return res.status(400).json({
                message: "event must be 'connected' or 'disconnected'"
            });
        }

        const peer = await resolvePeer(req.gateway.id, tunnel_ip);
        if (!peer) {
            return res.status(404).json({
                message: "No active peer for this tunnel_ip on this gateway"
            });
        }

        if (event === "connected") {
            // Idempotent: reuse the already-open session if there is one
            const existing = await pool.query(
                `SELECT * FROM sessions
                 WHERE gateway_id = $1 AND device_id = $2 AND status = 'active'
                 ORDER BY connected_at DESC LIMIT 1`,
                [req.gateway.id, peer.device_id]
            );
            if (existing.rows.length > 0) {
                return res.status(200).json({
                    message: "Session already active",
                    session: existing.rows[0],
                });
            }

            const created = await pool.query(
                `INSERT INTO sessions
                    (user_id, device_id, gateway_id, tunnel_ip, status, connected_at)
                 VALUES ($1, $2, $3, $4, 'active', NOW())
                 RETURNING *`,
                [peer.user_id, peer.device_id, req.gateway.id, tunnel_ip]
            );
            return res.status(201).json({
                message: "Session opened",
                session: created.rows[0],
            });
        }

        // disconnected
        const closed = await pool.query(
            `UPDATE sessions
             SET status = 'closed', disconnected_at = NOW()
             WHERE gateway_id = $1 AND device_id = $2 AND status = 'active'
             RETURNING *`,
            [req.gateway.id, peer.device_id]
        );
        return res.status(200).json({
            message: closed.rows.length > 0
                ? "Session closed"
                : "No active session to close",
            session: closed.rows[0] ?? null,
        });
    } catch (error) {
        console.error("reportSession error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /sessions — my sessions, newest first
const listSessions = async (req, res) => {
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
            `SELECT s.*, d.device_identifier, g.name AS gateway_name
             FROM sessions s
             LEFT JOIN devices d ON d.id = s.device_id
             LEFT JOIN gateways g ON g.id = s.gateway_id
             WHERE s.user_id = $1
             ORDER BY s.connected_at DESC
             LIMIT 100`,
            [internalId]
        );

        return res.status(200).json({ sessions: result.rows });
    } catch (error) {
        console.error("listSessions error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /sessions/active — my currently active sessions
const listActiveSessions = async (req, res) => {
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
            `SELECT s.*, d.device_identifier, g.name AS gateway_name
             FROM sessions s
             LEFT JOIN devices d ON d.id = s.device_id
             LEFT JOIN gateways g ON g.id = s.gateway_id
             WHERE s.user_id = $1 AND s.status = 'active'
             ORDER BY s.connected_at DESC`,
            [internalId]
        );

        return res.status(200).json({ sessions: result.rows });
    } catch (error) {
        console.error("listActiveSessions error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export { reportSession, listSessions, listActiveSessions };
