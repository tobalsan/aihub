import { z } from "zod";

export const LeadSessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sliceId: z.string().optional(),
  agentId: z.string(),
  kind: z.literal("lead"),
  title: z.string(),
  titleLocked: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional(),
  transcriptRef: z.string(),
});

export type LeadSession = z.infer<typeof LeadSessionSchema>;

export const LeadSessionChangedKindSchema = z.enum([
  "created",
  "updated",
  "archived",
  "deleted",
]);

export type LeadSessionChangedKind = z.infer<
  typeof LeadSessionChangedKindSchema
>;

export const LeadSessionChangedEventSchema = z.object({
  type: z.literal("lead_session_changed"),
  kind: LeadSessionChangedKindSchema,
  session: LeadSessionSchema,
});

export type LeadSessionChangedEvent = z.infer<
  typeof LeadSessionChangedEventSchema
>;
