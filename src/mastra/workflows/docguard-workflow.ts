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
    return { fileId, userId, markdown: result.markdown };
  }
});

const categorizeDocumentStep = createStep({
  id: 'categorize-document',
  inputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    markdown: z.string(),
  }),
  outputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    markdown: z.string(),
    categoryId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { fileId, userId, markdown } = inputData;

    // Sauvegarde de quota : Si le markdown est vide ou trop court, on ne sollicite pas l'IA
    if (!markdown || markdown.trim().length < 10) {
      console.warn(`[Workflow] Document ${fileId} has insufficient content for categorization. Using fallback.`);
      
      // On peut soit lever une erreur, soit assigner une catégorie par défaut "Uncategorized"
      // Pour éviter de bloquer le workflow, cherchons une catégorie par défaut ou retournons vide
      return { fileId, userId, markdown, categoryId: '00000000-0000-0000-0000-000000000000' }; 
    }

    const result = await categorizationAgent.generate(
      `Categorize this document: ${markdown.substring(0, 2000)}`
    );

    // Extraction robuste : on regarde d'abord les résultats des outils
    let categoryId = '';
    
    // On cherche le résultat de l'outil 'category-manager'
    const toolResults = result.toolResults as any[];
    const categoryToolResult = toolResults?.find(r => r.toolName === 'category-manager');
    
    if (categoryToolResult?.result) {
      if (categoryToolResult.result.category?.id) {
        categoryId = categoryToolResult.result.category.id; // Cas 'create'
      }
    }

    // Fallback : recherche par Regex dans le texte final de l'agent
    if (!categoryId) {
      const categoryIdMatch = result.text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      categoryId = categoryIdMatch ? categoryIdMatch[0] : '';
    }

    if (!categoryId) {
      console.warn('[Categorization] No category ID found in agent response or tool results. Using fallback.');
      categoryId = '00000000-0000-0000-0000-000000000000'; // Fallback Uncategorized
    }

    return { fileId, userId, markdown, categoryId };
  }
});

const convertFormatsStep = createStep({
  id: 'convert-formats',
  inputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    markdown: z.string(),
    categoryId: z.string(),
  }),
  outputSchema: z.object({
    fileId: z.string(),
    userId: z.string(),
    docxBuffer: z.instanceof(Buffer),
    pdfProBuffer: z.instanceof(Buffer),
    markdownText: z.string(),
    categoryId: z.string(),
  }),
  execute: async ({ inputData, requestContext }) => {
    const { fileId, userId, markdown, categoryId } = inputData;
    
    // On génère le DOCX et le PDF pro via Pandoc
    const docxResult: any = await pandocTool.execute!({ content: markdown, format: 'docx' }, { requestContext });
    const pdfProResult: any = await pandocTool.execute!({ content: markdown, format: 'pdf' }, { requestContext });

    if (!docxResult.success || !pdfProResult.success) {
      throw new Error('Failed to convert document formats');
    }

    return { 
      fileId,
      userId,
      docxBuffer: docxResult.buffer, 
      pdfProBuffer: pdfProResult.buffer, 
      markdownText: markdown,
      categoryId
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
  }),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    const { fileId, userId, docxBuffer, pdfProBuffer, markdownText, categoryId } = inputData;

    // 1. Upload des nouveaux fichiers vers Supabase Storage
    const wordPath = `${userId}/processed/${fileId}.docx`;
    const pdfProPath = `${userId}/processed/${fileId}_pro.pdf`;
    const mdPath = `${userId}/processed/${fileId}.md`;

    await Promise.all([
      supabaseAdmin.storage.from('documents').upload(wordPath, docxBuffer),
      supabaseAdmin.storage.from('documents').upload(pdfProPath, pdfProBuffer),
      supabaseAdmin.storage.from('documents').upload(mdPath, Buffer.from(markdownText))
    ]);

    // 2. Récupérer les URLs publiques
    const getUrl = (path: string) => supabaseAdmin.storage.from('documents').getPublicUrl(path).data.publicUrl;

    // 3. MISE À JOUR SQL (C'est ce que PowerSync va capter)
    await supabaseAdmin
      .from('documents')
      .update({
        content_markdown: markdownText, // Le texte pour le offline immédiat
        file_url_word: getUrl(wordPath),
        file_url_pdf_pro: getUrl(pdfProPath),
        file_url_md: getUrl(mdPath),
        status: 'completed', // Trigger le téléchargement sur Flutter
        ai_processed: true,
        category_id: categoryId,
      })
      .eq('id', fileId);

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
