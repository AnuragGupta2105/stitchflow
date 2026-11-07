
import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/config/database";
import { getPhotoStorage } from "../src/config/supabase-storage";

const uploadsDirectory = path.resolve(process.cwd(), "uploads");
const safeFilenamePattern = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i;

const mimeTypeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function extractFilename(photoUrl: string): string | null {
  try {
    const filename = path.posix.basename(
      new URL(photoUrl).pathname,
    );

    return safeFilenamePattern.test(filename) ? filename : null;
  } catch {
    const filename = path.posix.basename(
      photoUrl.replace(/\\/g, "/"),
    );

    return safeFilenamePattern.test(filename) ? filename : null;
  }
}

function hasValidImageSignature(
  buffer: Buffer,
  mimeType: string,
): boolean {
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

async function main() {
  console.log("\nSTITCHFLOW — PHOTO MIGRATION");
  console.log("----------------------------");

  const { client, bucketName } = getPhotoStorage();

  // Read only photo references stored in the database.
  const records = await prisma.productionUpdate.findMany({
    where: {
      photoUrl: {
        not: null,
      },
    },
    select: {
      id: true,
      photoUrl: true,
    },
  });

  const filenames = new Set<string>();

  for (const record of records) {
    if (!record.photoUrl) continue;

    const filename = extractFilename(record.photoUrl);

    if (!filename) {
      throw new Error(
        `Unsupported photo URL format for production update ${record.id}`,
      );
    }

    filenames.add(filename);
  }

  console.log("Database-linked unique photos:", filenames.size);
  console.log("Target bucket:", bucketName);

  let uploaded = 0;
  let alreadyVerified = 0;

  for (const filename of filenames) {
    const extension = path.extname(filename).toLowerCase();
    const mimeType = mimeTypeByExtension[extension];

    if (!mimeType) {
      throw new Error(`Unsupported image extension: ${filename}`);
    }

    const localPath = path.join(uploadsDirectory, filename);
    const imageBuffer = await readFile(localPath);

    if (!hasValidImageSignature(imageBuffer, mimeType)) {
      throw new Error(
        `Image signature validation failed for ${filename}`,
      );
    }

    // Check for an existing object to make reruns safe.
    const { data: existingFile, error: downloadError } =
      await client.storage.from(bucketName).download(filename);

    if (!downloadError && existingFile) {
      const existingBuffer = Buffer.from(
        await existingFile.arrayBuffer(),
      );

      if (!existingBuffer.equals(imageBuffer)) {
        throw new Error(
          `An object with a different image already exists: ${filename}`,
        );
      }

      console.log(`Already verified: ${filename}`);
      alreadyVerified++;
      continue;
    }

    if (
      downloadError &&
      !/not found|object not found/i.test(downloadError.message)
    ) {
      throw new Error(
        `Could not check ${filename}: ${downloadError.message}`,
      );
    }

    const { error: uploadError } = await client.storage
      .from(bucketName)
      .upload(filename, imageBuffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(
        `Upload failed for ${filename}: ${uploadError.message}`,
      );
    }

    console.log(`Uploaded: ${filename}`);
    uploaded++;
  }

  console.log("\nMIGRATION SUMMARY");
  console.log("-----------------");
  console.log("New uploads:", uploaded);
  console.log("Already verified:", alreadyVerified);
  console.log("Total verified:", uploaded + alreadyVerified);
  console.log("Database photo URLs changed: 0");
  console.log("Local files deleted: 0");
  console.log("\nPhoto migration completed.");
}

main()
  .catch((error) => {
    console.error("\nPHOTO MIGRATION FAILED:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
