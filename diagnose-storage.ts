import { supabaseAdmin } from './src/lib/supabase.js';

const userId = 'b7ac0dd2-ce20-467b-a825-6f4b470e049a';
const docId = 'e05fef5b-195a-4458-a5eb-e4549de9b5bf';

async function diagnose() {
  console.log(`Diagnosing storage for user ${userId}, doc ${docId}...`);
  
  // 1. List files in user's root
  const { data: rootFiles, error: rootError } = await supabaseAdmin.storage
    .from('documents')
    .list(userId);
    
  if (rootError) {
    console.error('Error listing user files:', rootError);
  } else {
    console.log(`Files in ${userId}/:`, rootFiles.map(f => f.name));
  }

  // 2. List files in root of bucket
  const { data: bucketRoot, error: bucketError } = await supabaseAdmin.storage
    .from('documents')
    .list('');
    
  if (bucketError) {
    console.error('Error listing bucket root:', bucketError);
  } else {
    console.log('Files in bucket root:', bucketRoot.map(f => f.name));
  }
  
  // 3. Check database record
  const { data: doc, error: docError } = await supabaseAdmin
    .from('documents')
    .select('*')
    .eq('id', docId)
    .single();
    
  if (docError) {
    console.error('Error fetching doc record:', docError);
  } else {
    console.log('Document record:', doc);
  }
}

diagnose();
