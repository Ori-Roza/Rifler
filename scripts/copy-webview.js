const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'out', 'webview');
const srcWebview = path.join(__dirname, '..', 'src', 'webview');
const assetsDir = path.join(__dirname, '..', 'assets', 'fonts');
const codiconsDir = path.join(__dirname, '..', 'node_modules', '@vscode', 'codicons', 'dist');

// Create out/webview directory if it doesn't exist
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Copy webview files
const webviewFiles = [
  'index.html',
  'script.js',
  'styles.css',
  'seti-icons.css',
  'seti.woff'
];

webviewFiles.forEach(file => {
  const src = path.join(srcWebview, file);
  const dest = path.join(outDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file}`);
  }
});

// Copy font files
if (fs.existsSync(assetsDir)) {
  const fontFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.woff2'));
  fontFiles.forEach(file => {
    const src = path.join(assetsDir, file);
    const dest = path.join(outDir, file);
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file}`);
  });
}

// Copy codicons
const codiconFiles = ['codicon.css', 'codicon.ttf'];
codiconFiles.forEach(file => {
  const src = path.join(codiconsDir, file);
  const dest = path.join(outDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${file}`);
  }
});

console.log('Webview assets copied successfully');
