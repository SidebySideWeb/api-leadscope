/**
 * Local Dataset Store
 * 
 * Filesystem-based storage for businesses and contacts.
 * Temporary fallback replacing Supabase.
 * 
 * Structure:
 * /data/datasets/{datasetId}/businesses.json
 * /data/datasets/{datasetId}/contacts.json
 * 
 * Features:
 * - Auto-creates directories
 * - JSON files only
 * - No database usage
 */

import fs from 'fs/promises';
import path from 'path';
import type { Business, Contact } from '../types/index.js';

const DATA_DIR = path.join(process.cwd(), 'data', 'datasets');

/**
 * Get dataset directory path
 */
function getDatasetDir(datasetId: string): string {
  return path.join(DATA_DIR, datasetId);
}

/**
 * Get businesses file path for a dataset
 */
function getBusinessesFile(datasetId: string): string {
  return path.join(getDatasetDir(datasetId), 'businesses.json');
}

/**
 * Get contacts file path for a dataset
 */
function getContactsFile(datasetId: string): string {
  return path.join(getDatasetDir(datasetId), 'contacts.json');
}

/**
 * Ensure dataset directory exists
 */
async function ensureDatasetDir(datasetId: string): Promise<void> {
  const dir = getDatasetDir(datasetId);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Save businesses to JSON file
 * 
 * @param datasetId - Dataset UUID
 * @param businesses - Array of businesses to save
 */
export async function saveBusinesses(
  datasetId: string,
  businesses: Business[]
): Promise<void> {
  try {
    // Ensure directory exists
    await ensureDatasetDir(datasetId);
    
    // Get file path
    const filePath = getBusinessesFile(datasetId);
    
    // Convert dates to ISO strings for JSON serialization
    const serialized = businesses.map(business => ({
      ...business,
      created_at: business.created_at instanceof Date 
        ? business.created_at.toISOString() 
        : business.created_at,
      updated_at: business.updated_at instanceof Date 
        ? business.updated_at.toISOString() 
        : business.updated_at,
    }));
    
    // Write to file (pretty-printed JSON)
    await fs.writeFile(
      filePath,
      JSON.stringify(serialized, null, 2),
      'utf-8'
    );
    
    console.log(`[localDatasetStore] Saved ${businesses.length} businesses to ${filePath}`);
  } catch (error) {
    console.error(`[localDatasetStore] Error saving businesses for dataset ${datasetId}:`, error);
    throw error;
  }
}

/**
 * Load businesses from JSON file
 * 
 * @param datasetId - Dataset UUID
 * @returns Array of businesses, or empty array if file doesn't exist
 */
export async function loadBusinesses(datasetId: string): Promise<Business[]> {
  try {
    const filePath = getBusinessesFile(datasetId);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      // File doesn't exist, return empty array
      return [];
    }
    
    // Read and parse JSON
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Array<Omit<Business, 'created_at' | 'updated_at'> & {
      created_at: string;
      updated_at: string;
    }>;
    
    // Convert ISO strings back to Date objects
    const businesses: Business[] = parsed.map(business => ({
      ...business,
      created_at: new Date(business.created_at),
      updated_at: new Date(business.updated_at),
    }));
    
    console.log(`[localDatasetStore] Loaded ${businesses.length} businesses from ${filePath}`);
    return businesses;
  } catch (error) {
    console.error(`[localDatasetStore] Error loading businesses for dataset ${datasetId}:`, error);
    // Return empty array on error (graceful degradation)
    return [];
  }
}

/**
 * Save contacts to JSON file
 * 
 * @param datasetId - Dataset UUID
 * @param contacts - Array of contacts to save
 */
export async function saveContacts(
  datasetId: string,
  contacts: Contact[]
): Promise<void> {
  try {
    // Ensure directory exists
    await ensureDatasetDir(datasetId);
    
    // Get file path
    const filePath = getContactsFile(datasetId);
    
    // Convert dates to ISO strings for JSON serialization
    const serialized = contacts.map(contact => ({
      ...contact,
      first_seen_at: contact.first_seen_at instanceof Date 
        ? contact.first_seen_at.toISOString() 
        : contact.first_seen_at,
      last_verified_at: contact.last_verified_at instanceof Date 
        ? contact.last_verified_at.toISOString() 
        : contact.last_verified_at,
      created_at: contact.created_at instanceof Date 
        ? contact.created_at.toISOString() 
        : contact.created_at,
    }));
    
    // Write to file (pretty-printed JSON)
    await fs.writeFile(
      filePath,
      JSON.stringify(serialized, null, 2),
      'utf-8'
    );
    
    console.log(`[localDatasetStore] Saved ${contacts.length} contacts to ${filePath}`);
  } catch (error) {
    console.error(`[localDatasetStore] Error saving contacts for dataset ${datasetId}:`, error);
    throw error;
  }
}

/**
 * Load contacts from JSON file
 * 
 * @param datasetId - Dataset UUID
 * @returns Array of contacts, or empty array if file doesn't exist
 */
export async function loadContacts(datasetId: string): Promise<Contact[]> {
  try {
    const filePath = getContactsFile(datasetId);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      // File doesn't exist, return empty array
      return [];
    }
    
    // Read and parse JSON
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Array<Omit<Contact, 'first_seen_at' | 'last_verified_at' | 'created_at'> & {
      first_seen_at: string;
      last_verified_at: string;
      created_at: string;
    }>;
    
    // Convert ISO strings back to Date objects
    const contacts: Contact[] = parsed.map(contact => ({
      ...contact,
      first_seen_at: new Date(contact.first_seen_at),
      last_verified_at: new Date(contact.last_verified_at),
      created_at: new Date(contact.created_at),
    }));
    
    console.log(`[localDatasetStore] Loaded ${contacts.length} contacts from ${filePath}`);
    return contacts;
  } catch (error) {
    console.error(`[localDatasetStore] Error loading contacts for dataset ${datasetId}:`, error);
    // Return empty array on error (graceful degradation)
    return [];
  }
}

/**
 * Check if dataset directory exists
 * 
 * @param datasetId - Dataset UUID
 * @returns True if dataset directory exists
 */
export async function datasetExists(datasetId: string): Promise<boolean> {
  try {
    const dir = getDatasetDir(datasetId);
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete dataset directory and all its files
 * 
 * @param datasetId - Dataset UUID
 */
export async function deleteDataset(datasetId: string): Promise<void> {
  try {
    const dir = getDatasetDir(datasetId);
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`[localDatasetStore] Deleted dataset directory: ${dir}`);
  } catch (error) {
    console.error(`[localDatasetStore] Error deleting dataset ${datasetId}:`, error);
    throw error;
  }
}

/**
 * List all dataset IDs (from directory names)
 * 
 * @returns Array of dataset IDs
 */
export async function listDatasets(): Promise<string[]> {
  try {
    // Ensure base directory exists
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // Read directory contents
    const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
    
    // Filter to only directories (each directory is a dataset ID)
    const datasetIds = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
    
    return datasetIds;
  } catch (error) {
    console.error('[localDatasetStore] Error listing datasets:', error);
    return [];
  }
}
