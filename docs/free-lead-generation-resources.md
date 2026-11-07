# Free lead generation resources

**XHTMLChop - website and application development**

Access conditions checked: 7 November 2026.

Prioritize published project requests, then research the buyer using the original source. A company profile or verified email does not establish current development demand.

## Published requests

### 1. Google Alerts

- Resource: [google.com/alerts](https://www.google.com/alerts)
- Available data: Links to newly indexed pages mentioning website projects, app development, agency recommendations or requests for proposals.
- Free access and limits: Ongoing email alerts. The linked page supplies the requirement and any published contact details; an alert is not email verification.
- Reference: [Official setup help](https://support.google.com/websearch/answer/4815696)

### 2. LinkedIn public posts

- Resource: [LinkedIn - search member posts](https://www.linkedin.com/help/linkedin/answer/a526104)
- Available data: People asking for a developer or agency, with the author name, company, profile and stated project needs.
- Free access and limits: Basic manual searching is free and subject to usage limits. Email addresses are available only when published or visible to you. Google Alerts can also find indexed public posts; coverage is incomplete.

### 3. Reddit - B2BForHire

- Resource: [reddit.com/r/b2bforhire](https://www.reddit.com/r/b2bforhire/)
- Available data: Public project descriptions, posting dates, usernames, stated budgets and the response channel chosen by the poster.
- Free access and limits: Public browsing and account participation can be free. Use agency-friendly communities and review each community/post before replying; some hiring communities accept individual freelancers only.

## Official project notices

### 4. Find a Tender - United Kingdom

- Resource: [find-tender.service.gov.uk](https://www.find-tender.service.gov.uk/)
- Available data: Published requirements, buyer organization, dates, deadlines and instructions for responding. Contacts appear where published.
- Free access and limits: The current UK central procurement platform is free to search and use; suppliers can set up alerts.
- Reference: [Official free-access guidance](https://www.gov.uk/government/publications/procurement-act-2023-short-guides/central-digital-platform-factsheet-html)

### 5. Contracts Finder - United Kingdom

- Resource: [gov.uk/contracts-finder](https://www.gov.uk/contracts-finder)
- Available data: Contract opportunities, procurement documents, buyer information and historical notices.
- Free access and limits: Search without an account. A free account adds saved searches and email updates. Use alongside Find a Tender.

### 6. TED - European Union

- Resource: [ted.europa.eu](https://ted.europa.eu/)
- Available data: Published procurement specifications, organizations, deadlines and contacts when supplied in the notice.
- Free access and limits: Open access. The official Search API requires no authentication and supports structured notice retrieval for reuse.
- Reference: [Official Search API documentation](https://docs.ted.europa.eu/api/latest/search.html)

### 7. AusTender - Australia

- Resource: [tenders.gov.au](https://www.tenders.gov.au/)
- Available data: Government opportunities, tender documents, closing dates and nominated agency contact officers.
- Free access and limits: Free registration and use, including automatic matching email notifications.
- Reference: [Official free-access guidance](https://sellingtogov.finance.gov.au/faq/using-austender)

### 8. SAM.gov - United States

- Resource: [sam.gov/opportunities](https://sam.gov/opportunities)
- Available data: Federal opportunities, agency names, deadlines and published contact names, emails or telephone numbers.
- Free access and limits: Free discovery access. The public API requires an account key and has daily request limits. Check supplier and location eligibility for each opportunity.
- Reference: [Official Opportunities API](https://open.gsa.gov/api/get-opportunities-public-api/)

## Business contact research

### 9. Google Maps to company websites

- Resource: [Google Maps - place research](https://support.google.com/maps/answer/3092445)
- Available data: Business name, website, public telephone, location and category. A company Contact/About page may publish an email or named contact.
- Free access and limits: Free manual browsing. This is not unrestricted Maps API access or a verified-email service. A listing alone does not establish a development need.

### 10. Clutch

- Resource: [clutch.co/web-designers](https://clutch.co/web-designers)
- Available data: Agency names, services, locations and websites for potential outsourcing partnerships.
- Free access and limits: Public directory research. The Clutch Network is free for providers and buyers to join and use. Profiles and past reviews are not current project requests.
- Reference: [Clutch Network cost and benefits](https://help.clutch.co/en/knowledge/clutch-network-cost-and-benefits)

## Capped contact database

### 11. Apollo - Free Starter plan

- Resource: [apollo.io/pricing](https://www.apollo.io/pricing?product=sales)
- Available data: Business-contact and company searches, subject to the account plan and available credits.
- Free access and limits: An ongoing free Starter plan is available. Credit, enrichment, export and API limits apply; check the allowance shown in your account. No exact quota is assumed here.

### 12. Lusha - Free plan

- Resource: [lusha.com/pricing](https://www.lusha.com/pricing/)
- Available data: Business contact information and email or phone reveals, when available.
- Free access and limits: Currently up to 40 credits per month. An email reveal uses 1 credit and a phone reveal uses 5. This supplements Hunter; it does not provide unlimited leads.

## Search examples

Google Alerts:

```text
"looking for a web development agency"
"website redesign" "request for proposal"
"mobile app development" "tender"
"looking for a development partner"
```

LinkedIn public posts through Google:

```text
site:linkedin.com/posts "looking for" "web developer"
site:linkedin.com/posts "website redesign" "agency"
site:linkedin.com/posts "mobile app" "development partner"
```

Google covers only the public LinkedIn posts it indexes. These are discovery queries, not private buyer search history. Native LinkedIn Posts search can be used manually.

## Suggested implementation order

1. Google Alerts, LinkedIn Posts and agency-friendly communities for stated requirements.
2. TED and UK procurement data for structured scheduled discovery.
3. Public company websites for buyer/contact research; capped databases as optional backups.

Store the resource title, original source URL, discovery date, stated requirement and only actually published contact details. Keep unknown facts unknown. Check tender eligibility and deadlines before preparing a bid.

This guide does not confirm app connections or promise a minimum daily lead count. Free browsing does not necessarily include API access, export rights or email verification. Provider access terms can change.

PDF generation: `python3 scripts/build-resource-guide.py` (requires the ReportLab Python package).
