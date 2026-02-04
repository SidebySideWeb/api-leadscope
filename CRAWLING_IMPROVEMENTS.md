# Crawling System Improvements Needed

## Current Issues

1. **Missing emails** - Almost every crawled business is missing emails
2. **Missing website info** - Websites may not be properly stored or linked
3. **Incomplete contact page crawling** - Not checking all sections (top bar, header, body, footer)

## Current Flow

1. **Discovery**: Businesses identified from Google Maps/Places API
2. **Website Finding**: Website URL from Google Place Details API
3. **Crawling**: Homepage + contact-related pages
4. **Extraction**: Emails/phones extracted from HTML

## Required Flow (User Request)

1. **Identify businesses** from Google search/Maps
2. **Find website/Facebook/LinkedIn/Instagram** 
3. **Fetch email and phone numbers** from:
   - **Homepage**: top bar, header, body, footer
   - **Contact pages**: `/contact`, `/contact-us`, `/epikoinonia`, `/επικοινωνία`, `/forms`, etc.

## Issues to Fix

### 1. Contact Page Patterns Missing

Current patterns in `parser.ts`:
```typescript
const CONTACT_PATTERNS = [
  '/contact',
  '/contact-us',
  '/contactus',
  '/about',
  '/about-us',
  '/team',
  '/staff',
  '/support',
  '/help',
  '/impressum',
  '/privacy',
  // Greek
  '/επικοινωνια',
  '/επικοινωνία',
  '/συνεργασία',
  '/εταιρεία',
  '/ποιοι-ειμαστε',
  '/σχετικα',
  '/ομαδα'
];
```

**Missing patterns:**
- `/forms` (user requested)
- `/epikoinonia` (user requested - transliteration)
- More Greek variations

### 2. Email Extraction Not Checking All Sections

Current extraction checks:
- `mailto:` links
- Text content from `body`

**Missing:**
- Specific extraction from `<header>`, `<nav>`, `<footer>` sections
- Top bar (often in `<div class="top-bar">` or similar)
- Contact forms (may have hidden emails in form action URLs)

### 3. Website Finding May Be Incomplete

Need to verify:
- Are websites being saved to `websites` table?
- Are websites linked correctly to businesses?
- Are social media URLs (Facebook, LinkedIn, Instagram) being checked for contact info?

### 4. Crawling Depth May Be Too Shallow

Current: Crawls homepage + contact pages up to `maxDepth`

**Issue**: May not be crawling enough pages or checking enough sections

## Recommended Fixes

### Fix 1: Expand Contact Page Patterns

Add missing patterns:
- `/forms`
- `/epikoinonia` (transliteration)
- `/contact-form`
- `/get-in-touch`
- More Greek variations

### Fix 2: Improve Email/Phone Extraction

Extract from specific HTML sections:
1. **Top bar** - `<div class="top-bar">`, `<div id="topbar">`, etc.
2. **Header** - `<header>`, `<div class="header">`
3. **Navigation** - `<nav>`, `<div class="nav">`
4. **Body** - Already checked
5. **Footer** - `<footer>`, `<div class="footer">`
6. **Contact forms** - Check form action URLs, hidden inputs

### Fix 3: Ensure Website Storage

Verify:
- Websites are saved when found from Google Places
- Websites are linked to businesses correctly
- Social media URLs are stored and crawled

### Fix 4: Improve Crawling Strategy

1. **Always crawl homepage** (top bar, header, body, footer)
2. **Always crawl contact pages** (all patterns)
3. **Check social media** (Facebook, LinkedIn, Instagram) for contact info
4. **Extract from forms** - Check form action URLs, hidden fields

## Implementation Plan

1. Update `parser.ts` - Add missing contact patterns
2. Update `extractors.ts` - Extract from specific HTML sections
3. Update `crawlWorkerV1Simple.ts` - Ensure all sections are checked
4. Verify website storage - Check if websites are being saved correctly
5. Test with real businesses to verify email/phone extraction
