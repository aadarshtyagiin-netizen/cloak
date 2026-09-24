import { z } from 'zod';

export const requestCodeSchema = z.object({
  email: z.string().trim().min(3).max(320),
});

export const verifyCodeSchema = z.object({
  challengeId: z.string().min(1).max(64),
  code: z.string().trim().min(4).max(10),
});

export type RequestCodeInput = z.infer<typeof requestCodeSchema>;
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;
