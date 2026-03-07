import type { ClusterInfo } from "./schemas";

/**
 * Union-Find (Disjoint Set Union) for clustering.
 */
class UnionFind {
  private parent: Map<string, string>;
  private rank: Map<string, number>;

  constructor(ids: string[]) {
    this.parent = new Map();
    this.rank = new Map();
    for (const id of ids) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(x: string): string {
    const p = this.parent.get(x)!;
    if (p !== x) {
      this.parent.set(x, this.find(p)); // path compression
    }
    return this.parent.get(x)!;
  }

  union(x: string, y: string): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return;

    const rankX = this.rank.get(rootX)!;
    const rankY = this.rank.get(rootY)!;
    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }

  getClusters(): Map<string, string[]> {
    const clusters = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const existing = clusters.get(root) || [];
      existing.push(id);
      clusters.set(root, existing);
    }
    return clusters;
  }
}

/**
 * Cluster domains by similarity threshold using Union-Find.
 * Only pairs with score >= threshold are merged.
 *
 * @param pairScores Map<"domainAId|domainBId", score> — used for threshold decisions
 * @param domainUrls Map<domainId, url>
 * @param threshold Minimum score to merge (default 70)
 * @param displayScores Optional separate scores for computing cluster stats (avg/max).
 *   When composite scores are used for clustering but raw TF-IDF should be shown in UI,
 *   pass raw scores here. Falls back to pairScores if not provided.
 * @returns clusterAssignments and clusterInfos
 */
export function clusterByThreshold(
  pairScores: Map<string, number>,
  domainUrls: Map<string, string>,
  threshold: number = 70,
  displayScores?: Map<string, number>
): {
  assignments: Map<string, number>;
  clusters: ClusterInfo[];
} {
  const statsScores = displayScores || pairScores;
  const allIds = Array.from(domainUrls.keys());
  const uf = new UnionFind(allIds);

  // Merge pairs above threshold (using composite/clustering scores)
  for (const [key, score] of pairScores) {
    if (score >= threshold) {
      const [a, b] = key.split("|");
      uf.union(a, b);
    }
  }

  // Extract clusters (only groups of 2+)
  const rawClusters = uf.getClusters();
  const assignments = new Map<string, number>();
  const clusters: ClusterInfo[] = [];
  let clusterId = 0;

  for (const [, members] of rawClusters) {
    if (members.length < 2) continue; // singleton, skip

    const cid = clusterId++;
    const memberInfos = members.map((id) => ({
      domainId: id,
      url: domainUrls.get(id) || id,
    }));

    // Compute intra-cluster stats using display scores (raw TF-IDF)
    let totalScore = 0;
    let maxScore = 0;
    let pairCount = 0;

    for (let i = 0; i < members.length; i++) {
      assignments.set(members[i], cid);
      for (let j = i + 1; j < members.length; j++) {
        const key =
          members[i] < members[j]
            ? `${members[i]}|${members[j]}`
            : `${members[j]}|${members[i]}`;
        const score = statsScores.get(key) || 0;
        totalScore += score;
        maxScore = Math.max(maxScore, score);
        pairCount++;
      }
    }

    const avgScore = pairCount > 0 ? Math.round(totalScore / pairCount) : 0;
    clusters.push({
      clusterId: cid,
      members: memberInfos,
      avgScore,
      maxScore,
      pairCount,
      confidence: avgScore >= 70 ? "high" : "moderate",
    });
  }

  return { assignments, clusters };
}
