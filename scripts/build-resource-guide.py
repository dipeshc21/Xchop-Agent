#!/usr/bin/env python3
"""Build the downloadable resource guide with ReportLab (python3 + reportlab)."""
from pathlib import Path
from html import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / 'public/resources/free-lead-generation-resources.pdf'
MARKDOWN = ROOT / 'docs/free-lead-generation-resources.md'
CHECKED = '7 November 2026'

RESOURCES = [
    {
        'name': 'Google Alerts', 'category': 'Published requests', 'priority': 'START HERE',
        'url': 'https://www.google.com/alerts', 'display': 'google.com/alerts',
        'data': 'Links to newly indexed pages mentioning website projects, app development, agency recommendations or requests for proposals.',
        'free': 'Ongoing email alerts. The linked page supplies the requirement and any published contact details; an alert is not email verification.',
        'extra': ('Official setup help', 'https://support.google.com/websearch/answer/4815696'),
    },
    {
        'name': 'LinkedIn public posts', 'category': 'Published requests', 'priority': 'START HERE',
        'url': 'https://www.linkedin.com/help/linkedin/answer/a526104', 'display': 'LinkedIn - search member posts',
        'data': 'People asking for a developer or agency, with the author name, company, profile and stated project needs.',
        'free': 'Basic manual searching is free and subject to usage limits. Email addresses are available only when published or visible to you. Google Alerts can also find indexed public posts; coverage is incomplete.',
    },
    {
        'name': 'Reddit - B2BForHire', 'category': 'Published requests', 'priority': 'REVIEW DAILY',
        'url': 'https://www.reddit.com/r/b2bforhire/', 'display': 'reddit.com/r/b2bforhire',
        'data': 'Public project descriptions, posting dates, usernames, stated budgets and the response channel chosen by the poster.',
        'free': 'Public browsing and account participation can be free. Use agency-friendly communities and review each community/post before replying; some hiring communities accept individual freelancers only.',
    },
    {
        'name': 'Find a Tender - United Kingdom', 'category': 'Official project notices', 'priority': 'UK',
        'url': 'https://www.find-tender.service.gov.uk/', 'display': 'find-tender.service.gov.uk',
        'data': 'Published requirements, buyer organization, dates, deadlines and instructions for responding. Contacts appear where published.',
        'free': 'The current UK central procurement platform is free to search and use; suppliers can set up alerts.',
        'extra': ('Official free-access guidance', 'https://www.gov.uk/government/publications/procurement-act-2023-short-guides/central-digital-platform-factsheet-html'),
    },
    {
        'name': 'Contracts Finder - United Kingdom', 'category': 'Official project notices', 'priority': 'UK',
        'url': 'https://www.gov.uk/contracts-finder', 'display': 'gov.uk/contracts-finder',
        'data': 'Contract opportunities, procurement documents, buyer information and historical notices.',
        'free': 'Search without an account. A free account adds saved searches and email updates. Use alongside Find a Tender.',
    },
    {
        'name': 'TED - European Union', 'category': 'Official project notices', 'priority': 'EU / API',
        'url': 'https://ted.europa.eu/', 'display': 'ted.europa.eu',
        'data': 'Published procurement specifications, organizations, deadlines and contacts when supplied in the notice.',
        'free': 'Open access. The official Search API requires no authentication and supports structured notice retrieval for reuse.',
        'extra': ('Official Search API documentation', 'https://docs.ted.europa.eu/api/latest/search.html'),
    },
    {
        'name': 'AusTender - Australia', 'category': 'Official project notices', 'priority': 'AU',
        'url': 'https://www.tenders.gov.au/', 'display': 'tenders.gov.au',
        'data': 'Government opportunities, tender documents, closing dates and nominated agency contact officers.',
        'free': 'Free registration and use, including automatic matching email notifications.',
        'extra': ('Official free-access guidance', 'https://sellingtogov.finance.gov.au/faq/using-austender'),
    },
    {
        'name': 'SAM.gov - United States', 'category': 'Official project notices', 'priority': 'US',
        'url': 'https://sam.gov/opportunities', 'display': 'sam.gov/opportunities',
        'data': 'Federal opportunities, agency names, deadlines and published contact names, emails or telephone numbers.',
        'free': 'Free discovery access. The public API requires an account key and has daily request limits. Check supplier and location eligibility for each opportunity.',
        'extra': ('Official Opportunities API', 'https://open.gsa.gov/api/get-opportunities-public-api/'),
    },
    {
        'name': 'Google Maps to company websites', 'category': 'Business contact research', 'priority': 'MANUAL',
        'url': 'https://support.google.com/maps/answer/3092445', 'display': 'Google Maps - place research',
        'data': 'Business name, website, public telephone, location and category. A company Contact/About page may publish an email or named contact.',
        'free': 'Free manual browsing. This is not unrestricted Maps API access or a verified-email service. A listing alone does not establish a development need.',
    },
    {
        'name': 'Clutch', 'category': 'Business contact research', 'priority': 'AGENCY PARTNERS',
        'url': 'https://clutch.co/web-designers', 'display': 'clutch.co/web-designers',
        'data': 'Agency names, services, locations and websites for potential outsourcing partnerships.',
        'free': 'Public directory research. The Clutch Network is free for providers and buyers to join and use. Profiles and past reviews are not current project requests.',
        'extra': ('Clutch Network cost and benefits', 'https://help.clutch.co/en/knowledge/clutch-network-cost-and-benefits'),
    },
    {
        'name': 'Apollo - Free Starter plan', 'category': 'Capped contact database', 'priority': 'LIMITED ALLOWANCE',
        'url': 'https://www.apollo.io/pricing?product=sales', 'display': 'apollo.io/pricing',
        'data': 'Business-contact and company searches, subject to the account plan and available credits.',
        'free': 'An ongoing free Starter plan is available. Credit, enrichment, export and API limits apply; check the allowance shown in your account. No exact quota is assumed here.',
    },
    {
        'name': 'Lusha - Free plan', 'category': 'Capped contact database', 'priority': 'LIMITED ALLOWANCE',
        'url': 'https://www.lusha.com/pricing/', 'display': 'lusha.com/pricing',
        'data': 'Business contact information and email or phone reveals, when available.',
        'free': 'Currently up to 40 credits per month. An email reveal uses 1 credit and a phone reveal uses 5. This supplements Hunter; it does not provide unlimited leads.',
    },
]
QUERIES = [
    '"looking for a web development agency"',
    '"website redesign" "request for proposal"',
    '"mobile app development" "tender"',
    '"looking for a development partner"',
]
LINKEDIN_QUERIES = [
    'site:linkedin.com/posts "looking for" "web developer"',
    'site:linkedin.com/posts "website redesign" "agency"',
    'site:linkedin.com/posts "mobile app" "development partner"',
]

