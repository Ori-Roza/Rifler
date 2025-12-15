import * as vscode from 'vscode';

// Assemble webview HTML using external resources extracted to src/webview/
function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'styles.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'script.js'));
  
  // Body HTML would be loaded here in actual implementation
  const bodyHtml = '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" rel="stylesheet">
  <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
${bodyHtml}
<script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function activate(context: vscode.ExtensionContext): void {
  context.globalState.get('rifler.persistedSearchState');

  context.subscriptions.push(
    vscode.commands.registerCommand('rifler.open', () => true),
    vscode.commands.registerCommand('rifler.openReplace', () => true),
    vscode.commands.registerCommand('rifler.openSidebar', () => true),
    vscode.commands.registerCommand('rifler.toggleView', () => true),
    vscode.commands.registerCommand('rifler.minimize', () => true),
    vscode.commands.registerCommand('rifler.restore', () => true)
  );
}

export function deactivate(): void {}

export { getWebviewHtml };
