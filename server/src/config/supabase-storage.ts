import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

let storageClient: ReturnType<typeof createClient> | null = null;

export function getPhotoStorage() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET?.trim();

  if (!supabaseUrl || !secretKey || !bucketName) {
    throw new Error(
      "Missing Supabase Storage configuration. Check server/.env.",
    );
  }

  if (!storageClient) {
    storageClient = createClient(supabaseUrl, secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return {
    client: storageClient,
    bucketName,
  };
}