import { z } from 'zod';
import { stages } from './schema';

const httpWebsite = z.url().max(500).refine(
  (value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  },
  'Use an http or https website address.',
);

export const leadSchema = z.object({
  company: z.string().trim().min(1, 'Enter the company name.').max(200),
  website: z.union([httpWebsite, z.literal('')]).optional().default(''),
  contact_name: z.string().trim().max(200).optional().default(''),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  country: z.string().trim().min(1, 'Choose a country.').max(100),
  role: z.string().trim().max(150).optional().default(''),
  segment: z.string().trim().max(100).optional().default(''),
  source: z.string().trim().min(1, 'Explain where this lead came from.').max(500),
  lawful_basis: z.string().trim().min(1, 'Record why you may contact this lead.').max(2000),
  value: z.number().finite().min(0).max(9999999999.99).default(0),
}).strict();

export type LeadInput = z.input<typeof leadSchema>;
export type ValidatedLead = z.output<typeof leadSchema>;

export const leadUpdateSchema = z.object({
  id: z.uuid(),
  stage: z.enum(stages),
  value: z.number().finite().min(0).max(9999999999.99),
}).strict();

export type LeadUpdate = z.infer<typeof leadUpdateSchema>;
