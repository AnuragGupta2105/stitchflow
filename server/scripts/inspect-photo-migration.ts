
import "dotenv/config";

import { readdir } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/config/database";
import { getPhotoStorage } from "../src/config/supabase-storage";

const uploadsDirectory = path.resolve(process.cwd(), "uploads");
const safeFilenamePattern = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i;
const pageSize = 1000;

function extractFilename(photoUrl: string): string | null {
  let filename: string;

  try {
    filename = path.posix.basename(new URL(photoUrl).pathname);
  } catch {
    filename = path.posix.basename(photoUrl.replace(/\\/g, "/"));
  }

  return safeFilenamePattern.test(filename) ? filename : null;
}

async function main() {
  console.log("\nSTITCHFLOW PHOTO MIGRATION — DRY RUN");
  console.log("-----------------------------------");
  console.log("Mode: READ ONLY — no uploads or deletions\n");

  // 1. Read photo references from the database.
  const photoRecords = await prisma.productionUpdate.findMany({
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

  const referencedNames = new Set<string>();
  let invalidReferences = 0;

  for (const record of photoRecords) {
    if (!record.photoUrl) continue;

    const filename = extractFilename(record.photoUrl);

    if (!filename) {
      invalidReferences++;
      continue;
    }

    referencedNames.add(filename);
  }

  // 2. Inspect local uploads without modifying them.
  let localEntries: import("node:fs").Dirent[] = [];

  try {
    localEntries = await readdir(uploadsDirectory, {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const localNames = new Set(
    localEntries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => safeFilenamePattern.test(name)),
  );

  // 3. Inspect existing Supabase objects without uploading anything.
  const { client, bucketName } = getPhotoStorage();
  const remoteNames = new Set<string>();

  let offset = 0;

  while (true) {
    const { data, error } = await client.storage
      .from(bucketName)
      .list("", {
        limit: pageSize,
        offset,
      });

    if (error) {
      throw new Error(`Unable to list Supabase photos: ${error.message}`);
    }

    for (const object of data ?? []) {
      remoteNames.add(object.name);
    }

    if (!data || data.length < pageSize) break;

    offset += pageSize;
  }

  // 4. Compare the three sources.
  const foundLocally = [...referencedNames].filter(
    (name) => localNames.has(name),
  );

  const missingLocally = [...referencedNames].filter(
    (name) => !localNames.has(name),
  );

  const alreadyInSupabase = [...referencedNames].filter(
    (name) => remoteNames.has(name),
  );

  const readyToUpload = foundLocally.filter(
    (name) => !remoteNames.has(name),
  );

  const unreferencedLocal = [...localNames].filter(
    (name) => !referencedNames.has(name),
  );

  // 5. Print counts only. No credentials or image contents are displayed.
  console.log("Database records with photo URLs:", photoRecords.length);
  console.log("Unique valid photo filenames:", referencedNames.size);
  console.log("Invalid or unsupported references:", invalidReferences);
  console.log("Local image files found:", localNames.size);
  console.log("Database-linked files found locally:", foundLocally.length);
  console.log("Database-linked files missing locally:", missingLocally.length);
  console.log("Already present in Supabase:", alreadyInSupabase.length);
  console.log("Ready to upload:", readyToUpload.length);
  console.log("Unreferenced local images:", unreferencedLocal.length);
  console.log("Objects currently in Supabase bucket:", remoteNames.size);

  console.log("\nDry run complete. No files were changed.");
}

main()
  .catch((error) => {
    console.error("\nPhoto migration inspection failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
