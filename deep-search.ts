import { supabaseAdmin } from './src/lib/supabase.js';

const targetFile = '53572c47-6fc8-4709-b627-f9a880573b7b'; // The one from the latest failure

async function deepSearch() {
  console.log(`Deep searching for ${targetFile} in bucket "documents"...`);
  
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  console.log('Buckets:', buckets?.map(b => b.name));

  async function scan(path = '') {
    const { data: files, error } = await supabaseAdmin.storage.from('documents').list(path);
    if (error) {
      console.error(`Error listing ${path}:`, error);
      return;
    }

    for (const file of files || []) {
      const fullPath = path ? `${path}/${file.name}` : file.name;
      if (file.id) { // It's a file
         if (file.name.includes(targetFile)) {
           console.log('FOUND IT!', fullPath);
         }
      } else { // It's a folder (or no ID)
         await scan(fullPath);
      }
    }
  }

  await scan();
  console.log('Search complete.');
}

deepSearch();
