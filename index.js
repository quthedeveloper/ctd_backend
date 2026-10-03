import express from "express";
import dotenv from "dotenv";
import { confirmation, pool } from "./config/db.js";
import { clerkMiddleware } from "@clerk/express";
import UserAuthRouter from "./routes/users.routes.js";
import DevicesRouter from "./routes/devices.routes.js";

dotenv.config();

const PORT = process.env.PORT;

const app = express();

app.use(express.json());
app.use(clerkMiddleware());

// routes
app.use("/auth/user", UserAuthRouter);
app.use("/devices", DevicesRouter);
const result = await confirmation(pool);

app.listen(PORT, ()=>{
console.log(`server working at port: ${PORT}`);
console.log(result)
});
