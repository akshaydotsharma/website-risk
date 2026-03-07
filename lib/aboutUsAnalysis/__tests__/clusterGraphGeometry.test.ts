import { describe, it, expect } from "vitest";
import {
  VW,
  VH,
  CX,
  CY,
  layoutRadius,
  computeNodePositions,
  computeLineEndpoints,
} from "../clusterGraphGeometry";

describe("constants", () => {
  it("has correct virtual coordinate space", () => {
    expect(VW).toBe(1600);
    expect(VH).toBe(1000);
    expect(CX).toBe(800);
    expect(CY).toBe(500);
  });
});

describe("layoutRadius", () => {
  it("returns 300 for 2-3 nodes", () => {
    expect(layoutRadius(2)).toBe(300);
    expect(layoutRadius(3)).toBe(300);
  });

  it("returns 340 for 4-6 nodes", () => {
    expect(layoutRadius(4)).toBe(340);
    expect(layoutRadius(6)).toBe(340);
  });

  it("returns 370 for 7-10 nodes", () => {
    expect(layoutRadius(7)).toBe(370);
    expect(layoutRadius(10)).toBe(370);
  });

  it("returns 400 for 11+ nodes", () => {
    expect(layoutRadius(11)).toBe(400);
    expect(layoutRadius(50)).toBe(400);
  });
});

describe("computeNodePositions", () => {
  it("places the first node at the top (angle = -π/2)", () => {
    const positions = computeNodePositions(4);
    expect(positions[0].angle).toBeCloseTo(-Math.PI / 2, 10);
    // Top means x ≈ CX, y < CY
    expect(positions[0].x).toBeCloseTo(CX, 5);
    expect(positions[0].y).toBeLessThan(CY);
  });

  it("returns the correct count of nodes", () => {
    for (const n of [2, 3, 5, 7, 10, 15]) {
      expect(computeNodePositions(n)).toHaveLength(n);
    }
  });

  it("all nodes are at the correct radius from center", () => {
    const n = 7;
    const R = layoutRadius(n);
    const positions = computeNodePositions(n);
    for (const pos of positions) {
      const dist = Math.sqrt((pos.x - CX) ** 2 + (pos.y - CY) ** 2);
      expect(dist).toBeCloseTo(R, 5);
    }
  });

  it("nodes for N=2 are at top and bottom", () => {
    const positions = computeNodePositions(2);
    // First at top
    expect(positions[0].x).toBeCloseTo(CX, 5);
    expect(positions[0].y).toBeCloseTo(CY - layoutRadius(2), 5);
    // Second at bottom
    expect(positions[1].x).toBeCloseTo(CX, 5);
    expect(positions[1].y).toBeCloseTo(CY + layoutRadius(2), 5);
  });

  it("nodes for N=4 are at top, right, bottom, left", () => {
    const R = layoutRadius(4);
    const positions = computeNodePositions(4);
    // Top
    expect(positions[0].x).toBeCloseTo(CX, 5);
    expect(positions[0].y).toBeCloseTo(CY - R, 5);
    // Right
    expect(positions[1].x).toBeCloseTo(CX + R, 5);
    expect(positions[1].y).toBeCloseTo(CY, 5);
    // Bottom
    expect(positions[2].x).toBeCloseTo(CX, 5);
    expect(positions[2].y).toBeCloseTo(CY + R, 5);
    // Left
    expect(positions[3].x).toBeCloseTo(CX - R, 5);
    expect(positions[3].y).toBeCloseTo(CY, 5);
  });

  it("angles are evenly spaced", () => {
    const n = 7;
    const positions = computeNodePositions(n);
    const expectedStep = (2 * Math.PI) / n;
    for (let i = 1; i < positions.length; i++) {
      const diff = positions[i].angle - positions[i - 1].angle;
      expect(diff).toBeCloseTo(expectedStep, 10);
    }
  });
});