font_dir = Path('/usr/share/fonts/truetype/open-sans')
if (font_dir / 'OpenSans-Regular.ttf').is_file():
    for alias, file in [('Guide', 'OpenSans-Regular.ttf'), ('GuideBold', 'OpenSans-Bold.ttf'), ('GuideSemi', 'OpenSans-Semibold.ttf')]:
        pdfmetrics.registerFont(TTFont(alias, str(font_dir / file)))
    FONT, BOLD, SEMI = 'Guide', 'GuideBold', 'GuideSemi'
else:
    FONT, BOLD, SEMI = 'Helvetica', 'Helvetica-Bold', 'Helvetica-Bold'

INK = colors.HexColor('#20352e')
GREEN = colors.HexColor('#28745b')
MUTED = colors.HexColor('#62736b')
LINE = colors.HexColor('#dce7e0')
SOFT = colors.HexColor('#edf5f0')
PAPER = colors.HexColor('#ffffff')
PAGE_W, PAGE_H = A4
CONTENT_W = PAGE_W - 88

STYLES = {
    'hero': ParagraphStyle('hero', fontName=BOLD, fontSize=29, leading=35, textColor=INK, spaceAfter=10),
    'title': ParagraphStyle('title', fontName=BOLD, fontSize=25, leading=31, textColor=INK, spaceAfter=10),
    'intro': ParagraphStyle('intro', fontName=FONT, fontSize=10, leading=15.5, textColor=MUTED, spaceAfter=15),
    'section': ParagraphStyle('section', fontName=SEMI, fontSize=12, leading=17, textColor=INK, spaceAfter=9),
    'cardtitle': ParagraphStyle('cardtitle', fontName=BOLD, fontSize=11, leading=15, textColor=INK, spaceAfter=3),
    'body': ParagraphStyle('body', fontName=FONT, fontSize=9, leading=13.5, textColor=INK, spaceAfter=4),
    'compact': ParagraphStyle('compact', fontName=FONT, fontSize=8.5, leading=12.5, textColor=INK, spaceAfter=3),
    'small': ParagraphStyle('small', fontName=FONT, fontSize=8, leading=12, textColor=MUTED, spaceAfter=4),
    'label': ParagraphStyle('label', fontName=BOLD, fontSize=7.5, leading=11, textColor=GREEN, spaceAfter=4),
    'query': ParagraphStyle('query', fontName=FONT, fontSize=8.6, leading=14, textColor=INK, spaceAfter=5),
}


