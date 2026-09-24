export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const link = document.createElement('a');
  link.style.display = 'none';
  document.body.appendChild(link);
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
