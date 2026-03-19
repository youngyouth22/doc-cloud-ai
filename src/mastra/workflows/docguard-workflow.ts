import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase';
import { markerTool, pandocTool } from '../tools';
import { categorizationAgent } from '../agents/categorization-agent';

const extractMarkdownStep = createStep({
  id: 'extract-markdown',
  inputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
  }),
  outputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    markdown: z.string(),
    storageName: z.string(),
  }),
  execute: async ({ inputData, requestContext }) => {
    const { fileId, userId } = inputData;
    
    // 1. Fetch document record to get correct storage path (file_url + extension)
    const { data: doc, error: docError } = await supabaseAdmin
      .from('documents')
      .select('file_url, file_extension')
      .eq('id', fileId)
      .single();

    if (docError || !doc) {
      console.error(`[Workflow] Document record ${fileId} not found:`, docError);
      throw new Error(`Document record not found: ${docError?.message || 'Unknown error'}`);
    }

    // Fallback logic for path construction
    const storageName = doc.file_url || fileId; // Support cases where file_url might be missing
    const extension = doc.file_extension || 'pdf';
    const filePath = `${userId}/${storageName}.${extension}`;

    const { data, error } = await supabaseAdmin.storage
      .from('documents')
      .createSignedUrl(filePath, 600);

    console.log(`[Workflow] Processing file: ${filePath}`);
    if (error || !data?.signedUrl) {
      console.error(`[Workflow] Failed to generate signed URL for ${filePath}. Supabase error:`, error);
      throw new Error(`Impossible to generate signed URL: ${error?.message || 'Signed URL is null'}`);
    }

    // 2. Appeler Datalab Marker
    console.log(`[Workflow] Calling Marker tool with signed URL...`);
    const result: any = await markerTool.execute!({ fileUrl: data.signedUrl }, { requestContext });
    console.log(`[Workflow] Marker result success: ${result.success}, markdown length: ${result.markdown?.length || 0}`);
    
    if (!result.success) {
      console.error(`[Workflow] Marker extraction failed: ${result.error}`);
      throw new Error(result.error || 'Failed to extract markdown');
    }
    return { fileId, userId, markdown: result.markdown, storageName };
  }
});

const categorizeDocumentStep = createStep({
  id: 'categorize-document',
  inputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    markdown: z.string(),
    storageName: z.string(),
  }),
  outputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    markdown: z.string(),
    categoryId: z.string(),
    reportType: z.string(), // This will be the enum (e.g., INVOICE)
    documentName: z.string(), // This will be the descriptive title
    storageName: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { fileId, userId, markdown, storageName } = inputData;

    // Sauvegarde de quota : Si le markdown est vide ou trop court, on ne sollicite pas l'IA
    if (!markdown || markdown.trim().length < 10) {
      console.warn(`[Workflow] Document ${fileId} has insufficient content for categorization. Using fallback.`);
      
      return { 
        fileId, 
        userId, 
        markdown, 
        categoryId: '00000000-0000-0000-0000-000000000000', 
        reportType: 'OTHER', 
        documentName: 'Scanned Document', 
        storageName 
      }; 
    }

    // 1. Appeler l'agent de catégorisation
    const result = await categorizationAgent.generate(
      `Categorize this document and generate a descriptive name: ${markdown.substring(0, 4000)}`
    );

    // 2. Extraction du categoryId
    let categoryId = '';
    const toolResults = (result as any).toolResults as any[];
    const categoryToolResult = toolResults?.find(r => r.toolName === 'category-manager');
    
    if (categoryToolResult?.result?.category?.id) {
      categoryId = categoryToolResult.result.category.id;
    }

    if (!categoryId) {
      const categoryIdMatch = result.text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      categoryId = categoryIdMatch ? categoryIdMatch[0] : '';
    }

    // 3. Extraction du reportType (Enum) et documentName (Descriptive)
    let reportType = 'OTHER';
    let documentName = 'Unnamed Document';

    const reportTypeMatch = result.text.match(/REPORT_TYPE:\s*(.+)/i);
    if (reportTypeMatch && reportTypeMatch[1]) {
      reportType = reportTypeMatch[1].trim().toUpperCase();
    }

    const documentNameMatch = result.text.match(/DOCUMENT_NAME:\s*(.+)/i);
    if (documentNameMatch && documentNameMatch[1]) {
      documentName = documentNameMatch[1].trim();
    }

    // Fallbacks
    if (!categoryId) {
      console.warn('[Categorization] No category ID found. Using fallback.');
      categoryId = '00000000-0000-0000-0000-000000000000';
    }

    console.log(`[Workflow] Categorization result: categoryId=${categoryId}, reportType="${reportType}", documentName="${documentName}"`);

    return { fileId, userId, markdown, categoryId, reportType, documentName, storageName };
  }
});

