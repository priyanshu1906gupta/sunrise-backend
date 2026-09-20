import { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../utils/response";
import { requireUser } from "../middleware/auth";
import { idParamSchema } from "../validators/domain.validator";
import {
  extendSubscriptionSchema,
  subscriptionStatusSchema,
  superListQuerySchema,
} from "../validators/auth.validator";
import { requireSuperAdminKey } from "../lib/subscription";
import { subscriptionService } from "../services/subscription.service";

function superKey(req: Request, bodyKey?: string): string | undefined {
  const header = req.header("x-super-admin-key");
  const query = req.query.key;
  const fromQuery = typeof query === "string" ? query : undefined;
  return header || fromQuery || bodyKey;
}

export class SubscriptionController {
  async mine(req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(res, await subscriptionService.mine(requireUser(req)), "Subscription fetched");
    } catch (error) {
      next(error);
    }
  }

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = superListQuerySchema.parse(req.query);
      requireSuperAdminKey(query.key);
      sendSuccess(
        res,
        await subscriptionService.listAdmins({
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          ending: query.ending,
          sort: query.sort,
        }),
        "Subscriptions fetched",
      );
    } catch (error) {
      next(error);
    }
  }

  async extend(req: Request, res: Response, next: NextFunction) {
    try {
      const body = extendSubscriptionSchema.parse(req.body);
      requireSuperAdminKey(superKey(req, body.key));
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await subscriptionService.extend(id, body.months), "Subscription extended");
    } catch (error) {
      next(error);
    }
  }

  async setStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const body = subscriptionStatusSchema.parse(req.body);
      requireSuperAdminKey(superKey(req, body.key));
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await subscriptionService.setActive(id, body.active), "Account updated");
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      requireSuperAdminKey(superKey(req));
      const { id } = idParamSchema.parse(req.params);
      sendSuccess(res, await subscriptionService.resetAdminPassword(id), "Password reset");
    } catch (error) {
      next(error);
    }
  }
}
