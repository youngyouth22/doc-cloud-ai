import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execPromise = promisify(exec);

export const pandocTool = createTool({
  id: 'pandoc-converter',
  description: 'Converts raw Markdown text into enterprise-grade DOCX or PDF files.',
  inputSchema: z.object({
    content: z.string().describe('The raw Markdown content to convert'),
    format: z.enum(['docx', 'pdf']).describe('The target output format'),
  }),
  execute: async ({ content, format }) => {
    const timestamp = Date.now();
    const tempMdPath = path.join('/tmp', `input_${timestamp}.md`);
    const outputPath = path.join('/tmp', `output_${timestamp}.${format}`);

    try {
      await fs.writeFile(tempMdPath, content);

      // Astuce design : Tu pourras ajouter '--reference-doc=template.docx'
      // Render.com compatible command using WeasyPrint for PDF generation
      const pdfEngine = format === 'pdf' ? '--pdf-engine=weasyprint' : '';
      const command = `pandoc ${tempMdPath} -o ${outputPath} ${pdfEngine}`;
      await execPromise(command);

      const fileBuffer = await fs.readFile(outputPath);

      // Nettoyage des fichiers temporaires pour ne pas saturer ton serveur
      await Promise.all([fs.unlink(tempMdPath), fs.unlink(outputPath)]);

      return { success: true, buffer: fileBuffer }; 
    } catch (error: any) {
      console.error(`[PandocTool Error - ${format}]:`, error.message);
      return { success: false, buffer: null, error: error.message };
    }
  },
});