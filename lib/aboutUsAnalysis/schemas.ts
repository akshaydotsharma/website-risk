export const PAGE_TEXT_TYPES: { key: string; label: string }[] = [
  { key: "homepage_text", label: "Homepage" },
  { key: "about_page", label: "About Us" },
  { key: "contact_page", label: "Contact Us" },
  { key: "privacy_page", label: "Privacy Policy" },
  { key: "refund_page", label: "Refund Policy" },
  { key: "terms_page", label: "Terms of Service" },
];

export interface KeywordHit {
  keyword: string;
  count: number;
}

export interface PageScore {
  pageType: string;
  label: string;
  score: number;
  sharedSentenceCount: number;
}

export interface PairResult {
  domainAId: string;
  domainBId: string;
  domainAUrl: string;
  domainBUrl: string;
  textScore: number;
  sharedSentences: string[];
  keywordHitsA: KeywordHit[];
  keywordHitsB: KeywordHit[];
  pageScores: PageScore[];
  clusterId: number | null;
  flagged: boolean;
  flagReasons: string[];
}

export interface ClusterInfo {
  clusterId: number;
  members: { domainId: string; url: string }[];
  avgScore: number;
  maxScore: number;
  pairCount: number;
  confidence: "high" | "moderate"; // high: avg composite ≥ 70, moderate: 50-69
}

export interface FlagInfo {
  type: string;
  description: string;
  count: number;
}

export interface AnalysisRunSummary {
  domainCount: number;
  pairCount: number;
  avgScore: number;
  maxScore: number;
  clusterCount: number;
  flaggedCount: number;
  clusters: ClusterInfo[];
  flags: FlagInfo[];
  topPairs: {
    domainAUrl: string;
    domainBUrl: string;
    textScore: number;
  }[];
}

export interface DomainText {
  domainId: string;
  url: string;
  text: string;
}
