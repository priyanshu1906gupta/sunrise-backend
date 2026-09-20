import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { absoluteUploadPath, ensureCompanyDir, fileUrl } from "../lib/files";
import { TokenPayload } from "../lib/jwt";

const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png"]);

export class FileService {
  async upload(user: TokenPayload, file: Express.Multer.File, publicBase?: string) {
    const mime = (file.mimetype === "image/jpg" ? "image/jpeg" : file.mimetype || "").toLowerCase();
    const tryDecode =
      ALLOWED.has(mime) ||
      mime === "image/heic" ||
      mime === "image/heif" ||
      mime === "image/webp" ||
      mime === "application/octet-stream" ||
      mime === "";
    if (!tryDecode) {
      throw new AppError(400, "Only jpeg, jpg and png files are allowed");
    }

    let compressed: { buffer: Buffer; mimeType: "image/jpeg"; ext: ".jpg" };
    const { compressImage, MAX_IMAGE_BYTES } = await import("../lib/compress");
    try {
      compressed = await compressImage(file.buffer);
    } catch {
      throw new AppError(400, "Could not read this image. Please upload a jpeg or png.");
    }
    if (compressed.buffer.length > MAX_IMAGE_BYTES) {
      throw new AppError(400, "Image could not be compressed under 100KB. Try a simpler photo.");
    }

    let dir: string;
    try {
      dir = ensureCompanyDir(user.companyId);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : "";
      if (code === "ENOENT" || code === "EACCES") {
        throw new AppError(500, "Could not save the photo on the server. Upload storage is not writable.");
      }
      throw error;
    }
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${compressed.ext}`;
    const relativePath = `${user.companyId}/${filename}`;
    fs.writeFileSync(path.join(dir, filename), compressed.buffer);

    const created = await prisma.file.create({
      data: {
        companyId: user.companyId,
        relativePath,
        originalName: file.originalname,
        mimeType: compressed.mimeType,
      },
    });

    return this.toDto(created, publicBase);
  }

  async remove(user: TokenPayload, id: string) {
    const file = await prisma.file.findUnique({ where: { id } });
    if (!file || file.companyId !== user.companyId) {
      throw new AppError(404, "File not found");
    }
    const abs = absoluteUploadPath(file.relativePath);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
    await prisma.file.delete({ where: { id } });
    return null;
  }

  async replace(user: TokenPayload, oldId: string | null | undefined, nextId: string | null | undefined): Promise<void> {
    if (!oldId || oldId === nextId || nextId === undefined) return;
    await this.removeIfUnused(user, oldId);
  }

  async replaceMany(user: TokenPayload, oldIds: string[], nextIds: string[]): Promise<void> {
    const keep = new Set(nextIds.filter(Boolean));
    for (const id of oldIds) {
      if (id && !keep.has(id)) {
        await this.removeIfUnused(user, id);
      }
    }
  }

  async removeIfUnused(user: TokenPayload, fileId: string | null | undefined): Promise<void> {
    if (!fileId) return;
    if (await this.isReferenced(fileId)) return;
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.companyId !== user.companyId) return;
    const abs = absoluteUploadPath(file.relativePath);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
    }
    await prisma.file.delete({ where: { id: fileId } });
  }

  private async isReferenced(fileId: string): Promise<boolean> {
    const [students, employees, companies, companyImages, branches, branchPhotos] = await Promise.all([
      prisma.student.count({ where: { photoFileId: fileId, deletedAt: null } }),
      prisma.employee.count({
        where: { deletedAt: null, OR: [{ photoFileId: fileId }, { aadhaarFileId: fileId }] },
      }),
      prisma.company.count({ where: { logoFileId: fileId } }),
      prisma.companyImage.count({ where: { fileId } }),
      prisma.branch.count({ where: { logoFileId: fileId } }),
      prisma.branchPhoto.count({ where: { fileId } }),
    ]);
    return students + employees + companies + companyImages + branches + branchPhotos > 0;
  }

  /** Resolve a public URL for a stored file id. */

  async getUrl(fileId: string | null | undefined): Promise<string | null> {
    if (!fileId) return null;
    const file = await prisma.file.findUnique({ where: { id: fileId } });
    return file ? fileUrl(file.relativePath) : null;
  }

  async getUrls(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return new Map();
    const files = await prisma.file.findMany({ where: { id: { in: unique } } });
    return new Map(files.map((f) => [f.id, fileUrl(f.relativePath)]));
  }

  toDto(file: { id: string; relativePath: string; originalName: string; mimeType: string }, publicBase?: string) {
    return {
      id: file.id,
      url: fileUrl(file.relativePath, publicBase),
      originalName: file.originalName,
      mimeType: file.mimeType,
    };
  }
}

export const fileService = new FileService();