describe("computeLineEndpoints", () => {
  const HUB_INSET = 60;
  const NODE_INSET = 80;

  it("computes correct endpoints for the TOP node (perfectly vertical line)", () => {
    // This is the exact bairday.com case — node at top, angle = -π/2
    const R = layoutRadius(7);
    const nodeX = CX; // 800 — same X as center
    const nodeY = CY - R; // 130

    const ep = computeLineEndpoints(nodeX, nodeY, HUB_INSET, NODE_INSET);

    // Line should go straight up from hub to node
    expect(ep.x1).toBeCloseTo(CX, 5); // hub-end x = center x
    expect(ep.y1).toBeCloseTo(CY - HUB_INSET, 5); // hub-end y = 500 - 60 = 440
    expect(ep.x2).toBeCloseTo(CX, 5); // node-end x = center x
    expect(ep.y2).toBeCloseTo(nodeY + NODE_INSET, 5); // node-end y = 130 + 80 = 210

    // The line should have positive length (y1 > y2 since SVG y goes down)
    expect(ep.y1).toBeGreaterThan(ep.y2);
    const lineLength = Math.sqrt((ep.x2 - ep.x1) ** 2 + (ep.y2 - ep.y1) ** 2);
    expect(lineLength).toBeGreaterThan(100); // must be visible
  });

  it("computes correct endpoints for the RIGHT node (perfectly horizontal line)", () => {
    const R = layoutRadius(4);
    const nodeX = CX + R; // right
    const nodeY = CY;

    const ep = computeLineEndpoints(nodeX, nodeY, HUB_INSET, NODE_INSET);

    expect(ep.y1).toBeCloseTo(CY, 5);
    expect(ep.y2).toBeCloseTo(CY, 5);
    expect(ep.x1).toBeCloseTo(CX + HUB_INSET, 5);
    expect(ep.x2).toBeCloseTo(nodeX - NODE_INSET, 5);
  });

  it("computes correct endpoints for the BOTTOM node (perfectly vertical down)", () => {
    const R = layoutRadius(4);
    const nodeX = CX;
    const nodeY = CY + R;

    const ep = computeLineEndpoints(nodeX, nodeY, HUB_INSET, NODE_INSET);

    expect(ep.x1).toBeCloseTo(CX, 5);
    expect(ep.x2).toBeCloseTo(CX, 5);
    expect(ep.y1).toBeCloseTo(CY + HUB_INSET, 5);
    expect(ep.y2).toBeCloseTo(nodeY - NODE_INSET, 5);
  });

  it("computes correct endpoints for the LEFT node", () => {
    const R = layoutRadius(4);
    const nodeX = CX - R;
    const nodeY = CY;

    const ep = computeLineEndpoints(nodeX, nodeY, HUB_INSET, NODE_INSET);

    expect(ep.y1).toBeCloseTo(CY, 5);
    expect(ep.y2).toBeCloseTo(CY, 5);
    expect(ep.x1).toBeCloseTo(CX - HUB_INSET, 5);
    expect(ep.x2).toBeCloseTo(nodeX + NODE_INSET, 5);
  });

  it("shortened line is shorter than full radius", () => {
    const R = layoutRadius(7);
    const nodeX = CX + R * Math.cos(Math.PI / 6);
    const nodeY = CY + R * Math.sin(Math.PI / 6);

    const ep = computeLineEndpoints(nodeX, nodeY, HUB_INSET, NODE_INSET);
    const lineLength = Math.sqrt((ep.x2 - ep.x1) ** 2 + (ep.y2 - ep.y1) ** 2);

    expect(lineLength).toBeCloseTo(R - HUB_INSET - NODE_INSET, 5);
    expect(lineLength).toBeLessThan(R);
    expect(lineLength).toBeGreaterThan(0);
  });

  it("handles node at center (zero distance) gracefully", () => {
    const ep = computeLineEndpoints(CX, CY, HUB_INSET, NODE_INSET);
    // Should return center point for both, no NaN
    expect(ep.x1).toBe(CX);
    expect(ep.y1).toBe(CY);
    expect(ep.x2).toBe(CX);
    expect(ep.y2).toBe(CY);
    expect(Number.isNaN(ep.x1)).toBe(false);
    expect(Number.isNaN(ep.y1)).toBe(false);
  });

  it("all 7 nodes produce valid line endpoints with positive length", () => {
    const positions = computeNodePositions(7);
    for (const pos of positions) {
      const ep = computeLineEndpoints(pos.x, pos.y, HUB_INSET, NODE_INSET);

      // No NaN values
      expect(Number.isNaN(ep.x1)).toBe(false);
      expect(Number.isNaN(ep.y1)).toBe(false);
      expect(Number.isNaN(ep.x2)).toBe(false);
      expect(Number.isNaN(ep.y2)).toBe(false);

      // Positive line length
      const lineLength = Math.sqrt(
        (ep.x2 - ep.x1) ** 2 + (ep.y2 - ep.y1) ** 2
      );
      expect(lineLength).toBeGreaterThan(100);

      // Line stays within the virtual coordinate space
      expect(ep.x1).toBeGreaterThanOrEqual(0);
      expect(ep.x1).toBeLessThanOrEqual(VW);
      expect(ep.y1).toBeGreaterThanOrEqual(0);
      expect(ep.y1).toBeLessThanOrEqual(VH);
      expect(ep.x2).toBeGreaterThanOrEqual(0);
      expect(ep.x2).toBeLessThanOrEqual(VW);
      expect(ep.y2).toBeGreaterThanOrEqual(0);
      expect(ep.y2).toBeLessThanOrEqual(VH);
    }
  });

  it("all 15 nodes produce valid line endpoints", () => {
    const positions = computeNodePositions(15);
    for (const pos of positions) {
      const ep = computeLineEndpoints(pos.x, pos.y, HUB_INSET, NODE_INSET);
      const lineLength = Math.sqrt(
        (ep.x2 - ep.x1) ** 2 + (ep.y2 - ep.y1) ** 2
      );
      expect(lineLength).toBeGreaterThan(0);
      expect(Number.isNaN(ep.x1)).toBe(false);
      expect(Number.isNaN(ep.y1)).toBe(false);
      expect(Number.isNaN(ep.x2)).toBe(false);
      expect(Number.isNaN(ep.y2)).toBe(false);
    }
  });
});
