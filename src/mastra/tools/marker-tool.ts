import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';
import FormData from 'form-data';

export const markerTool = createTool({
  id: 'marker-datalab',
  description: 'Extracts high-fidelity Markdown from a PDF using Datalab Marker API. Resilient to standard OCR noise.',
  inputSchema: z.object({
    fileUrl: z.string().url().describe('The securely signed URL of the PDF in Supabase Storage'),
  }),
  execute: async ({ fileUrl }) => {

    try {
      // 1. Télécharger le PDF en binaire depuis l'URL signée Supabase
      console.log(`[MarkerTool] Downloading PDF from: ${fileUrl.substring(0, 100)}...`);
      const pdfResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const pdfBuffer = Buffer.from(pdfResponse.data);
      console.log(`[MarkerTool] Downloaded PDF size: ${pdfBuffer.length} bytes`);

      // 2. Construire le multipart/form-data attendu par l'API Marker
      const form = new FormData();
      form.append('file', pdfBuffer, {
        filename: 'document.pdf',
        contentType: 'application/pdf',
      });
      form.append('langs', 'fr,en');
      form.append('force_ocr', 'false');
      form.append('paginate', 'false');

      // 3. Envoyer à Datalab Marker (Async)
      console.log(`[MarkerTool] Sending to Datalab API...`);
      const response = await axios.post(
        'https://www.datalab.to/api/v1/marker',
        form,
        {
          headers: {
            'X-Api-Key': process.env.DATALAB_MARKER_API,
            ...form.getHeaders(),
          },
        }
      );
      
      const requestId = response.data.request_id;
      const checkUrl = response.data.request_check_url;

      if (!checkUrl) {
          throw new Error('Datalab API did not return a check_url');
      }

      console.log(`[MarkerTool] Job started: ${requestId}. Polling for results...`);

      // 4. Polling
      let markdown = "";
      let status = "pending";
      let attempts = 0;
      const maxAttempts = 30; // 30 * 2s = 60s timeout

      while (attempts < maxAttempts) {
          const checkResponse = await axios.get(checkUrl, {
              headers: { 'X-Api-Key': process.env.DATALAB_MARKER_API }
          });

          const data = checkResponse.data;
          console.log(`[MarkerTool] Polling status: ${data.status || 'unknown'}`);

          if (data.status === 'complete' || data.markdown) {
              markdown = data.markdown || "";
              break;
          }

          if (data.status === 'error') {
              throw new Error(`Datalab processing error: ${data.error || 'Unknown error'}`);
          }

          attempts++;
          await new Promise(resolve => setTimeout(resolve, 2000)); // Attendre 2 secondes
      }

      if (!markdown && attempts >= maxAttempts) {
          throw new Error('Timeout waiting for Datalab Marker processing');
      }

      return { 
        success: true,
        markdown: markdown,
      };
    } catch (error: any) {
      console.error("[MarkerTool Error]:", error.response?.data || error.message);
      return { success: false, markdown: "", error: error.message };
    }
  },
});