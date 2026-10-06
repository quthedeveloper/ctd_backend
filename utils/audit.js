import { pool } from "../config/db.js";

// Append a row to audit_logs for important admin/security events.
// Columns per the architecture guide: actor, action, resource, metadata.
const auditLog = async ({ actor, action, resource, metadata = {} }) => {
    try {
        await pool.query(
            `INSERT INTO audit_logs (actor, action, resource, metadata)
             VALUES ($1, $2, $3, $4)`,
            [actor, action, resource, JSON.stringify(metadata)]
        );
    } catch (error) {
        // Auditing must never break the request it observes
        console.error("auditLog error:", error);
    }
};

export { auditLog };
