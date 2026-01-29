/**
 * Export Storage Adapter
 * 
 * Handles saving export files to Supabase Storage (preferred) or local filesystem (fallback).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface ExportStorageResult {
  filePath: string;
  downloadUrl: string | null; // null for local filesystem
}

/**
 * Supabase Storage Adapter
 */
export class SupabaseExportStorage {
  private supabase: SupabaseClient;
  private bucketName: string;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    this.bucketName = process.env.SUPABASE_EXPORTS_BUCKET || 'exports';
  }

  /**
   * Upload export file to Supabase Storage
   */
  async saveExport(
    userId: string,
    filename: string,
    fileBuffer: Buffer,
    contentType: string,
    expiresInDays: number = 7
  ): Promise<ExportStorageResult> {
    const filePath = `exports/${userId}/${filename}`;

    // Upload file
    const { error: uploadError } = await this.supabase.storage
      .from(this.bucketName)
      .upload(filePath, fileBuffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Failed to upload export file: ${uploadError.message}`);
    }

    // Generate signed URL
    const expiresInSeconds = expiresInDays * 24 * 60 * 60;
    const { data: urlData, error: urlError } = await this.supabase.storage
      .from(this.bucketName)
      .createSignedUrl(filePath, expiresInSeconds);

    if (urlError || !urlData) {
      throw new Error(`Failed to generate download URL: ${urlError?.message}`);
    }

    return {
      filePath,
      downloadUrl: urlData.signedUrl,
    };
  }

  /**
   * Check if Supabase Storage is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .list('', { limit: 1 });

      return !error;
    } catch {
      return false;
    }
  }
}

/**
 * Local Filesystem Storage Adapter
 */
export class LocalExportStorage {
  private baseDir: string;

  constructor(baseDir: string = 'data/exports') {
    this.baseDir = baseDir;
  }

  /**
   * Save export file to local filesystem
   */
  async saveExport(
    userId: string,
    filename: string,
    fileBuffer: Buffer,
    _contentType: string,
    _expiresInDays?: number
  ): Promise<ExportStorageResult> {
    const userDir = path.join(this.baseDir, userId);
    await fs.mkdir(userDir, { recursive: true });

    const filePath = path.join(userDir, filename);
    await fs.writeFile(filePath, fileBuffer);

    return {
      filePath,
      downloadUrl: null, // Local filesystem - no download URL
    };
  }

  /**
   * Always available (local filesystem)
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

/**
 * Resolve export storage with automatic fallback
 */
export async function resolveExportStorage(): Promise<SupabaseExportStorage | LocalExportStorage> {
  // Try Supabase first
  try {
    const supabaseStorage = new SupabaseExportStorage();
    const available = await supabaseStorage.isAvailable();
    if (available) {
      console.log('[exportStorage] Using Supabase Storage');
      return supabaseStorage;
    }
  } catch (error) {
    console.warn('[exportStorage] Supabase Storage unavailable, falling back to local filesystem:', error);
  }

  // Fallback to local filesystem
  console.warn('[exportStorage] Using local filesystem storage (Supabase unavailable)');
  return new LocalExportStorage();
}
