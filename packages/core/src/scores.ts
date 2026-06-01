import { z } from "zod";

export const NormalizedScoreSchema = z.number().min(0).max(1);
