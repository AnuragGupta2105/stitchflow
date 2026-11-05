import { Router } from "express";
import { z } from "zod";

import { UserRole } from "../../generated/prisma/client";
import { prisma } from "../config/database";
import { requireAuth, allowRoles } from "../middleware/auth.middleware";
import type { AuthenticatedRequest } from "../middleware/auth.middleware";

const router = Router();

const milestoneDateSchema = z.object({
  plannedDate: z.coerce.date(),
});

const exFactoryDateSchema = z.object({
  exFactoryDate: z.coerce.date(),
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

// --------------------------------------------------
// PATCH: CHANGE A TNA MILESTONE DATE
// Merchandiser only. Every actual change is audited.
// --------------------------------------------------
router.patch(
  "/milestones/:milestoneId/date",
  requireAuth,
  allowRoles(UserRole.MERCHANDISER),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const parsed = milestoneDateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "A valid plannedDate is required",
          errors: parsed.error.flatten(),
        });
      }

      const milestoneIdParam = req.params.milestoneId;
      const milestoneId = Array.isArray(milestoneIdParam) ? milestoneIdParam[0] : milestoneIdParam;
      if (!milestoneId) {
        return res.status(400).json({ message: "Milestone ID is required" });
      }

      const milestone = await prisma.milestone.findUnique({
        where: { id: milestoneId },
        include: {
          order: {
            select: {
              id: true,
              poNumber: true,
              exFactoryDate: true,
            },
          },
        },
      });

      if (!milestone) {
        return res.status(404).json({ message: "TNA milestone not found" });
      }

      const nextDate = parsed.data.plannedDate;
      const previousDate = milestone.plannedDate;

      if (nextDate.getTime() > milestone.order.exFactoryDate.getTime()) {
        return res.status(400).json({
          message: "A TNA milestone cannot be scheduled after the ex-factory date",
        });
      }

      if (nextDate.getTime() === previousDate.getTime()) {
        return res.json({
          success: true,
          changed: false,
          message: "The planned date is unchanged",
          milestone,
        });
      }

      // Preserve the current chronological sequence. A milestone cannot
      // cross the date of the stage immediately before or after it.
      const orderedMilestones = await prisma.milestone.findMany({
        where: { orderId: milestone.orderId },
        orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, plannedDate: true, stage: true },
      });

      const currentIndex = orderedMilestones.findIndex(
        (item) => item.id === milestone.id,
      );
      const previousMilestone = currentIndex > 0
        ? orderedMilestones[currentIndex - 1]
        : undefined;
      const nextMilestone = currentIndex >= 0 && currentIndex < orderedMilestones.length - 1
        ? orderedMilestones[currentIndex + 1]
        : undefined;

      if (previousMilestone && nextDate.getTime() < previousMilestone.plannedDate.getTime()) {
        return res.status(400).json({
          message: `The ${milestone.stage} date cannot be earlier than ${previousMilestone.stage}`,
        });
      }

      if (nextMilestone && nextDate.getTime() > nextMilestone.plannedDate.getTime()) {
        return res.status(400).json({
          message: `The ${milestone.stage} date cannot be later than ${nextMilestone.stage}`,
        });
      }

      const result = await prisma.$transaction(async (tx) => {
        const updatedMilestone = await tx.milestone.update({
          where: { id: milestone.id },
          data: { plannedDate: nextDate },
        });

        await tx.auditLog.create({
          data: {
            orderId: milestone.orderId,
            fieldName: `TNA:${milestone.stage}:plannedDate`,
            oldValue: previousDate.toISOString(),
            newValue: nextDate.toISOString(),
            changedBy: user.id,
          },
        });

        return updatedMilestone;
      });

      return res.json({
        success: true,
        changed: true,
        message: "TNA date updated and audit history recorded",
        milestone: result,
      });
    } catch (error) {
      console.error("TNA date update error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to update TNA date",
        detail: process.env.NODE_ENV === "development" ? getErrorMessage(error) : undefined,
      });
    }
  },
);

