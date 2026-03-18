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
      
      // 1. Check if category already exists (to avoid unique constraint violation)
      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('categories')
        .select()
        .eq('name', categoryName)
        .maybeSingle();

      if (fetchError) {
        console.error(`[CategoryTool] Error checking for existing category:`, fetchError);
      }

      if (existing) {
        console.log(`[CategoryTool] Category "${categoryName}" already exists with ID: ${existing.id}`);
        return { category: existing };
      }

      // 2. If not, create it
      const { data, error } = await supabaseAdmin
        .from('categories')
        .insert([{ name: categoryName }])
        .select()
        .single();

      if (error) {
        // Double check in case of race condition between select and insert
        if (error.code === '23505') { // PostgreSQL unique violation code
          const { data: existingAgain } = await supabaseAdmin
            .from('categories')
            .select()
            .eq('name', categoryName)
            .single();
          if (existingAgain) return { category: existingAgain };
        }
        throw new Error(`Failed to create category: ${error.message}`);
      }
      return { category: data };
    }

    throw new Error('Invalid action');
  },
});
