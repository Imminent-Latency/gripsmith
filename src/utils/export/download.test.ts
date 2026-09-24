import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText } from './download';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('downloadText', () => {
  it('downloads the text Blob through an anchor and revokes its URL', async () => {
    const link = { href: '', download: '', style: { display: '' }, click: vi.fn() } as unknown as HTMLAnchorElement;
    vi.spyOn(document, 'createElement').mockReturnValue(link);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => link);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => link);
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    downloadText('outline.svg', 'image/svg+xml', '<svg/>');

    expect(document.createElement).toHaveBeenCalledWith('a');
    expect(link.download).toBe('outline.svg');
    expect(link.href).toBe('blob:mock-url');
    expect(link.click).toHaveBeenCalledOnce();
    expect(document.body.appendChild).toHaveBeenCalledWith(link);
    expect(document.body.removeChild).toHaveBeenCalledWith(link);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/svg+xml');
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob);
    });
    expect(text).toBe('<svg/>');
  });
});
