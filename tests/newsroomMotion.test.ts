import { describe, expect, it } from "vitest";
import {
  beatAtFrame,
  findLongStaticHolds,
  zoomTransformAtFrame
} from "../src/production/newsroom/motion/timing";
import { calculateNewsroomEvidenceMetadata } from "../src/production/newsroom/motion/Root";

describe("newsroom evidence motion", () => {
  it("calculates a 1080p 30fps composition from the requested duration", async () => {
    const metadata = await calculateNewsroomEvidenceMetadata({
      props: {
        durationSeconds: 5.25,
        seriesLabel: "GPT-5.6",
        beats: [
          {
            id: "hero",
            kind: "video",
            assetPath: "hero.mp4",
            durationFrames: 158,
            sourceLabel: "OpenAI",
            headline: "Launch film"
          }
        ]
      }
    });

    expect(metadata).toMatchObject({
      durationInFrames: 158,
      fps: 30,
      width: 1920,
      height: 1080
    });
  });

  it("maps exact frame boundaries to the next visual beat", () => {
    const beats = [{ durationFrames: 30 }, { durationFrames: 60 }];

    expect(beatAtFrame(beats, 29)).toEqual({ index: 0, localFrame: 29 });
    expect(beatAtFrame(beats, 30)).toEqual({ index: 1, localFrame: 0 });
    expect(beatAtFrame(beats, 89)).toEqual({ index: 1, localFrame: 59 });
  });

  it("clamps out-of-range frames to the first and last beat", () => {
    const beats = [{ durationFrames: 30 }, { durationFrames: 60 }];

    expect(beatAtFrame(beats, -1)).toEqual({ index: 0, localFrame: 0 });
    expect(beatAtFrame(beats, 500)).toEqual({ index: 1, localFrame: 59 });
  });

  it("rejects an empty or invalid beat timeline", () => {
    expect(() => beatAtFrame([], 0)).toThrow(/at least one beat/);
    expect(() => beatAtFrame([{ durationFrames: 0 }], 0)).toThrow(/positive integer/);
  });

  it("moves from page context to a readable focal crop", () => {
    const focalRect = { x: 0.35, y: 0.2, width: 0.4, height: 0.25 };
    const start = zoomTransformAtFrame({ frame: 0, durationFrames: 90, focalRect });
    const end = zoomTransformAtFrame({ frame: 89, durationFrames: 90, focalRect });

    expect(start.scale).toBeCloseTo(1);
    expect(start.translateXPercent).toBeCloseTo(0);
    expect(end.scale).toBeGreaterThanOrEqual(2.4);
    expect(end.translateXPercent).not.toBe(0);
    expect(end.translateYPercent).not.toBe(0);
  });

  it("rejects invalid crop geometry", () => {
    expect(() =>
      zoomTransformAtFrame({
        frame: 10,
        durationFrames: 90,
        focalRect: { x: 0.8, y: 0.2, width: 0.4, height: 0.2 }
      })
    ).toThrow(/inside the source/);
  });

  it("warns only for static holds longer than the pacing threshold", () => {
    expect(
      findLongStaticHolds(
        [
          { id: "short", kind: "image", durationFrames: 300 },
          { id: "long", kind: "image", durationFrames: 390 },
          { id: "moving", kind: "video", durationFrames: 900 }
        ],
        30,
        12
      )
    ).toEqual([{ id: "long", durationSeconds: 13 }]);
  });
});