def para(text, style='body'):
    return Paragraph(text, STYLES[style])


def link(label, url):
    return f'<a href="{escape(url, quote=True)}" color="#28745b">{escape(label)}</a>'


def callout(title, text):
    box = Table([[para(escape(title), 'section')], [para(escape(text), 'body')]], colWidths=[CONTENT_W - 28])
    box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), SOFT), ('BOX', (0, 0), (-1, -1), .6, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 14), ('RIGHTPADDING', (0, 0), (-1, -1), 14),
        ('TOPPADDING', (0, 0), (-1, 0), 12), ('BOTTOMPADDING', (0, -1), (-1, -1), 10),
    ]))
    return box


def card(item, compact=False):
    style = 'compact' if compact else 'body'
    items = [
        para(escape(item['priority']), 'label'),
        para(escape(item['name']), 'cardtitle'),
        para(escape(item['data']), style),
        para('<b>Free access:</b> ' + escape(item['free']), style),
    ]
    links = link(item['display'], item['url'])
    if item.get('extra'):
        links += ' &nbsp; | &nbsp; ' + link(*item['extra'])
    items.append(para(links, 'small'))
    table = Table([[items]], colWidths=[CONTENT_W])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), PAPER), ('BOX', (0, 0), (-1, -1), .6, LINE),
        ('LEFTPADDING', (0, 0), (-1, -1), 13), ('RIGHTPADDING', (0, 0), (-1, -1), 13),
        ('TOPPADDING', (0, 0), (-1, -1), 9 if compact else 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6 if compact else 9),
    ]))
    return KeepTogether([table, Spacer(1, 9)])


def page_chrome(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    canvas.setFillColor(GREEN)
    canvas.roundRect(44, PAGE_H - 58, 23, 23, 5, stroke=0, fill=1)
    canvas.setFont(BOLD, 15)
    canvas.setFillColor(PAPER)
    canvas.drawString(49, PAGE_H - 51, 'x.')
    canvas.setFillColor(INK)
    canvas.setFont(SEMI, 10)
    canvas.drawString(75, PAGE_H - 43, 'XHTMLChop')
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 7)
    canvas.drawString(75, PAGE_H - 55, 'GROWTH WORKSPACE  /  RESOURCE GUIDE')
    canvas.setFont(FONT, 7.5)
    canvas.drawRightString(PAGE_W - 44, PAGE_H - 47, CHECKED)
    canvas.setStrokeColor(LINE)
    canvas.line(44, PAGE_H - 72, PAGE_W - 44, PAGE_H - 72)
    canvas.line(44, 43, PAGE_W - 44, 43)
    canvas.setFillColor(MUTED)
    canvas.setFont(FONT, 7)
    canvas.drawString(44, 29, 'Free access conditions can change. Review the linked official pages before connecting a source.')
    canvas.drawRightString(PAGE_W - 44, 29, f'{doc.page} / 4')
    canvas.restoreState()