const convertFormatsStep = createStep({
  id: 'convert-formats',
  inputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    markdown: z.string(),
    categoryId: z.string(),
    reportType: z.string(),
    documentName: z.string(),
    storageName: z.string(),
  }),
  outputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    docxBuffer: z.instanceof(Buffer),
    pdfProBuffer: z.instanceof(Buffer),
    markdownText: z.string(),
    categoryId: z.string(),
    reportType: z.string(),
    documentName: z.string(),
    storageName: z.string(),
  }),
  execute: async ({ inputData, requestContext }) => {
    const { fileId, userId, markdown, categoryId, reportType, documentName, storageName } = inputData;
    
    console.log(`[Workflow] Starting conversion for ${fileId} to docx and pdf...`);

    // On génère le DOCX via Pandoc
    console.log(`[Workflow] Generating DOCX...`);
    const docxResult: any = await pandocTool.execute!({ content: markdown, format: 'docx' }, { requestContext });
    
    // On génère le PDF pro via Pandoc
    console.log(`[Workflow] Generating PDF Pro...`);
    const pdfProResult: any = await pandocTool.execute!({ content: markdown, format: 'pdf' }, { requestContext });

    if (!docxResult.success || !pdfProResult.success) {
      console.error(`[Workflow] Conversion failed. DOCX success: ${docxResult.success}, PDF success: ${pdfProResult.success}`);
      throw new Error(`Failed to convert document formats: ${docxResult.error || pdfProResult.error || 'Unknown error'}`);
    }

    console.log(`[Workflow] Conversion successful for ${fileId}`);

    return { 
      fileId,
      userId,
      docxBuffer: docxResult.buffer, 
      pdfProBuffer: pdfProResult.buffer, 
      markdownText: markdown,
      categoryId,
      reportType,
      documentName,
      storageName
    };
  }
});

const uploadAndSyncStep = createStep({
  id: 'upload-and-sync',
  inputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    docxBuffer: z.instanceof(Buffer),
    pdfProBuffer: z.instanceof(Buffer),
    markdownText: z.string(),
    categoryId: z.string(),
    reportType: z.string(),
    documentName: z.string(),
    storageName: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    const { fileId, userId, docxBuffer, pdfProBuffer, markdownText, categoryId, reportType, documentName, storageName } = inputData;

    console.log(`[Workflow] Starting upload for ${fileId} (userId: ${userId}, storageName: ${storageName})...`);

    const wordKey = `${storageName}`;
    const pdfProKey = `${storageName}`;
    const mdKey = storageName;

    const wordPath = `${userId}/processed/${wordKey}.docx`;
    const pdfProPath = `${userId}/processed/${pdfProKey}.pdf`;
    const mdPath = `${userId}/processed/${mdKey}.md`;

    console.log(`[Workflow] Uploading files to bucket "documents": ${wordPath}, ${pdfProPath}, ${mdPath}...`);

    try {
      await Promise.all([
        supabaseAdmin.storage.from('documents').upload(wordPath, docxBuffer, { upsert: true }),
        supabaseAdmin.storage.from('documents').upload(pdfProPath, pdfProBuffer, { upsert: true }),
        supabaseAdmin.storage.from('documents').upload(mdPath, Buffer.from(markdownText), { upsert: true })
      ]);
      console.log(`[Workflow] Upload successful for ${fileId}`);
    } catch (err: any) {
      console.error(`[Workflow] Upload failed for ${fileId}:`, err);
      throw new Error(`Storage upload failed: ${err.message}`);
    }


    // 3. MISE À JOUR SQL (C'est ce que PowerSync va capter)
    console.log(`[Workflow] Updating database record for doc ${fileId} with format-specific storage IDs...`);
    const { error: updateError } = await supabaseAdmin
      .from('documents')
      .update({
        extracted_content: markdownText, // Le texte pour le offline immédiat
        file_url_word: wordKey, // ID sans extension (ex: original_word)
        file_url_pdf_pro: pdfProKey, // ID sans extension (ex: original_pro)
        file_url_markdown: mdKey, // ID sans extension (ex: original)
        status: 'completed', // Trigger le téléchargement sur Flutter
        ai_processed: true,
        category_id: categoryId,
        report_type: reportType, // One of the allowed enums (e.g. INVOICE)
        doc_number: documentName, // The descriptive title generated by AI
      })
      .eq('id', fileId);

    if (updateError) {
      console.error(`[Workflow] Final DB update failed: ${updateError.message}`);
      throw new Error(`Database update failed: ${updateError.message}`);
    }

    console.log(`[Workflow] Pipeline completed successfully for ${fileId}`);

    return { success: true };
  }
});

 const docProcessingWorkflow = createWorkflow({
  id: 'document-automation-pipeline',
  inputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  retryConfig: {
    attempts: 3,
    delay: 2000,
  },
  steps: [
    extractMarkdownStep,
    categorizeDocumentStep,
    convertFormatsStep,
    uploadAndSyncStep,
  ],
}).then(extractMarkdownStep)
.then(categorizeDocumentStep)
.then(convertFormatsStep)
.then(uploadAndSyncStep);

docProcessingWorkflow.commit();


export { docProcessingWorkflow };
