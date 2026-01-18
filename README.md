# Website Risk Intel

A web application for scanning websites to extract intelligence signals for risk assessment. Built with Next.js, TypeScript, Prisma, and OpenAI.

## Features

- **Website Scanning**: Scan any website to check if it's active and extract data points
- **Generic Architecture**: Extensible design to support multiple data point extractors
- **Contact Details Extraction**: Currently extracts emails, phone numbers, addresses, social links, and contact forms
- **Scan History**: View all past scans with status and timestamps
- **Detailed View**: Deep-dive into each scan with structured data points
- **Rescan Capability**: Re-scan websites to get fresh data

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Database**: Prisma ORM with SQLite (easily switchable to PostgreSQL)
- **AI**: OpenAI API with web search capabilities
- **Styling**: Tailwind CSS + shadcn/ui components
- **Validation**: Zod

## Database Schema

### WebsiteScan
Stores information about each website scan:
- `id`: Unique identifier
- `url`: Full website URL
- `domain`: Extracted domain name
- `isActive`: Whether the website is online
- `statusCode`: HTTP status code
- `checkedAt`: When the website was last checked
- `createdAt`: When the scan was created
- `updatedAt`: When the scan was last updated

### ScanDataPoint
Generic storage for extracted data points:
- `id`: Unique identifier
- `scanId`: Foreign key to WebsiteScan
- `key`: Data point type (e.g., "contact_details")
- `label`: Human-readable label
- `value`: JSON-encoded extracted data
- `sources`: JSON-encoded array of source URLs
- `rawOpenAIResponse`: Full OpenAI API response
- `extractedAt`: When the data was extracted

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- OpenAI API key

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd website-risk
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create or update the `.env` file with your OpenAI API key:
```bash
OPENAI_API_KEY="your-openai-api-key-here"
```

4. Initialize the database:
```bash
npx prisma migrate dev
```

5. Start the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

### Creating a Scan

1. Go to the home page
2. Enter a website URL (e.g., `example.com` or `https://example.com`)
3. Click "Scan Website"
4. Wait for the scan to complete (this may take 10-30 seconds)
5. View the extracted data points

### Viewing Scan History

1. Click "Scan History" in the navigation
2. See all past scans with their status
3. Click "View" on any scan to see details

### Rescanning

1. Open any scan detail page
2. Click the "Rescan" button
3. The website will be re-checked and data re-extracted

## Architecture

### Extensibility

The application is designed to be extensible for future data points:

1. **Data Point Registry**: New extractors can be added to [lib/extractors.ts](lib/extractors.ts)
2. **Generic Storage**: All data points use the same `ScanDataPoint` table
3. **Type-Safe**: Each data point has its own Zod schema for validation
4. **Custom Rendering**: Add custom UI components for new data point types

### Adding New Data Points

To add a new data point extractor:

1. Define a Zod schema for the data structure
2. Add an entry to the `dataPointRegistry` in [lib/extractors.ts](lib/extractors.ts)
3. Implement the extraction prompt
4. (Optional) Add custom UI rendering in [app/scans/[id]/page.tsx](app/scans/[id]/page.tsx)

Example:
```typescript
// In lib/extractors.ts
const trustSignalsSchema = z.object({
  has_privacy_policy: z.boolean(),
  has_terms_of_service: z.boolean(),
  has_ssl: z.boolean(),
  // ... more fields
});

dataPointRegistry["trust_signals"] = {
  key: "trust_signals",
  label: "Trust Signals",
  schema: trustSignalsSchema,
  prompt: (url, domain) => `Extract trust signals from ${url}...`,
};
```

## API Endpoints

### POST /api/scans
Create a new scan.

**Request body:**
```json
{
  "url": "https://example.com"
}
```

**Response:**
```json
{
  "id": "scan-id"
}
```

### GET /api/scans
Get all scans with their data points.

### POST /api/scans/[id]/rescan
Rescan an existing website.

## Project Structure

```
website-risk/
├── app/
│   ├── api/
│   │   └── scans/          # API routes
│   ├── scans/              # Scan pages
│   │   ├── [id]/           # Individual scan detail
│   │   └── page.tsx        # Scan history
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page
│   └── globals.css         # Global styles
├── components/
│   └── ui/                 # shadcn/ui components
├── lib/
│   ├── prisma.ts           # Prisma client
│   ├── utils.ts            # Utility functions
│   └── extractors.ts       # Data point extractors
├── prisma/
│   └── schema.prisma       # Database schema
└── README.md
```

## Environment Variables

- `DATABASE_URL`: SQLite database file path (default: `file:./dev.db`)
- `OPENAI_API_KEY`: Your OpenAI API key (required)

## Future Enhancements

Potential data points to add:
- Company identity signals (about page, team info)
- Legal pages (privacy policy, terms, refund policy)
- Domain age and registration info
- Payment/checkout signals
- Trust badges and certifications
- Security headers and SSL info
- Risk scoring logic

## License

ISC
