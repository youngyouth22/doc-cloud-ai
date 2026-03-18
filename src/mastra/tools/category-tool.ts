import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase';

export const categoryTool = createTool({
  id: 'category-manager',
  description: 'Manages document categories in Supabase. Can fetch all categories or create a new one.',
  inputSchema: z.object({
    action: z.enum(['list', 'create']),
    categoryName: z.string().optional().describe('Name of the category to create (English only)'),
  }),
  execute: async ({ action, categoryName }) => {
    if (action === 'list') {
      const { data, error } = await supabaseAdmin
        .from('categories')
        .select('id, name');

      if (error) throw new Error(`Failed to fetch categories: ${error.message}`);
      return { categories: data };
    }

    if (action === 'create') {
      if (!categoryName) throw new Error('categoryName is required for create action');
      
      const { data, error } = await supabaseAdmin
        .from('categories')
        .insert([{ name: categoryName }])
        .select()
        .single();

      if (error) throw new Error(`Failed to create category: ${error.message}`);
      return { category: data };
    }

    throw new Error('Invalid action');
  },
});
