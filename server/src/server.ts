
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { prisma } from "./config/database";

import authRoutes from "./routes/auth.routes";
import orderRoutes from "./routes/orders.routes";
import productionUpdatesRoutes from "./routes/production-updates.routes";
import productionPhotosRoutes from "./routes/production-photos.routes";
import issueReasonRoutes from "./routes/issue-reasons.routes";
import orderAuditRoutes from "./routes/order-audit.routes";

import { requireAuth } from "./middleware/auth.middleware";
import type { AuthenticatedRequest } from "./middleware/auth.middleware";

const app = express();

// --------------------------------------------------
// CORS CONFIGURATION
// IMPORTANT: This must be before ALL API routes.
// --------------------------------------------------

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error(`Origin ${origin} is not allowed by CORS`)
      );
    },

    methods: [
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],

    credentials: true,
    optionsSuccessStatus: 204,
  })
);

// --------------------------------------------------
// SECURITY MIDDLEWARE
// --------------------------------------------------

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);

app.use(express.json({ limit: "2mb" }));

// --------------------------------------------------
// API ROUTES
// Register routes only AFTER CORS middleware.
// --------------------------------------------------

app.use("/api/auth", authRoutes);

app.use("/api/orders", orderRoutes);

app.use("/api/production-updates", productionUpdatesRoutes);

app.use("/api/production-photos", productionPhotosRoutes);

app.use("/api/issue-reasons", issueReasonRoutes);

app.use("/api/order-audit", orderAuditRoutes);

// --------------------------------------------------
// ROOT ENDPOINT
// --------------------------------------------------

app.get("/", (req, res) => {
  return res.json({
    message: "Welcome to StitchFlow API",
    status: "Running",
  });
});

// --------------------------------------------------
// DATABASE HEALTH CHECK
// --------------------------------------------------

app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return res.json({
      status: "healthy",
      database: "connected",
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    return res.status(500).json({
      status: "unhealthy",
      database: "disconnected",
    });
  }
});

// --------------------------------------------------
// AUTHENTICATED USER ENDPOINT
// --------------------------------------------------

app.get("/api/auth/me", requireAuth, (req, res) => {
  const authReq = req as AuthenticatedRequest;

  return res.json({
    message: "Authenticated successfully",
    user: authReq.user,
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`StitchFlow API running on port ${PORT}`);
});
