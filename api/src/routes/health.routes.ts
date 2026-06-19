import { Router } from "express";
import { getHealth } from "../controllers/health.controller.js";

/** Infrastructure health — mounted at the server root, outside /api/v1. */
export const healthRouter = Router();

healthRouter.get("/healthz", getHealth);
