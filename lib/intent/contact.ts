import { z } from 'zod';
import { normalizeProjectUrl } from './evidence';

export type PublishedProjectContact = {
  contactName: string | null;
  contactEmail: string | null;
  contactSourceUrl: string | null;
};

const emptyContact = (): PublishedProjectContact => ({ contactName: null, contactEmail: null, contactSourceUrl: null });
const headingPattern = /^(?:(?:(?:project|buyer|client|procurement|tender|rfp|contracting authority)\s+contact(?:\s+(?:person|name|information|details))?)|contact\s+(?:person|name|information|details)|(?:procurement|tender|project|buyer)\s+(?:e-?mail|email address))(?=\s*[:\-–—]|\s*$)/i;
const namedHeading = /(?:contact\s+(?:person|name)|(?:project|buyer|client|procurement|tender|rfp|contracting authority)\s+contact)/i;
const buyerHeading = /^(?:(?:project|buyer|client|procurement|tender|rfp|contracting authority)\s+contact|(?:procurement|tender|project|buyer)\s+(?:e-?mail|email address))/i;
const emailLabel = /^(?:(?:(?:contact|project|buyer|client|procurement|tender)\s+)?e-?mail(?:\s+address)?)\s*[:\-–—]\s*(.+)$/i;
const nameLabel = /^(?:name|contact\s+(?:person|name)|(?:project|buyer|client|procurement|tender|rfp|contracting authority)\s+contact(?:\s+(?:person|name))?)\s*[:\-–—]\s*(.+)$/i;
const blockedContext = /^(?:#{1,6}\s*)?(?:privacy(?:\s+policy)?|cookie(?:s|\s+policy)?|terms(?:\s+of\s+(?:use|service))?|data protection|accessibility(?: statement)?|website (?:contact|support)|platform (?:contact|support)|marketplace (?:contact|support)|technical support|customer support|webmaster|careers?|jobs?|recruitment|related (?:posts|articles)|newsletter|contact us)(?:\b|\s*[:\-–—])/i;
const blockedEmailLocal = /(?:^|[._+-])(?:support|privacy|dpo|dataprotection|data-protection|webmaster|security|abuse|legal|careers?|jobs?|recruitment|recruiting|noreply|no-reply|donotreply|do-not-reply|postmaster)(?:$|[._+-])/i;
const genericEmailLocal = /^(?:info|hello|contact|sales|marketing|feedback|help|customerservice|customer-service)$/i;
const procurementAlias = /(?:^|[._+-])(?:procurement|purchasing|contracts?|tenders?|bids?|rfp)(?:$|[._+-])/i;
const emailToken = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}/g;
const submissionRoute = /(?:\b(?:proposals?|bids?|tenders?|submissions?|responses? to (?:this|the) (?:rfp|request|tender))\b[^.!?\r\n]{0,180}\b(?:e-?mailed|sent|send|submitted|submit|forwarded|delivered|e-?mail)\b[^.!?\r\n]{0,80}\bto\b|\b(?:send|submit|e-?mail|forward|deliver)\b[^.!?\r\n]{0,80}\b(?:proposals?|bids?|tenders?|submissions?)\b[^.!?\r\n]{0,80}\bto\b)/i;
const projectContext = /\b(?:request for (?:proposals?|quotations?|bids?|tenders?)|invitation to (?:bid|tender|quote))\b/i;

