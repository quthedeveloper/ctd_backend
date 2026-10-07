import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "database", "migrations");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for Postgres to accept connections (compose starts db and api
// near-simultaneously; the api must not migrate against a cold database).
async function waitForDb(pool, tries = 30) {
    for (let i = 1; i <= tries; i++) {
        try {
            await pool.query("SELECT 1");
            return;
        } catch {
            console.log(`Waiting for Postgres... (${i}/${tries})`);
            await sleep(2000);
        }
    }
    throw new Error("Postgres did not become ready in time");
}

async function main() {
    const pool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
    });

    try {
        await waitForDb(pool);

        const files = (await readdir(MIGRATIONS_DIR))
            .filter((f) => f.endsWith(".sql"))
            .sort();

        if (files.length === 0) {
            console.log("No migration files found — nothing to do.");
            return;
        }

        for (const file of files) {
            console.log(`Applying ${file}...`);
            const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
            await pool.query(sql);
            console.log(`Applied ${file}.`);
        }
        console.log("All migrations applied.");
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error("Migration failed:", error.message);
    process.exit(1);
});
