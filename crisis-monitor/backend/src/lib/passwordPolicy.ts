import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;

/** Shared rule for every place a password is set. Length matters far more
 *  than symbol rules, so this asks for 12+ characters and nothing fussier. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200);
