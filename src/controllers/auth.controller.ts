import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { sendCreated, sendSuccess } from "../utils/response";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
  refreshSchema,
  logoutSchema,
  changePasswordSchema,
} from "../validators/auth.validator";
import { requireUser } from "../middleware/auth";
import { env } from "../config/env";

const authService = new AuthService();

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const data = registerSchema.parse(req.body);
      sendCreated(res, await authService.register(data), "Registered successfully");
    } catch (error) {
      next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const data = loginSchema.parse(req.body);
      sendSuccess(res, await authService.login(data), "Logged in successfully");
    } catch (error) {
      next(error);
    }
  }

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      sendSuccess(res, await authService.me(user.id), "Profile fetched");
    } catch (error) {
      next(error);
    }
  }

  async config(_req: Request, res: Response, next: NextFunction) {
    try {
      sendSuccess(
        res,
        {
          googleClientId: null,
          idleTimeoutMs: env.IDLE_TIMEOUT_MS,
          courses: await authService.publicCourses(),
        },
        "Auth config",
      );
    } catch (error) {
      next(error);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      sendSuccess(res, await authService.forgotPassword(email), "If the email exists, an OTP was sent");
    } catch (error) {
      next(error);
    }
  }

  async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, otp } = verifyOtpSchema.parse(req.body);
      sendSuccess(res, await authService.verifyOtp(email, otp), "OTP verified");
    } catch (error) {
      next(error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, otp, password } = resetPasswordSchema.parse(req.body);
      sendSuccess(res, await authService.resetPassword(email, otp, password), "Password reset successfully");
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = refreshSchema.parse(req.body);
      sendSuccess(res, await authService.refresh(refreshToken), "Token refreshed");
    } catch (error) {
      next(error);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = logoutSchema.parse(req.body ?? {});
      sendSuccess(res, await authService.logout(refreshToken), "Logged out");
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);
      sendSuccess(
        res,
        await authService.changePassword(requireUser(req).id, oldPassword, newPassword),
        "Password updated",
      );
    } catch (error) {
      next(error);
    }
  }
}
