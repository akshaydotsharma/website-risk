/**
 * Pure geometry functions for the ClusterGraph radial layout.
 * Extracted for testability — no React / DOM dependencies.
 */

// Virtual coordinate space — aspect ratio 8 : 5
export const VW = 1600;
export const VH = 1000;
export const CX = VW / 2; // 800
export const CY = VH / 2; // 500

/** Radius of the radial layout, scaled by node count. */
export function layoutRadius(n: number): number {
  if (n <= 3) return 300;
  if (n <= 6) return 340;
  if (n <= 10) return 370;
  return 400;
}

export interface NodePosition {
  index: number;
  angle: number; // radians
  x: number;
  y: number;
}

/**
 * Compute node positions arranged in a circle.
 * The first node sits at the top (angle = −π/2).
 */
export function computeNodePositions(count: number): NodePosition[] {
  const R = layoutRadius(count);
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      index: i,
      angle,
      x: CX + R * Math.cos(angle),
      y: CY + R * Math.sin(angle),
    };
  });
}

export interface LineEndpoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Compute shortened line endpoints from center hub to a node.
 *
 * @param nodeX  – node x in virtual coords
 * @param nodeY  – node y in virtual coords
 * @param hubInset  – distance from center to pull the hub-end of the line
 * @param nodeInset – distance from node to pull the node-end of the line
 */
export function computeLineEndpoints(
  nodeX: number,
  nodeY: number,
  hubInset: number,
  nodeInset: number
): LineEndpoints {
  const dx = nodeX - CX;
  const dy = nodeY - CY;
  const len = Math.sqrt(dx * dx + dy * dy);

  // Avoid division by zero (node sitting exactly on center)
  if (len === 0) {
    return { x1: CX, y1: CY, x2: CX, y2: CY };
  }

  const ux = dx / len;
  const uy = dy / len;

  return {
    x1: CX + ux * hubInset,
    y1: CY + uy * hubInset,
    x2: nodeX - ux * nodeInset,
    y2: nodeY - uy * nodeInset,
  };
}
