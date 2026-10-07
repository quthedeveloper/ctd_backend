import { pool } from "../config/db.js";
import { enqueueCommand } from "./gatewayCommands.js";

// WireGuard public keys are 32 bytes -> 44-char base64 ending with '='
const WIREGUARD_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

// req.authUser is set by the session middleware in index.js
// (verified Better Auth session, or null when signed out).

// Resolve the internal users.id from the Better Auth user id.
// Devices link to users.id, not to the auth id directly.
async function getInternalUserId(authUserId) {
    const r = await pool.query(
        `SELECT id FROM users WHERE auth_user_id = $1`,
        [authUserId]
    );
    return r.rows[0]?.id ?? null;
}

// POST /devices
// Body: { public_key, device_identifier? }
const registerDevice = async (req, res) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { public_key, device_identifier } = req.body ?? {};

        if (!public_key || !WIREGUARD_KEY_RE.test(public_key)) {
            return res.status(400).json({
                message: "A valid WireGuard public_key is required (44-char base64)"
            });
        }

        const internalId = await getInternalUserId(authUser.id);
        if (!internalId) {
            return res.status(404).json({
                message: "User not found. Call GET /auth/user/me first to sync your profile."
            });
        }

        // Idempotency: same key already registered by this user
        const dup = await pool.query(
            `SELECT id FROM devices WHERE user_id = $1 AND public_key = $2`,
            [internalId, public_key]
        );
        if (dup.rows.length > 0) {
            return res.status(409).json({
                message: "Device already registered",
                device_id: dup.rows[0].id
            });
        }

        const result = await pool.query(
            `INSERT INTO devices (user_id, public_key, device_identifier)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [internalId, public_key, device_identifier ?? null]
        );

        return res.status(201).json({
            message: "Device registered",
            device: result.rows[0]
        });
    } catch (error) {
        console.error("registerDevice error:", error);
        if (error.code === "23505") {
            return res.status(409).json({ message: "Device already registered" });
        }
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /devices
const listDevices = async (req, res) => {
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

        const result = await pool.query(
            `SELECT * FROM devices WHERE user_id = $1`,
            [internalId]
        );

        return res.status(200).json({ devices: result.rows });
    } catch (error) {
        console.error("listDevices error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// DELETE /devices/:id
const removeDevice = async (req, res) => {
    try {
        const authUser = req.authUser;
        if (!authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = await getInternalUserId(authUser.id);
        if (!internalId) {
            return res.status(404).json({ message: "User not found" });
        }

        // Tell each gateway to drop this device's live tunnels first.
        // (Peer/sessions rows cascade on device delete, but the gateway
        // only learns about it via REVOKE_PEER.)
        const peers = await pool.query(
            `SELECT gp.id, gp.gateway_id, gp.public_key, gp.tunnel_ip
             FROM gateway_peers gp
             JOIN devices d ON d.id = gp.device_id
             WHERE gp.device_id = $1 AND d.user_id = $2
               AND gp.status IN ('pending', 'active')`,
            [req.params.id, internalId]
        );
        for (const p of peers.rows) {
            await pool.query(
                `UPDATE gateway_peers SET status = 'revoking' WHERE id = $1`,
                [p.id]
            );
            await enqueueCommand(p.gateway_id, "REVOKE_PEER", {
                peer_id: p.id,
                device_id: req.params.id,
                public_key: p.public_key,
                tunnel_ip: p.tunnel_ip,
                reason: "device_removed",
            });
        }

        const result = await pool.query(
            `DELETE FROM devices WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, internalId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Device not found" });
        }

        return res.status(200).json({ message: "Device removed" });
    } catch (error) {
        console.error("removeDevice error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export { registerDevice, listDevices, removeDevice };
