import { prisma } from "../lib/prisma";
import { AppError } from "../middleware/errorHandler";
import { TokenPayload } from "../lib/jwt";
import { hashPassword } from "../lib/password";
import { seedDefaultExpenses } from "./expense.service";
import { fileService } from "./file.service";

export class CompanyService {
  async getProfile(user: TokenPayload) {
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      include: { images: { orderBy: { sortOrder: "asc" } } },
    });
    if (!company) throw new AppError(404, "Company not found");
    const urls = await fileService.getUrls([
      company.logoFileId,
      ...company.images.map((i) => i.fileId),
    ]);
    const trialEndsAt = company.subscriptionEndAt;
    return {
      ...company,
      logoUrl: urls.get(company.logoFileId ?? "") ?? null,
      images: company.images.map((i) => ({
        id: i.id,
        fileId: i.fileId,
        url: urls.get(i.fileId) ?? null,
      })),
      trialEndsAt,
    };
  }

  async updateProfile(
    user: TokenPayload,
    data: {
      name?: string;
      ownerName?: string;
      email?: string;
      phone?: string;
      bio?: string | null;
      logoFileId?: string | null;
      imageFileIds?: string[];
    },
  ) {
    if (user.role !== "ADMIN") {
      throw new AppError(403, "Only admin can update company profile");
    }
    const existing = await prisma.company.findUnique({
      where: { id: user.companyId },
      include: { images: true },
    });
    if (!existing) throw new AppError(404, "Company not found");
    const { imageFileIds, ...rest } = data;
    await prisma.company.update({
      where: { id: user.companyId },
      data: rest,
    });
    if (imageFileIds) {
      await prisma.companyImage.deleteMany({ where: { companyId: user.companyId } });
      if (imageFileIds.length) {
        await prisma.companyImage.createMany({
          data: imageFileIds.slice(0, 3).map((fileId, sortOrder) => ({
            companyId: user.companyId,
            fileId,
            sortOrder,
          })),
        });
      }
    }
    await fileService.replace(
      user,
      existing.logoFileId,
      data.logoFileId !== undefined ? data.logoFileId : existing.logoFileId,
    );
    if (imageFileIds) {
      await fileService.replaceMany(
        user,
        existing.images.map((i) => i.fileId),
        imageFileIds,
      );
    }
    return this.getProfile(user);
  }
}

