
import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { UserRole } from "../../generated/prisma/client";
import { prisma } from "../config/database";
import { getPhotoStorage } from "../config/supabase-storage";
import {
  requireAuth,
  allowRoles,
} from "../middleware/auth.middleware";
import type { AuthenticatedRequest } from "../middleware/auth.middleware";

const router = Router();

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const extensionByMimeType: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const mimeTypeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Only JPG, PNG and WebP images are allowed."));
      return;
    }
    callback(null, true);
  },
});

function hasValidImageSignature(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  if (mimeType === "image/png") {
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    );
  }

  if (mimeType === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }

  return false;
}

function isSafePhotoFilename(filename: string): boolean {
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename);
}

// --------------------------------------------------
// GET: AUTHENTICATED PHOTO DELIVERY
// Buyers: own company only.
// Supervisors: assigned unit only.
// Merchandisers: all orders.
// --------------------------------------------------

router.get(
  "/file/:filename",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;

      const rawFilename = req.params.filename;
      const filename = Array.isArray(rawFilename)
        ? rawFilename[0]
        : rawFilename;

      if (!user) {
        return res.status(401).json({
          message: "Authentication required",
        });
      }

      if (
        typeof filename !== "string" ||
        !isSafePhotoFilename(filename)
      ) {
        return res.status(404).json({
          message: "Photo not found",
        });
      }

      // Find the production update associated with this filename.
      const photoRecord = await prisma.productionUpdate.findFirst({
        where: {
          photoUrl: {
            endsWith: filename,
          },
        },
        select: {
          orderId: true,
        },
      });

      if (!photoRecord) {
        return res.status(404).json({
          message: "Photo not found",
        });
      }

      const order = await prisma.order.findUnique({
        where: {
          id: photoRecord.orderId,
        },
        select: {
          buyerId: true,
          unitName: true,
        },
      });

      if (!order) {
        return res.status(404).json({
          message: "Photo not found",
        });
      }

      // Keep the existing order-level authorization rules.
      const orderAccessAllowed =
        user.role === UserRole.MERCHANDISER ||
        (user.role === UserRole.BUYER &&
          Boolean(user.buyerId) &&
          user.buyerId === order.buyerId) ||
        (user.role === UserRole.SUPERVISOR &&
          Boolean(user.unitId) &&
          user.unitId === order.unitName);

      // Return 404 rather than disclose inaccessible photo records.
      if (!orderAccessAllowed) {
        return res.status(404).json({
          message: "Photo not found",
        });
      }

      const extension = path.extname(filename).toLowerCase();
      const mimeType = mimeTypeByExtension[extension];

      if (!mimeType) {
        return res.status(404).json({
          message: "Photo not found",
        });
      }

      // Download from the private Supabase Storage bucket.
      const { client, bucketName } = getPhotoStorage();

      const { data, error } = await client.storage
        .from(bucketName)
        .download(filename);

      if (error) {
        if (/not found/i.test(error.message)) {
          return res.status(404).json({
            message: "Photo file not found",
          });
        }

        throw error;
      }

      if (!data) {
        return res.status(404).json({
          message: "Photo file not found",
        });
      }

      const imageBuffer = Buffer.from(await data.arrayBuffer());

      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", imageBuffer.length);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");

      return res.status(200).send(imageBuffer);
    } catch (error) {
      console.error("Protected Supabase photo retrieval error:", error);

      return res.status(500).json({
        message: "Unable to retrieve production photo",
      });
    }
  },
);

// --------------------------------------------------
// POST: SUPERVISOR PHOTO UPLOAD
// --------------------------------------------------

router.post(
  "/upload",
  requireAuth,
  allowRoles(UserRole.SUPERVISOR),
  upload.single("photo"),
  async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;

      if (!user || !user.unitId) {
        return res.status(403).json({
          message: "Supervisor is not assigned to a production unit",
        });
      }

      const orderId = req.body?.orderId;

      if (typeof orderId !== "string" || !orderId.trim()) {
        return res.status(400).json({
          message: "Order ID is required",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          message: "Please select a production photo",
        });
      }

      if (!hasValidImageSignature(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({
          message: "The selected file is not a valid JPG, PNG or WebP image",
        });
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          unitName: true,
        },
      });

      if (!order) {
        return res.status(404).json({
          message: "Order not found",
        });
      }

      if (order.unitName !== user.unitId) {
        return res.status(403).json({
          message: "You cannot upload photos for another production unit",
        });
      }

      const extension = extensionByMimeType[req.file.mimetype];

      if (!extension) {
        return res.status(400).json({
          message: "Unsupported image format",
        });
      }

      const filename = `${randomUUID()}${extension}`;

      // Upload the file to the private Supabase Storage bucket.
      const { client, bucketName } = getPhotoStorage();

      const { error: storageError } = await client.storage
        .from(bucketName)
        .upload(filename, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });

      if (storageError) {
        console.error("Supabase photo upload error:", storageError);
        throw storageError;
      }

      // Preserve the existing absolute URL format expected by the API.
      // The order API will continue rewriting this to the protected path.
      const baseUrl = (
        process.env.API_PUBLIC_URL || "http://localhost:5000"
      ).replace(/\/$/, "");

      const photoUrl =
        `${baseUrl}/api/production-photos/file/${filename}`;

      return res.status(201).json({
        success: true,
        message: "Production photo uploaded successfully",
        photoUrl,
      });
    } catch (error) {
      console.error("Production photo upload error:", error);

      return res.status(500).json({
        message: "Unable to upload production photo",
      });
    }
  },
);

export default router;
