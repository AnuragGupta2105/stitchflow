
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "./config/database";
import {
  UserRole,
  OrderStatus,
  ProductionStage,
  MilestoneStatus,
} from "../generated/prisma/client";

async function main() {
  const demoPassword = process.env.DEMO_USER_PASSWORD;

  if (!demoPassword || demoPassword.length < 12) {
    throw new Error("Set a DEMO_USER_PASSWORD of at least 12 characters in .env");
  }

  const passwordHash = await bcrypt.hash(demoPassword, 12);

  // Create buyer companies
  const companyB = await prisma.buyer.findFirst({
    where: { companyName: "Company B" },
  }) ?? await prisma.buyer.create({
    data: {
      companyName: "Company B",
      country: "United Kingdom",
    },
  });

  const companyC = await prisma.buyer.findFirst({
    where: { companyName: "Company C" },
  }) ?? await prisma.buyer.create({
    data: {
      companyName: "Company C",
      country: "Germany",
    },
  });

  // Create demo users
  const users = [
    {
      name: "Demo Merchandiser",
      email: "merchandiser@stitchflow.demo",
      role: UserRole.MERCHANDISER,
      buyerId: null,
      unitId: null,
    },
    {
      name: "Demo Supervisor",
      email: "supervisor@stitchflow.demo",
      role: UserRole.SUPERVISOR,
      buyerId: null,
      unitId: "UNIT-01",
    },
    {
      name: "Company B Buyer",
      email: "buyer.b@stitchflow.demo",
      role: UserRole.BUYER,
      buyerId: companyB.id,
      unitId: null,
    },
    {
      name: "Company C Buyer",
      email: "buyer.c@stitchflow.demo",
      role: UserRole.BUYER,
      buyerId: companyC.id,
      unitId: null,
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        passwordHash,
        role: user.role,
        buyerId: user.buyerId,
        unitId: user.unitId,
      },
      create: {
        ...user,
        passwordHash,
      },
    });
  }

  // Create sample production orders
  const orders = [
    {
      poNumber: "B-PO-88213",
      buyerId: companyB.id,
      styleName: "Men's Crew Neck Tee",
      colour: "Navy",
      totalQuantity: 12000,
      completedQty: 6800,
      exFactoryDate: new Date("2026-11-20"),
      status: OrderStatus.ON_TRACK,
      unitName: "UNIT-01",
      stage: ProductionStage.STITCHING,
      plannedDate: new Date("2026-11-08"),
    },
    {
      poNumber: "B-PO-88240",
      buyerId: companyB.id,
      styleName: "Men's Polo",
      colour: "White",
      totalQuantity: 8000,
      completedQty: 5200,
      exFactoryDate: new Date("2026-11-12"),
      status: OrderStatus.AT_RISK,
      unitName: "UNIT-02",
      stage: ProductionStage.FINISHING,
      plannedDate: new Date("2026-11-06"),
    },
    {
      poNumber: "C-PO-0488",
      buyerId: companyC.id,
      styleName: "Kids Printed Tee",
      colour: "Yellow",
      totalQuantity: 10000,
      completedQty: 3100,
      exFactoryDate: new Date("2026-11-28"),
      status: OrderStatus.ON_TRACK,
      unitName: "UNIT-03",
      stage: ProductionStage.PRINTING,
      plannedDate: new Date("2026-11-15"),
    },
  ];

  for (const order of orders) {
    const savedOrder = await prisma.order.upsert({
      where: { poNumber: order.poNumber },
      update: {
        buyerId: order.buyerId,
        styleName: order.styleName,
        colour: order.colour,
        totalQuantity: order.totalQuantity,
        completedQty: order.completedQty,
        exFactoryDate: order.exFactoryDate,
        status: order.status,
        unitName: order.unitName,
      },
      create: {
        poNumber: order.poNumber,
        buyerId: order.buyerId,
        styleName: order.styleName,
        colour: order.colour,
        totalQuantity: order.totalQuantity,
        completedQty: order.completedQty,
        exFactoryDate: order.exFactoryDate,
        status: order.status,
        unitName: order.unitName,
      },
    });

    await prisma.milestone.upsert({
      where: { id: `${savedOrder.id}-initial` },
      update: {
        stage: order.stage,
        plannedDate: order.plannedDate,
      },
      create: {
        id: `${savedOrder.id}-initial`,
        orderId: savedOrder.id,
        stage: order.stage,
        plannedDate: order.plannedDate,
        status: MilestoneStatus.IN_PROGRESS,
      },
    });
  }

  console.log("StitchFlow demo data seeded successfully!");
  console.log("Created/updated 2 buyer companies, 4 users and 3 orders.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
