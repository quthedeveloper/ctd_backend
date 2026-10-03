import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();





// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
    user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});


async function confirmation(pool){
    try{
        const result = await pool.query("SELECT NOW()");

        if (result.rows[0]) return "Database connection successful";
    } catch(err){
        return `Database connection failed: ${err.message}`;
    }
}



export {confirmation, pool};






