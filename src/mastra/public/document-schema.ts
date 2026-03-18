import { z } from 'zod';

/**
 * Global Document Schema for G-Trace / Financo
 * Integrated with Vision AI and Reverse Geocoding Intelligence.
 */
export const DocumentSchema = z.object({
  // 1. LOGIQUE MÉTIER
  report_type: z.enum(["LOST", "FOUND", "PERSONAL_VAULT"])
    .describe("The context: is it for the personal vault or a lost/found report?"),
  
  doc_category: z.enum([
    "NATIONAL_ID", "PASSPORT", "DRIVERS_LICENSE", 
    "ACADEMIC_TRANSCRIPT", "CONTRACT", "CV", "INVOICE", "OTHER"
  ]).describe("Automated classification of the document type"),

  // 2. DONNÉES D'IDENTITÉ (Extraites par l'OCR)
  owner_full_name: z.string().nullable(),
  doc_number: z.string().nullable(),
  description: z.string().describe("AI-generated 2-sentence summary of the document"),
  
  // 3. LOCALISATION (Colonnes principales)
  country_code: z.string().length(2).default("CM"),
  city: z.string().nullable(),
  neighborhood: z.string().nullable(),

  // 4. LE "CERVEAU" (ai_metadata JSONB)
  ai_metadata: z.object({
    // Infos temporelles
    expiry_date: z.string().nullable(),
    issue_date: z.string().nullable(),
    birth_date: z.string().nullable(),
    
    // Sécurité et Fiabilité
    mrz: z.string().optional().describe("Machine Readable Zone for passports"),
    confidence_score: z.number().min(0).max(1),
    liveness_status: z.enum(["ORIGINAL", "PHOTOCOPY", "SCREEN_PHOTO", "UNCERTAIN"]),
    
    // RECHERCHE & ORGANISATION (Pour ton Digital Vault)
    raw_markdown: z.string().describe("Complete text for full-text search indexing"),
    tags: z.array(z.string()).describe("Auto-generated tags for smart filtering"),

    // --- NOUVEAU : ENRICHISSEMENT GÉOGRAPHIQUE ---
    upload_context: z.object({
      detected_country: z.string().describe("Country name from geocoding"),
      detected_city: z.string().describe("City name from geocoding"),
      precise_latitude: z.number(),
      precise_longitude: z.number(),
      upload_timestamp: z.string()
    }).describe("Geographical data captured during upload")
  }),
});