import { Agent } from '@mastra/core/agent';
import { categoryTool } from '../tools/category-tool';

export const categorizationAgent = new Agent({
  id: 'categorization-agent',
  name: 'Categorization Agent',
  instructions: `
    You are a document categorization expert. Your task is to analyze the provided Markdown content and assign it to the most relevant category from a list of existing categories.
    
    1. First, use the categoryTool with action 'list' to get all existing categories.
    2. Analyze the document content and determine which category fits best.
    3. If a highly relevant category exists, return its ID and Name.
    4. If NO existing category matches the document content well, use the categoryTool with action 'create' to create a new, concise category name (in English only, e.g., "Invoices", "Technical Manuals", "Legal Contracts") and return its new ID and Name.
    5. Always return the category ID and Name in your final response.
  `,
  model: 'google/gemini-1.5-flash',
  tools: { categoryTool },
});
