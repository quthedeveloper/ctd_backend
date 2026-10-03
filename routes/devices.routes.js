import express from "express";
import { registerDevice, listDevices, removeDevice } from "../controllers/devices.js";

const DevicesRouter = express.Router();

DevicesRouter.get("/", listDevices);
DevicesRouter.post("/", registerDevice);
DevicesRouter.delete("/:id", removeDevice);

export default DevicesRouter;
