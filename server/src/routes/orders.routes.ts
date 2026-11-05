import { Router } from "express";
import { z } from "zod";

import {
  UserRole,
  OrderStatus,
  ProductionStage,
  MilestoneStatus,
} from "../../generated/prisma/client";

import { prisma } from "../config/database";
import { calculateRiskAnalysis } from "../utils/risk-analysis";


import {
  requireAuth,
  allowRoles,
} from "../middleware/auth.middleware";

import type {
  AuthenticatedRequest,
} from "../middleware/auth.middleware";

const router = Router();

// --------------------------------------------------
// ORDER CREATION VALIDATION
// --------------------------------------------------

const createOrderSchema = z.object({
  poNumber: z.string().trim().min(3).max(50),
  buyerId: z.string().min(1),
  styleName: z.string().trim().min(2).max(120),
  colour: z.string().trim().min(2).max(50),
  totalQuantity: z.number().int().positive(),
  sizeQuantities: z.record(
    z.string().trim().min(1).max(12),
    z.number().int().positive(),
  ).refine(
    (quantities) => Object.keys(quantities).length > 0,
    { message: "At least one size quantity is required" },
  ),
  exFactoryDate: z.coerce.date(),
  unitName: z.string().trim().min(1).max(50),
  milestones: z.array(
    z.object({
      stage: z.nativeEnum(ProductionStage),
      plannedDate: z.coerce.date(),
    })
  ).min(1).max(6),
});

// --------------------------------------------------
// GET: ORDER SETUP OPTIONS
// Merchandiser only
// --------------------------------------------------

router.get(
  "/setup-options",
  requireAuth,
  allowRoles(UserRole.MERCHANDISER),
  async (req, res) => {
    try {
      const buyers = await prisma.buyer.findMany({
        select: {
          id: true,
          companyName: true,
          country: true,
        },
        orderBy: {
          companyName: "asc",
        },
      });

      // Initial unit choices based on the client sample data.
      const units = [
        "UNIT-01",
        "UNIT-02",
        "UNIT-03",
      ];

      // Starter TNA template; offsets are configurable assumptions.
      const defaultTnaTemplate = [
        {
          stage: ProductionStage.CUTTING,
          daysBeforeExFactory: 18,
        },
        {
          stage: ProductionStage.STITCHING,
          daysBeforeExFactory: 14,
        },
        {
          stage: ProductionStage.PRINTING,
          daysBeforeExFactory: 10,
        },
        {
          stage: ProductionStage.WASHING,
          daysBeforeExFactory: 7,
        },
        {
          stage: ProductionStage.FINISHING,
          daysBeforeExFactory: 4,
        },
        {
          stage: ProductionStage.PACKING,
          daysBeforeExFactory: 2,
        },
      ];

      return res.json({
        success: true,
        buyers,
        units,
        stages: Object.values(ProductionStage),
        defaultTnaTemplate,
      });
    } catch (error) {
      console.error("Order setup options error:", error);

      return res.status(500).json({
        message: "Unable to load order setup options",
      });
    }
  }
);

// --------------------------------------------------
// GET: RETRIEVE ORDERS
// Buyer sees own company orders.
// Supervisor sees assigned unit orders.
// Merchandiser sees all orders.
// --------------------------------------------------

router.get(
  "/",
  requireAuth,
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;

      if (!user) {
        return res.status(401).json({
          message: "Authentication required",
        });
      }

      let where = {};

      if (user.role === UserRole.BUYER) {
        if (!user.buyerId) {
          return res.status(403).json({
            message: "Buyer account is not linked to a company",
          });
        }

        where = {
          buyerId: user.buyerId,
        };
      } else if (user.role === UserRole.SUPERVISOR) {
        if (!user.unitId) {
          return res.status(403).json({
            message: "Supervisor is not assigned to a production unit",
          });
        }

        where = {
          unitName: user.unitId,
        };
      }

      const orders = await prisma.order.findMany({
        where,
        include: {
          buyer: {
            select: {
              companyName: true,
              country: true,
            },
          },
          milestones: true,
          // Return recent production records for buyer evidence. The risk
          // utility independently filters this list to its seven-day window.
          // Internal issue notes and reason categories are intentionally omitted.
          updates: {
            orderBy: {
              createdAt: "desc",
            },
            take: 30,
            select: {
              id: true,
              stage: true,
              quantity: true,
              photoUrl: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          exFactoryDate: "asc",
        },
      });

      const ordersWithAccessAwareData = orders.map((order) => {
        // Replace legacy public /uploads URLs with authenticated API paths.
        // The photo endpoint performs an independent order-level access check.
        const updatesWithProtectedPhotoPaths = order.updates.map((update) => {
          if (!update.photoUrl) return update;

          const filename = update.photoUrl.split('?')[0].split('/').pop();
          const safeFilename = filename && /^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename)
            ? filename
            : null;

          return {
            ...update,
            photoUrl: safeFilename
              ? `/production-photos/file/${safeFilename}`
              : null,
          };
        });

        // Automatic run-rate warnings are internal until a merchandiser
        // confirms them for buyer communication. Do not send that analysis
        // to buyer accounts from this endpoint.
        if (user.role === UserRole.BUYER) {
          return {
            ...order,
            updates: updatesWithProtectedPhotoPaths,
            riskAnalysis: undefined,
          };
        }

        return {
          ...order,
          updates: updatesWithProtectedPhotoPaths,
          riskAnalysis: calculateRiskAnalysis(order),
        };
      });

      return res.json({
        count: ordersWithAccessAwareData.length,
        orders: ordersWithAccessAwareData,
      });
    } catch (error) {
      console.error("Order retrieval error:", error);

      return res.status(500).json({
        message: "Unable to retrieve orders",
      });
    }
  }
);