function plainLine(line: string) {
  return line.trim().replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '').replace(/\*\*/g, '').trim();
}
function emailsIn(value: string) {
  const emails = new Set<string>();
  for (const match of value.matchAll(emailToken)) {
    const email = match[0].toLowerCase();
    if (!z.email().max(254).safeParse(email).success) continue;
    if (blockedEmailLocal.test(email.split('@')[0])) continue;
    emails.add(email);
  }
  return [...emails];
}
function contactName(value: string) {
  const firstEmail = value.search(emailToken);
  let name = (firstEmail < 0 ? value : value.slice(0, firstEmail)).trim();
  name = name.replace(/(?:mailto:|[<[(,;|])+\s*$/i, '').trim();
  name = name.replace(/(?:[,;|(–—]\s*)?e-?mail(?:\s+address)?\s*:?\s*$/i, '')
    .replace(/[\s,;|<[(–—]+$/g, '').trim();
  name = name.split(/\s+[–—|]\s+/)[0].trim();
  name = name.replace(/^\[([^\]]+)\]$/, '$1').replace(/[,:;]+$/, '').trim();
  if (name.length < 2 || name.length > 200 || !/[\p{L}]/u.test(name) ||
      !/^[\p{L}\p{M} .,'’()\-]+$/u.test(name) ||
      /\b(?:privacy|data protection|webmaster|support|careers?|recruitment|jobs?|example|template|placeholder|your name|contact name|email address)\b/i.test(name)) return null;
  return name;
}
type Candidate = { name: string | null; email: string | null };

/**
 * Extract only contact details expressly published for a qualified buyer request.
 * This helper does not fetch pages, infer email patterns, or verify deliverability.
 */
export function extractProjectContact(sourceText: string, sourceUrl: string): PublishedProjectContact {
  const origin = normalizeProjectUrl(sourceUrl);
  if (!origin || typeof sourceText !== 'string' || sourceText.length > 60_000 || !sourceText.trim()) return emptyContact();
  const lines = sourceText.split(/\r?\n/);
  const candidates: Candidate[] = [];
  let ambiguous = false;
  let excludedSection = false;
  for (let start = 0; start < lines.length; start++) {
    const first = plainLine(lines[start]);
    if (blockedContext.test(first)) { excludedSection = true; continue; }
    const heading = headingPattern.exec(first);
    if (projectContext.test(first) || (heading && buyerHeading.test(heading[0]))) excludedSection = false;
    if (excludedSection) continue;
    const standaloneContactEmail = /^contact\s+e-?mail(?:\s+address)?\s*[:\-–—]\s*(.+)$/i.exec(first);
    if (!heading && !standaloneContactEmail) continue;
    const names = new Set<string>();
    const emails = new Set<string>();
    const isBuyerContext = heading ? buyerHeading.test(heading[0]) : false;
    if (standaloneContactEmail) {
      const explicit = emailsIn(standaloneContactEmail[1]).filter(email => procurementAlias.test(email.split('@')[0]));
      for (const email of explicit) emails.add(email);
    }
    if (heading) {
      const inline = first.slice(heading[0].length).replace(/^\s*[:\-–—]\s*/, '').trim();
      if (inline) {
        for (const email of emailsIn(inline)) emails.add(email);
        if (namedHeading.test(heading[0]) && !/e-?mail/i.test(heading[0])) {
          const name = contactName(inline);
          if (name) names.add(name);
        }
      }
      // A bounded, explicitly labelled block prevents unrelated navigation/footer
      // addresses elsewhere on the page from becoming the prospective buyer's email.
      for (let next = start + 1; next <= Math.min(start + 8, lines.length - 1); next++) {
        const raw = lines[next];
        const line = plainLine(raw);
        if (blockedContext.test(line) || (line && /^#{1,6}\s/.test(raw.trim())) || headingPattern.test(line)) break;
        const email = emailLabel.exec(line);
        if (email) for (const value of emailsIn(email[1])) emails.add(value);
        const labelledName = nameLabel.exec(line);
        if (labelledName) {
          const value = contactName(labelledName[1]);
          if (value) names.add(value);
        } else if (next === start + 1 && !inline && line && !email && !line.includes(':') &&
          line.split(/\s+/).length >= 2 && line.split(/\s+/).length <= 6 &&
          /^[\p{Lu}]/u.test(line) && !/\b(?:please|contact|send|submit|questions?|e-?mail|enquiries|inquiries|for|via|this|our|we|about)\b/i.test(line)) {
          const value = contactName(line);
          if (value) names.add(value);
        }
      }
    }
    if (names.size > 1 || emails.size > 1) { ambiguous = true; continue; }
    const name = [...names][0] ?? null;
    let email: string | null = [...emails][0] ?? null;
    if (email && genericEmailLocal.test(email.split('@')[0]) && !isBuyerContext && !name) email = null;
    if (name || email) candidates.push({ name, email });
  }
  // Some buyer notices publish a submission address as prose rather than a
  // contact block. Accept the literal mailbox only when the same short paragraph
  // explicitly routes proposals/bids/submissions to it. Do not infer a person's name.
  let skipNarrative = false;
  const paragraphs = sourceText.split(/\r?\n[ \t]*\r?\n/)
    .flatMap(paragraph => paragraph.length <= 800 ? [paragraph] : paragraph.split(/\r?\n/));
  for (const paragraph of paragraphs) {
    const text = paragraph.trim();
    if (!text || text.length > 800) continue;
    if (projectContext.test(text)) skipNarrative = false;
    if (text.split(/\r?\n/).some(line => blockedContext.test(plainLine(line)))) { skipNarrative = true; continue; }
    if (skipNarrative || /\b(?:privacy|data protection|unsubscribe|newsletter|webmaster|customer support|job application)\b/i.test(text)) continue;
    const route = submissionRoute.exec(text);
    if (!route) continue;
    const afterRoute = text.slice(route.index + route[0].length);
    const mailbox = emailsIn(afterRoute);
    if (mailbox.length > 1) { ambiguous = true; continue; }
    const mailboxOffset = mailbox.length === 1 ? afterRoute.toLowerCase().indexOf(mailbox[0]) : -1;
    if (mailboxOffset >= 0 && mailboxOffset < 160) candidates.push({ name: null, email: mailbox[0] });
  }
  const names = new Set(candidates.flatMap(candidate => candidate.name ? [candidate.name] : []));
  const emails = new Set(candidates.flatMap(candidate => candidate.email ? [candidate.email] : []));
  if (ambiguous || names.size > 1 || emails.size > 1 || !candidates.length) return emptyContact();
  const name = [...names][0] ?? null;
  const email = [...emails][0] ?? null;
  // Do not imply that an independently listed mailbox belongs to a named person.
  const paired = candidates.some(candidate => candidate.name === name && candidate.email === email);
  const selectedEmail = name && email && !paired ? null : email;
  return { contactName: name, contactEmail: selectedEmail, contactSourceUrl: name || selectedEmail ? origin : null };
}
