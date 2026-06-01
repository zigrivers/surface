import { z } from "zod";

export const nonEmptyStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "must not be empty or whitespace",
  });

export const nonEmptyTrimmedStringSchema = z
  .string()
  .trim()
  .min(1, { message: "must not be empty or whitespace" });
