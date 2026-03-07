# Website Extraction & Cluster Analysis Flow

```
Input                                  Output 1                       Cluster Analysis           Output 2
─────                                  ────────                       ─────────────────          ────────

                                  ┌──▶ Website Metadata ──────────┐
                                  ├──▶ About Us & Page Text ───────┤
 🌐 Website A ───────────────────┼──▶ Contact Details & Text ─────┤
                                  ├──▶ Policy Links & Text ────────┤
                                  ├──▶ Homepage SKUs               │
                                  └──▶ Screenshots                 │
                                                                   │
                                  ┌──▶ Website Metadata ──────────┐│
                                  ├──▶ About Us & Page Text ───────┤│
 🌐 Website B ───────────────────┼──▶ Contact Details & Text ─────┤│   AI Similarity        Website Clusters
                                  ├──▶ Policy Links & Text ────────┼─▶  Scoring  ─────────▶
                                  ├──▶ Homepage SKUs               ││                       Uniqueness Checks
                                  └──▶ Screenshots                 ││
                                                                   ││
                                  ┌──▶ Website Metadata ──────────┘│
                                  ├──▶ About Us & Page Text ───────┘│
 🌐 Website C ───────────────────┼──▶ Contact Details & Text ─────┘
                                  ├──▶ Policy Links & Text ────────┘
                                  ├──▶ Homepage SKUs
                                  └──▶ Screenshots
```
