import { getAuth } from "@clerk/express";
import { pool } from "../config/db.js";

// WireGuard public keys are 32 bytes -> 44-char base64 ending with '='
const WIREGUARD_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

// Resolve the internal users.id from the Clerk user id.
// Devices link to users.id, not to the Clerk id directly.
async function getInternalUserId(clerkUserId) {
    const r = await pool.query(
        `SELECT id FROM users WHERE clerk_user_id = $1`,
        [clerkUserId]
    );
    return r.rows[0]?.id ?? null;
}

// POST /devices
// Body: { public_key, device_identifier? }
const registerDevice = async (req, res) => {
    try {
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { public_key, device_identifier } = req.body ?? {};

        if (!public_key || !WIREGUARD_KEY_RE.test(public_key)) {
            return res.status(400).json({
                message: "A valid WireGuard public_key is required (44-char base64)"
            });
        }

        const internalId = await getInternalUserId(userId);
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
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = await getInternalUserId(userId);
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
        const { userId } = getAuth(req);
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const internalId = await getInternalUserId(userId);
        if (!internalId) {
            return res.status(404).json({ message: "User not found" });
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
