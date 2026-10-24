export type Lead = {
  id: string;
  company: string;
  website: string | null;
  contact_name: string;
  email: string;
  country: string;
  role: string | null;
  stage: string;
  score: number;
  score_reason: string | null;
  value: number;
  segment: string;
  created_at: string;
  updated_at: string;
  source: string;
  lawful_basis: string;
};