// --------------------------------------------------
// POST: CREATE ORDER WITH SIZE QUANTITIES + TNA
// Merchandiser only
// --------------------------------------------------

router.post(
  "/",
  requireAuth,
  allowRoles(UserRole.MERCHANDISER),
  async (req, res) => {
    try {
      const validation = createOrderSchema.safeParse(req.body);

      if (!validation.success) {
        return res.status(400).json({
          message: "Invalid order information",
          errors: validation.error.flatten(),
        });
      }

      const {
        poNumber,
        buyerId,
        styleName,
        colour,
        totalQuantity,
        sizeQuantities,
        exFactoryDate,
        unitName,
        milestones,
      } = validation.data;

      // Total quantity must equal the sum of all entered sizes.
      const sizeQuantityTotal = Object.values(sizeQuantities).reduce(
        (sum, quantity) => sum + quantity,
        0,
      );

      if (sizeQuantityTotal !== totalQuantity) {
        return res.status(400).json({
          message: "Total quantity must equal the sum of size quantities",
          totalQuantity,
          sizeQuantityTotal,
        });
      }

      // Prevent duplicate PO numbers.
      const existingOrder = await prisma.order.findUnique({
        where: {
          poNumber,
        },
      });

      if (existingOrder) {
        return res.status(409).json({
          message: "An order with this PO number already exists",
        });
      }

      // Verify that the selected buyer exists.
      const buyer = await prisma.buyer.findUnique({
        where: {
          id: buyerId,
        },
      });

      if (!buyer) {
        return res.status(404).json({
          message: "Selected buyer was not found",
        });
      }

      // Prevent duplicate stages.
      const stages = milestones.map((item) => item.stage);

      if (new Set(stages).size !== stages.length) {
        return res.status(400).json({
          message: "A production stage cannot be added more than once",
        });
      }

      // Milestone dates must be chronological.
      for (let index = 1; index < milestones.length; index++) {
        if (
          milestones[index].plannedDate.getTime() <
          milestones[index - 1].plannedDate.getTime()
        ) {
          return res.status(400).json({
            message: "TNA milestone dates must follow chronological order",
          });
        }
      }

      // No production milestone can be scheduled after ex-factory.
      const invalidMilestone = milestones.some(
        (item) => item.plannedDate.getTime() > exFactoryDate.getTime()
      );

      if (invalidMilestone) {
        return res.status(400).json({
          message: "A milestone cannot be scheduled after the ex-factory date",
        });
      }

      // Create order + sizes + milestones in one nested write.
      const order = await prisma.order.create({
        data: {
          poNumber,
          buyerId,
          styleName,
          colour,
          totalQuantity,
          sizeQuantities,
          exFactoryDate,
          unitName,
          status: OrderStatus.ON_TRACK,
          milestones: {
            create: milestones.map((item) => ({
              stage: item.stage,
              plannedDate: item.plannedDate,
              status: MilestoneStatus.PENDING,
            })),
          },
        },
        include: {
          buyer: {
            select: {
              companyName: true,
              country: true,
            },
          },
          milestones: true,
        },
      });

      return res.status(201).json({
        success: true,
        message: "Order created successfully",
        order,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error("Order creation error:", errorMessage);
      if (errorStack) console.error(errorStack);
      else console.error(error);

      const prismaError = error as {
        code?: string;
      };

      if (prismaError.code === "P2002") {
        return res.status(409).json({
          message: "This PO number already exists",
        });
      }

      if (prismaError.code === "P2003") {
        return res.status(400).json({
          message: "Invalid buyer reference",
        });
      }

      return res.status(500).json({
        message: "Unable to create order",
        // Expose diagnostic details only during local development.
        ...(process.env.NODE_ENV !== "production"
          ? { debug: errorMessage }
          : {}),
      });
    }
  }
);

export default router;