export class BranchService {
  async list(user: TokenPayload) {
    const where =
      user.role === "MANAGER"
        ? { companyId: user.companyId, id: user.branchId ?? "" }
        : { companyId: user.companyId };
    const branches = await prisma.branch.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: { manager: true, photos: { orderBy: { sortOrder: "asc" } } },
    });
    return Promise.all(branches.map((b) => this.toDto(b)));
  }

  async get(user: TokenPayload, id: string) {
    const branch = await prisma.branch.findUnique({
      where: { id },
      include: { manager: true, photos: { orderBy: { sortOrder: "asc" } } },
    });
    if (!branch || branch.companyId !== user.companyId) {
      throw new AppError(404, "Branch not found");
    }
    if (user.role === "MANAGER" && user.branchId !== id) {
      throw new AppError(403, "You can only access your assigned branch");
    }
    return this.toDto(branch);
  }

  async create(
    user: TokenPayload,
    data: {
      name: string;
      ownerName: string;
      address?: string | null;
      phone?: string | null;
      details?: string | null;
      logoFileId?: string | null;
      photoFileIds?: string[];
      manager?: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        password: string;
      };
    },
  ) {
    if (user.role !== "ADMIN") {
      throw new AppError(403, "Only admin can add branches");
    }
    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    if (!company) throw new AppError(404, "Company not found");
    const count = await prisma.branch.count({ where: { companyId: user.companyId } });
    if (count >= company.maxBranches) {
      throw new AppError(400, `You can add at most ${company.maxBranches} branches`);
    }

    if (data.manager) {
      const exists = await prisma.user.findUnique({ where: { email: data.manager.email } });
      if (exists) throw new AppError(409, "Manager email already exists");
    }

    const branch = await prisma.$transaction(async (tx) => {
      const created = await tx.branch.create({
        data: {
          companyId: user.companyId,
          name: data.name,
          ownerName: data.ownerName,
          address: data.address,
          phone: data.phone,
          details: data.details,
          logoFileId: data.logoFileId,
        },
      });

      if (data.photoFileIds?.length) {
        await tx.branchPhoto.createMany({
          data: data.photoFileIds.slice(0, 3).map((fileId, sortOrder) => ({
            branchId: created.id,
            fileId,
            sortOrder,
          })),
        });
      }

      if (data.manager) {
        const managerUser = await tx.user.create({
          data: {
            email: data.manager.email,
            passwordHash: await hashPassword(data.manager.password),
            firstName: data.manager.firstName,
            lastName: data.manager.lastName,
            phone: data.manager.phone,
            role: "MANAGER",
            companyId: user.companyId,
            branchId: created.id,
          },
        });
        await tx.branch.update({
          where: { id: created.id },
          data: { managerId: managerUser.id },
        });
        await tx.employee.create({
          data: {
            branchId: created.id,
            userId: managerUser.id,
            fullName: `${data.manager.firstName} ${data.manager.lastName}`,
            gender: "MALE",
            role: "MANAGER",
            salary: 0,
            salaryDate: new Date(),
            joiningDate: new Date(),
            email: data.manager.email,
            phone: data.manager.phone,
          },
        });
      }

      return created;
    });

    await seedDefaultExpenses(branch.id);
    return this.get(user, branch.id);
  }

  async update(
    user: TokenPayload,
    id: string,
    data: Partial<{
      name: string;
      ownerName: string;
      address: string | null;
      phone: string | null;
      details: string | null;
      logoFileId: string | null;
      photoFileIds: string[];
      manager: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        password: string;
      };
    }>,
  ) {
    if (user.role !== "ADMIN") {
      throw new AppError(403, "Only admin can edit branches");
    }
    await this.get(user, id);
    const existing = await prisma.branch.findUnique({
      where: { id },
      include: { photos: true },
    });
    if (!existing) throw new AppError(404, "Branch not found");
    const { photoFileIds, manager, ...rest } = data;
    await prisma.branch.update({ where: { id }, data: rest });
    if (photoFileIds) {
      await prisma.branchPhoto.deleteMany({ where: { branchId: id } });
      if (photoFileIds.length) {
        await prisma.branchPhoto.createMany({
          data: photoFileIds.slice(0, 3).map((fileId, sortOrder) => ({
            branchId: id,
            fileId,
            sortOrder,
          })),
        });
      }
    }
    await fileService.replace(
      user,
      existing.logoFileId,
      rest.logoFileId !== undefined ? rest.logoFileId : existing.logoFileId,
    );
    if (photoFileIds) {
      await fileService.replaceMany(
        user,
        existing.photos.map((p) => p.fileId),
        photoFileIds,
      );
    }
    if (manager) {
      const exists = await prisma.user.findUnique({ where: { email: manager.email } });
      const branch = await prisma.branch.findUnique({ where: { id } });
      if (exists && exists.id !== branch?.managerId) {
        throw new AppError(409, "Manager email already exists");
      }
      if (branch?.managerId) {
        await prisma.user.update({
          where: { id: branch.managerId },
          data: {
            firstName: manager.firstName,
            lastName: manager.lastName,
            email: manager.email,
            phone: manager.phone,
            ...(manager.password ? { passwordHash: await hashPassword(manager.password) } : {}),
          },
        });
      }
    }
    return this.get(user, id);
  }

  private async toDto(branch: {
    id: string;
    companyId: string;
    name: string;
    ownerName: string;
    managerId: string | null;
    address: string | null;
    phone: string | null;
    details: string | null;
    logoFileId: string | null;
    createdAt: Date;
    updatedAt: Date;
    manager: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null } | null;
    photos: { id: string; fileId: string }[];
  }) {
    const urls = await fileService.getUrls([branch.logoFileId, ...branch.photos.map((p) => p.fileId)]);
    return {
      id: branch.id,
      companyId: branch.companyId,
      name: branch.name,
      ownerName: branch.ownerName,
      managerId: branch.managerId,
      address: branch.address,
      phone: branch.phone,
      details: branch.details,
      logoFileId: branch.logoFileId,
      logoUrl: urls.get(branch.logoFileId ?? "") ?? null,
      manager: branch.manager
        ? {
            id: branch.manager.id,
            firstName: branch.manager.firstName,
            lastName: branch.manager.lastName,
            email: branch.manager.email,
            phone: branch.manager.phone,
          }
        : null,
      photos: branch.photos.map((p) => ({
        id: p.id,
        fileId: p.fileId,
        url: urls.get(p.fileId) ?? null,
      })),
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
    };
  }
}

export const companyService = new CompanyService();
export const branchService = new BranchService();

