import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { registerApiRoute } from '@mastra/core/server';
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { docProcessingWorkflow } from './workflows/docguard-workflow';
import { weatherAgent } from './agents/weather-agent';
import { categorizationAgent } from './agents/categorization-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';

export const mastra = new Mastra({
  workflows: { weatherWorkflow, docProcessingWorkflow },
  agents: { weatherAgent, categorizationAgent },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  server: {
    port: Number(process.env.PORT) || 3000,
    host: '0.0.0.0',
    apiRoutes: [
      registerApiRoute('/webhooks/supabase', {
        method: 'POST',
        requiresAuth: false,
        handler: async (c) => {
          try {
            const apiKey = c.req.header('x-api-key');
            if (apiKey !== process.env.MASTRA_WEBHOOK_SECRET) {
              console.warn(`[Webhook] Unauthorized access attempt with API key: ${apiKey}`);
              return c.text('Unauthorized', 401);
            }

            const body = await c.req.json();
            
            // Supabase Webhook sends data in 'record'
            const record = body.record; 
            const docId = record?.id;
            const userId = record?.user_id;

            if (!docId || !userId) {
              return c.text('Missing IDs', 400);
            }

            console.log(`[Webhook] Received update for doc ${docId} (user ${userId})`);

            const mastraInstance = c.get('mastra');
            const workflow = mastraInstance.getWorkflow('docProcessingWorkflow');

            // Launch workflow in background
            workflow.createRun()
              .then(run => run.startAsync({
                inputData: {
                  fileId: docId,
                  userId: userId,
                }
              }))
              .catch(err => console.error("[Webhook] Workflow Error:", err));

            return c.json({ message: 'Workflow started' });
          } catch (error: any) {
            console.error("[Webhook] Handler Error:", error.message);
            return c.text(error.message, 500);
          }
        },
      }),
    ],
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    // stores observability, scores, ... into persistent file storage
    url: "file:./mastra.db",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(), // Persists traces to storage for Mastra Studio
          new CloudExporter(), // Sends traces to Mastra Cloud (if MASTRA_CLOUD_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});