import express from "express";
import { claimTrial, listTrials } from "../controllers/trials.js";

const TrialsRouter = express.Router();

TrialsRouter.get("/", listTrials);
TrialsRouter.post("/", claimTrial);

export default TrialsRouter;
