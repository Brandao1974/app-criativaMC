import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir(new URL('../js/vendor/',import.meta.url),{recursive:true});
await build({ stdin:{contents:"export { createClient } from '@supabase/supabase-js';",resolveDir:process.cwd()},
  outfile:'js/vendor/supabase.js',bundle:true,format:'esm',platform:'browser',minify:true,legalComments:'eof' });
await build({ stdin:{contents:"export { default as Chart } from 'chart.js/auto';",resolveDir:process.cwd()},
  outfile:'js/vendor/chart.js',bundle:true,format:'esm',platform:'browser',minify:true,legalComments:'eof' });
