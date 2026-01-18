# Quick Start Guide

Get up and running with Website Risk Intel in 3 simple steps.

## Prerequisites

- Node.js 18+ installed
- OpenAI API key

## Setup

### 1. Configure Your OpenAI API Key

Open the [.env](.env) file and add your OpenAI API key:

```bash
OPENAI_API_KEY="your-actual-api-key-here"
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Enter a website URL (e.g., `example.com` or `https://example.com`)
2. Click "Scan Website"
3. Wait 10-30 seconds for the scan to complete
4. View the extracted contact details and intelligence signals

## What Gets Extracted?

Currently, the scanner extracts:
- Email addresses
- Phone numbers
- Physical addresses
- Contact form URLs
- Social media links (LinkedIn, Twitter, Facebook, Instagram)
- Primary contact page URL

## Next Steps

- View scan history at `/scans`
- Rescan websites to get fresh data
- Check the [README.md](README.md) for more details on extending the system

## Troubleshooting

**Build errors?**
```bash
npm run build
```

**Database issues?**
```bash
npx prisma migrate dev
npx prisma generate
```

**Port already in use?**
```bash
# Change port in package.json or run:
PORT=3001 npm run dev
```
