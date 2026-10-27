import type { CompanyFacts, EmailVerification, FitScore, FoundContact } from './types';

export function isVerifiedBusinessEmail(verification: EmailVerification): boolean {
  return verification.status === 'valid' && !verification.acceptAll && !verification.disposable && !verification.webmail;
}

/** Deterministic evidence score. Missing team capabilities, budgets and consent are never inferred. */
export function scoreProspect(facts: CompanyFacts, contact: FoundContact, verification: EmailVerification, targetCountryCodes: readonly string[]): FitScore {
  const evidence = `${facts.name}\n${facts.description}\n${facts.industry}\n${facts.tags.join('\n')}`.toLowerCase();
  const reasons: string[] = [];
  if (!facts.countryCode || facts.countryCode === 'IN' || !targetCountryCodes.includes(facts.countryCode)) {
    return { score: 0, reason: 'Company country is missing, excluded, or outside the selected target markets.', segment: 'Unqualified' };
  }
  if (!isVerifiedBusinessEmail(verification)) {
    return { score: 0, reason: 'A verified business email is required; risky or unconfirmed addresses are excluded.', segment: 'Unqualified' };
  }
  if (contact.provenance !== 'found' || !contact.sources.length) {
    return { score: 0, reason: 'A public source for a found business contact is required.', segment: 'Unqualified' };
  }

  let score = 20;
  reasons.push(`Company enrichment places the business in ${facts.country || facts.countryCode} (+20)`);
  score += 15; reasons.push('Business email verified valid (+15)');
  score += 5; reasons.push('Contact has a recorded public source (+5)');
  let segment = 'Other business';
  const agency = /\b(?:design agency|web design|creative agency|branding agency|digital agency|digital marketing|marketing agency|design studio|creative studio|advertising agency)\b/.test(evidence);
  const freelancer = /\b(?:freelance designer|freelance design|independent designer)\b/.test(evidence);
  const ecommerce = /\b(?:e-commerce|ecommerce|online store|online retail|shopify)\b/.test(evidence);
  const software = /\b(?:saas|software as a service|software company|startup)\b/.test(evidence);
  if (agency) { score += 30; segment = 'Design agency'; reasons.push('Provider description, industry or tags indicate design/agency services (+30)'); }
  else if (freelancer) { score += 25; segment = 'Freelance designer'; reasons.push('Provider facts indicate freelance design services (+25)'); }
  else if (ecommerce) { score += 15; segment = 'E-commerce'; reasons.push('Provider facts indicate e-commerce activity (+15)'); }
  else if (software) { score += 10; segment = 'SaaS / startup'; reasons.push('Provider facts indicate software or startup activity (+10)'); }
  else reasons.push('No priority customer segment established (+0)');

  if (/\b(?:figma|photoshop|psd|responsive|webflow|wordpress|website design|ui design|ux design|landing page|email template)\b/.test(evidence)) {
    score += 10; reasons.push('Provider facts mention relevant design or website work (+10)');
  }
  if (/\b(?:founder|owner|partner|ceo|chief|director|president|managing|head of|creative lead)\b/i.test(contact.role)) {
    score += 10; reasons.push(`Listed role is relevant to a partnership discussion: ${contact.role.slice(0, 100)} (+10)`);
  }
  if (facts.employeeCount !== null && facts.employeeCount >= 1 && facts.employeeCount <= 50) {
    score += 5; reasons.push(`Provider reports ${facts.employeeCount} employees (+5)`);
  }
  reasons.push('No conclusion about an in-house development team, budget, or permission to contact is made.');
  return { score: Math.max(0, Math.min(100, score)), reason: reasons.join('; '), segment };
}
