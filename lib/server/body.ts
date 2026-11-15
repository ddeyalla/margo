/**
 * The request body, or null once it runs past `max` bytes. It stops reading there, so an oversized
 * upload is never held in memory; Content-Length alone can't be trusted, since a chunked body has none.
 */
export const readCapped = async (request: Request, max: number): Promise<Uint8Array | null> => {
  if (Number(request.headers.get("content-length")) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
};
