const fs = require('fs');
const path = require('path');

const EXCLUDED_DIRS = new Set(['node_modules', '.next', 'out', 'build', '.git', 'coverage', '.gemini', 'brain']);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.prisma', '.md', '.sql']);

let statsByExt = {};
let totalFiles = 0;
let totalLines = 0;

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        walkDir(fullPath);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXTENSIONS.has(ext)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n').length;
          if (!statsByExt[ext]) {
            statsByExt[ext] = { files: 0, lines: 0 };
          }
          statsByExt[ext].files += 1;
          statsByExt[ext].lines += lines;
          totalFiles += 1;
          totalLines += lines;
        } catch (e) {}
      }
    }
  }
}

console.log('📊 Counting Lines of Code in artyx-office...\n');
walkDir(process.cwd());

console.log('-----------------------------------------------');
console.log(' Extension    Files       Lines of Code');
console.log('-----------------------------------------------');
const sorted = Object.entries(statsByExt).sort((a, b) => b[1].lines - a[1].lines);
for (const [ext, stat] of sorted) {
  const extName = ext.padEnd(12, ' ');
  const filesStr = String(stat.files).padStart(8, ' ');
  const linesStr = String(stat.lines.toLocaleString()).padStart(16, ' ');
  console.log(` ${extName} ${filesStr} ${linesStr}`);
}
console.log('-----------------------------------------------');
console.log(` TOTAL        ${String(totalFiles).padStart(8, ' ')} ${String(totalLines.toLocaleString()).padStart(16, ' ')}`);
console.log('-----------------------------------------------\n');
