import { describe, expect, it } from "vitest";
import { isYouTubeURL } from "../extractors/youtube.js";

describe("youtube URL detection", () => {
    it("detects standard youtube.com/watch URLs", () => {
        expect(isYouTubeURL("https://www.youtube.com/watch?v=dQw4w9WgXcQ").isYouTube).toBe(true);
        expect(isYouTubeURL("https://www.youtube.com/watch?v=dQw4w9WgXcQ").videoId).toBe("dQw4w9WgXcQ");
    });

    it("detects youtu.be short URLs", () => {
        expect(isYouTubeURL("https://youtu.be/dQw4w9WgXcQ").isYouTube).toBe(true);
        expect(isYouTubeURL("https://youtu.be/dQw4w9WgXcQ").videoId).toBe("dQw4w9WgXcQ");
    });

    it("detects youtube.com/shorts URLs", () => {
        expect(isYouTubeURL("https://www.youtube.com/shorts/dQw4w9WgXcQ").isYouTube).toBe(true);
        expect(isYouTubeURL("https://www.youtube.com/shorts/dQw4w9WgXcQ").videoId).toBe("dQw4w9WgXcQ");
    });

    it("detects youtube.com/embed URLs", () => {
        expect(isYouTubeURL("https://www.youtube.com/embed/dQw4w9WgXcQ").isYouTube).toBe(true);
    });

    it("detects mobile youtube.com URLs", () => {
        expect(isYouTubeURL("https://m.youtube.com/watch?v=dQw4w9WgXcQ").isYouTube).toBe(true);
    });

    it("detects youtube.com/live URLs", () => {
        expect(isYouTubeURL("https://www.youtube.com/live/dQw4w9WgXcQ").isYouTube).toBe(true);
    });

    it("returns false for non-YouTube URLs", () => {
        expect(isYouTubeURL("https://vimeo.com/123456").isYouTube).toBe(false);
        expect(isYouTubeURL("https://example.com").isYouTube).toBe(false);
        expect(isYouTubeURL("").isYouTube).toBe(false);
    });

    it("returns false for playlist URLs", () => {
        const result = isYouTubeURL("https://www.youtube.com/playlist?list=PLA");
        expect(result.isYouTube).toBe(false);
        expect(result.videoId).toBeNull();
    });
});