def build_pdf():
    PDF.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(PDF), pagesize=A4, rightMargin=44, leftMargin=44, topMargin=92, bottomMargin=58,
        title='Free Lead Generation Resources | XHTMLChop', author='XHTMLChop', subject='Zero-budget resources for website and application development prospects',
        pageCompression=1)
    story = [
        para('Free lead generation<br/>resources', 'hero'),
        para('A practical reference for website and application development services. Start with published project requests, then research the contact details supplied by the original source.', 'intro'),
        para('12 RESOURCES  /  NO HUNTER PURCHASE REQUIRED', 'label'),
        Spacer(1, 5),
    ]
    story += [card(r) for r in RESOURCES[:3]]
    story += [callout('The distinction that keeps the list useful', 'A published request is evidence of a stated need. A company profile or verified email is a prospect, not proof that the company wants a website or application.')]
    story += [PageBreak(), para('Official project requests', 'title'), para('These public portals publish buying requirements and response instructions. Check that your business can meet each notice\'s supplier, location and submission requirements before spending time on a bid.', 'intro')]
    story += [card(r, compact=True) for r in RESOURCES[3:8]]
    story += [para('FOR FUTURE AUTOMATION', 'label'), para('TED exposes an openly accessible Search API. UK procurement data is another structured source to evaluate. Connect only matching, open opportunities; retain their original URLs and deadlines.', 'small')]
    story += [PageBreak(), para('Business contact research', 'title'), para('Use these sources for public company details or potential agency partners. They do not establish current project demand. Capped free databases can supplement your list, but they are not an unlimited replacement for Hunter.', 'intro')]
    story += [card(r, compact=True) for r in RESOURCES[8:]]
    story += [callout('Keep the original source', 'Record a source title, direct source URL, discovery date and the contact details actually published. Leave missing names, emails, budgets and requirements unknown.')]
    story += [PageBreak(), para('Start with useful alerts', 'title'), para('Create focused searches instead of collecting every company that matches a broad industry. These are search phrases for your discovery process, not a record of anyone\'s private search history.', 'intro')]
    story += [para('Google Alerts - project requests', 'section')]
    query_box = Table([[para(escape(q), 'query')] for q in QUERIES], colWidths=[CONTENT_W])
    query_box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),SOFT),('BOX',(0,0),(-1,-1),.6,LINE),('LEFTPADDING',(0,0),(-1,-1),13),('RIGHTPADDING',(0,0),(-1,-1),13),('TOPPADDING',(0,0),(-1,0),11),('BOTTOMPADDING',(0,-1),(-1,-1),8)]))
    story += [query_box, Spacer(1,16), para('LinkedIn public posts through Google search', 'section')]
    story += [para(escape(q), 'query') for q in LINKEDIN_QUERIES]
    story += [para('Use the same phrases in LinkedIn\'s Posts search. Google can alert only on public posts it indexes; it does not cover every LinkedIn post or provide a native LinkedIn alert/API.', 'small'), Spacer(1,12), para('Recommended order', 'section')]
    steps = [
        ('1', 'Start now', 'Google Alerts, LinkedIn Posts and agency-friendly public communities for stated website/app needs.'),
        ('2', 'Add structured feeds', 'Evaluate TED and UK procurement data for scheduled discovery without purchased contact credits.'),
        ('3', 'Research the buyer', 'Follow the original website/profile and use only published contact information. Keep capped databases as optional backups.'),
    ]
    rows = [[para(n,'cardtitle'), para(f'<b>{escape(title)}</b><br/>{escape(body)}','body')] for n,title,body in steps]
    steps_table = Table(rows, colWidths=[27, CONTENT_W-27])
    steps_table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-1),.5,LINE),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LEFTPADDING',(0,0),(-1,-1),0)]))
    story += [steps_table, Spacer(1,17), callout('A useful record for follow-up', 'Resource title + source link + original requirement + publication/deadline when available + discovery date + published contact name/email or response channel. Review availability before following up.'), Spacer(1,10), para('This guide is a resource list, not confirmation that every source is connected to Xchop-Agent. Free browsing does not always include API access, contact exports or email-delivery verification. No minimum daily result count is implied.', 'small')]
    doc.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)


def build_markdown():
    lines = [
        '# Free lead generation resources', '', '**XHTMLChop - website and application development**', '', f'Access conditions checked: {CHECKED}.', '',
        'Prioritize published project requests, then research the buyer using the original source. A company profile or verified email does not establish current development demand.', '',
    ]
    current = None
    for i, r in enumerate(RESOURCES, 1):
        cat = r['category']
        if cat != current:
            lines.extend([f'## {cat}', '']); current = cat
        lines.extend([f'### {i}. {r["name"]}', '', f'- Resource: [{r["display"]}]({r["url"]})', f'- Available data: {r["data"]}', f'- Free access and limits: {r["free"]}'])
        if r.get('extra'):
            lines.append(f'- Reference: [{r["extra"][0]}]({r["extra"][1]})')
        lines.append('')
    lines.extend(['## Search examples', '', 'Google Alerts:', '', '```text', *QUERIES, '```', '', 'LinkedIn public posts through Google:', '', '```text', *LINKEDIN_QUERIES, '```', '',
        'Google covers only the public LinkedIn posts it indexes. These are discovery queries, not private buyer search history. Native LinkedIn Posts search can be used manually.', '',
        '## Suggested implementation order', '', '1. Google Alerts, LinkedIn Posts and agency-friendly communities for stated requirements.', '2. TED and UK procurement data for structured scheduled discovery.', '3. Public company websites for buyer/contact research; capped databases as optional backups.', '',
        'Store the resource title, original source URL, discovery date, stated requirement and only actually published contact details. Keep unknown facts unknown. Check tender eligibility and deadlines before preparing a bid.', '',
        'This guide does not confirm app connections or promise a minimum daily lead count. Free browsing does not necessarily include API access, export rights or email verification. Provider access terms can change.', '',
        'PDF generation: `python3 scripts/build-resource-guide.py` (requires the ReportLab Python package).', '',
    ])
    MARKDOWN.parent.mkdir(parents=True, exist_ok=True)
    MARKDOWN.write_text('\n'.join(lines), encoding='utf-8')


if __name__ == '__main__':
    build_pdf()
    build_markdown()
    print(PDF)
    print(MARKDOWN)
