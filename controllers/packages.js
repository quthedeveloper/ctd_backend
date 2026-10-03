import { pool } from "../config/db.js";

// GET /packages — public: list all packages (so visitors can see plans
// before signing up)
const listPackages = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM packages ORDER BY price ASC`
        );
        return res.status(200).json({ packages: result.rows });
    } catch (error) {
        console.error("listPackages error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// GET /packages/:id — public: single package
const getPackage = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM packages WHERE id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Package not found" });
        }
        return res.status(200).json({ package: result.rows[0] });
    } catch (error) {
        console.error("getPackage error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

// POST /packages — create a package.
// NOTE: any signed-in user can call this for now; restrict to admins
// when the Admin APIs land (task #11).
const createPackage = async (req, res) => {
    try {
        if (!req.authUser) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const {
            name,
            price,
            currency = "GHS",
            quota_bytes,
            duration_hours,
            speed_policy,
        } = req.body ?? {};

        if (!name || typeof name !== "string") {
            return res.status(400).json({ message: "name is required" });
        }
        const priceNum = Number(price);
        const quotaNum = Number(quota_bytes);
        const durationNum = Number(duration_hours);
        if (!Number.isFinite(priceNum) || priceNum < 0) {
            return res.status(400).json({
                message: "price must be a non-negative number"
            });
        }
        if (!Number.isInteger(quotaNum) || quotaNum <= 0) {
            return res.status(400).json({
                message: "quota_bytes must be a positive integer (bytes)"
            });
        }
        if (!Number.isFinite(durationNum) || durationNum <= 0) {
            return res.status(400).json({
                message: "duration_hours must be a positive number"
            });
        }

        const result = await pool.query(
            `INSERT INTO packages
                (name, price, currency, quota_bytes, duration_hours, speed_policy)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                name.trim(),
                priceNum,
                currency,
                quotaNum,
                durationNum,
                speed_policy ?? null,
            ]
        );

        return res.status(201).json({
            message: "Package created",
            package: result.rows[0]
        });
    } catch (error) {
        console.error("createPackage error:", error);
        return res.status(500).json({ message: "Server error" });
    }
};

export { listPackages, getPackage, createPackage };
