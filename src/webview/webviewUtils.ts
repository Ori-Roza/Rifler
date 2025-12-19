import * as vscode from 'vscode';

// Cache for webview HTML template
let cachedBodyHtml: string | null = null;

// Webview HTML assembly
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  if (!cachedBodyHtml) {
    throw new Error('Webview HTML template not loaded. Call loadWebviewTemplate() during activation.');
  }
  
  const nonce = getNonce();
  const stylesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'styles.css')
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'script.js')
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- TODO: Consider bundling highlight.js locally or add SRI -->
  <link href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" rel="stylesheet" crossorigin="anonymous">
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
${cachedBodyHtml}
<!-- TODO: Add integrity attribute with SRI hash or bundle locally -->
<script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" crossorigin="anonymous"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

// Load and cache the webview HTML template
export async function loadWebviewTemplate(extensionUri: vscode.Uri): Promise<void> {
  try {
    const indexUri = vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'index.html');
    const content = await vscode.workspace.fs.readFile(indexUri);
    cachedBodyHtml = new TextDecoder('utf-8').decode(content);
  } catch (error) {
    console.error('Failed to load webview template:', error);
    // Provide a minimal fallback template
    cachedBodyHtml = '<div id="root"></div>';
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
