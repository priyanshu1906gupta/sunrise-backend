import sharp from "sharp";

export const MAX_IMAGE_BYTES = 100 * 1024;
const START_WIDTH = 1280;

async function encodeJpeg(input: Buffer, width: number, quality: number): Promise<Buffer> {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width,
      height: width,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: "4:2:0",
    })
    .toBuffer();
}

/** Compress any supported image to JPEG at or under 100KB. */
export async function compressImage(input: Buffer): Promise<{
  buffer: Buffer;
  mimeType: "image/jpeg";
  ext: ".jpg";
}> {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Invalid image");
  }

  let width = Math.min(meta.width, START_WIDTH);
  let quality = 82;
  let out = await encodeJpeg(input, width, quality);

  while (out.length > MAX_IMAGE_BYTES && quality > 42) {
    quality -= 8;
    out = await encodeJpeg(input, width, quality);
  }

  while (out.length > MAX_IMAGE_BYTES && width > 360) {
    width = Math.max(360, Math.round(width * 0.75));
    out = await encodeJpeg(input, width, quality);
  }

  if (out.length > MAX_IMAGE_BYTES) {
    out = await encodeJpeg(input, 320, 35);
  }

  return { buffer: out, mimeType: "image/jpeg", ext: ".jpg" };
}
