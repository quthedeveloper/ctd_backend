import crypto from "node:crypto";
import { pool } from "../config/db.js";

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

// Gateway authentication for the gateway control plane.
// Gateways are separate principals from users (PDF section 11): they
// authenticate with `Authorization: Bearer <gateway-api-token>` —
// NOT a Better Auth user session. Sets req.gateway or 401s.
const gatewayAuth = async (req, res, next) => {
    try {
        const header = req.header("Authorization") ?? "";
        const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

        if (!token) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await pool.query(
            `SELECT * FROM gateways WHERE api_token_hash = $1`,
            [hashToken(token)]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Never expose the token hash downstream
        const { api_token_hash, ...gateway } = result.rows[0];
        req.gateway = gateway;
        next();
    } catch (error) {
        console.error("gatewayAuth error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export { gatewayAuth };