// --------------------------------------------------
// PATCH: CHANGE ORDER EX-FACTORY DATE
// Merchandiser only. Existing TNA milestones may not
// end up after the new shipment date.
// --------------------------------------------------
router.patch(
  "/orders/:orderId/ex-factory-date",
  requireAuth,
  allowRoles(UserRole.MERCHANDISER),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const parsed = exFactoryDateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "A valid exFactoryDate is required",
          errors: parsed.error.flatten(),
        });
      }

      const orderIdParam = req.params.orderId;
      const orderId = Array.isArray(orderIdParam) ? orderIdParam[0] : orderIdParam;
      if (!orderId) {
        return res.status(400).json({ message: "Order ID is required" });
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { milestones: true },
      });

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const nextDate = parsed.data.exFactoryDate;
      const previousDate = order.exFactoryDate;

      const milestoneAfterNewShipDate = order.milestones.find(
        (item) => item.plannedDate.getTime() > nextDate.getTime(),
      );

      if (milestoneAfterNewShipDate) {
        return res.status(400).json({
          message: `The new ex-factory date must be on or after the ${milestoneAfterNewShipDate.stage} milestone`,
        });
      }

      if (nextDate.getTime() === previousDate.getTime()) {
        return res.json({
          success: true,
          changed: false,
          message: "The ex-factory date is unchanged",
          order,
        });
      }

      const updatedOrder = await prisma.$transaction(async (tx) => {
        const updated = await tx.order.update({
          where: { id: order.id },
          data: { exFactoryDate: nextDate },
        });

        await tx.auditLog.create({
          data: {
            orderId: order.id,
            fieldName: "ORDER:exFactoryDate",
            oldValue: previousDate.toISOString(),
            newValue: nextDate.toISOString(),
            changedBy: user.id,
          },
        });

        return updated;
      });

      return res.json({
        success: true,
        changed: true,
        message: "Ex-factory date updated and audit history recorded",
        order: updatedOrder,
      });
    } catch (error) {
      console.error("Ex-factory date update error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to update ex-factory date",
        detail: process.env.NODE_ENV === "development" ? getErrorMessage(error) : undefined,
      });
    }
  },
);

// --------------------------------------------------
// GET: ORDER DATE-CHANGE AUDIT HISTORY
// Merchandiser: all orders.
// Buyer: only their own company's orders.
// Supervisor: only orders assigned to their unit.
// --------------------------------------------------
router.get(
  "/orders/:orderId",
  requireAuth,
  allowRoles(UserRole.MERCHANDISER, UserRole.BUYER, UserRole.SUPERVISOR),
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const orderIdParam = req.params.orderId;
      const orderId = Array.isArray(orderIdParam) ? orderIdParam[0] : orderIdParam;
      if (!orderId) {
        return res.status(400).json({ message: "Order ID is required" });
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, poNumber: true, buyerId: true, unitName: true },
      });

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const hasAccess =
        user.role === UserRole.MERCHANDISER ||
        (user.role === UserRole.BUYER && !!user.buyerId && user.buyerId === order.buyerId) ||
        (user.role === UserRole.SUPERVISOR && !!user.unitId && user.unitId === order.unitName);

      if (!hasAccess) {
        return res.status(404).json({ message: "Order not found" });
      }

      const entries = await prisma.auditLog.findMany({
        where: {
          orderId: order.id,
          OR: [
            { fieldName: { startsWith: "TNA:" } },
            { fieldName: { startsWith: "ORDER:" } },
          ],
        },
        orderBy: { changedAt: "desc" },
        take: 100,
      });

      const userIds = [...new Set(entries.map((entry) => entry.changedBy).filter(Boolean))];
      const users = userIds.length
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];
      const userNames = new Map(users.map((item) => [item.id, item.name]));

      return res.json({
        success: true,
        order: { id: order.id, poNumber: order.poNumber },
        count: entries.length,
        entries: entries.map((entry) => ({
          id: entry.id,
          fieldName: entry.fieldName,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          changedByName: userNames.get(entry.changedBy) ?? "Former or unavailable user",
          changedAt: entry.changedAt,
        })),
      });
    } catch (error) {
      console.error("Audit history retrieval error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to retrieve order audit history",
      });
    }
  },
);

export default router;
