import { describe, expect, it } from "vitest";
import {
  MAX_MEDIA_ITEMS,
  MAX_SETLIST_ENTRIES,
  isSafeHttpUrl,
  parseMediaItems,
  parseSetlistEntries,
  parseSetlistText,
  parseYouTubeId,
  youTubeEmbedUrl,
  youTubeThumbnailUrl,
} from "./media";

describe("parseYouTubeId", () => {
  it("extracts the id from every accepted URL form", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("keeps the id when extra query params surround it", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL")).toBe("dQw4w9WgXcQ");
  });

  it("rejects non-YouTube hosts even with a v= param (provider allow-list)", () => {
    expect(parseYouTubeId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeId("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeId("https://vimeo.com/123456789")).toBeNull();
  });

  it("rejects malformed ids, non-http schemes, and junk", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/watch?v=toolongtobeavalidid")).toBeNull();
    expect(parseYouTubeId("javascript:alert(1)")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
    expect(parseYouTubeId("")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/")).toBeNull();
  });

  it("builds thumbnail and embed URLs from an id", () => {
    expect(youTubeThumbnailUrl("dQw4w9WgXcQ")).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(youTubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1");
  });
});

describe("isSafeHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isSafeHttpUrl("https://photos.app.goo.gl/abc")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
    expect(isSafeHttpUrl("  https://example.com  ")).toBe(true);
  });

  it("rejects dangerous schemes and non-URLs", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeHttpUrl("ftp://example.com")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });
});

describe("parseMediaItems", () => {
  it("keeps valid youtube and photo_album entries with sanitized titles", () => {
    const result = parseMediaItems([
      { type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", title: "<b>Live set</b>" },
      { type: "photo_album", url: "https://photos.app.goo.gl/abc" },
    ]);
    expect(result).toEqual([
      { type: "youtube", url: "https://youtu.be/dQw4w9WgXcQ", title: "Live set" },
      { type: "photo_album", url: "https://photos.app.goo.gl/abc" },
    ]);
  });

  it("drops unknown types, bad urls, and non-objects", () => {
    expect(
      parseMediaItems([
        { type: "vimeo", url: "https://vimeo.com/1" },
        { type: "youtube", url: "https://evil.com/watch?v=dQw4w9WgXcQ" },
        { type: "photo_album", url: "javascript:alert(1)" },
        { type: "youtube" },
        "nonsense",
        null,
      ]),
    ).toEqual([]);
  });

  it("returns [] for non-array input and caps the array length", () => {
    expect(parseMediaItems(null)).toEqual([]);
    expect(parseMediaItems("[]")).toEqual([]);
    const many = Array.from({ length: MAX_MEDIA_ITEMS + 5 }, () => ({
      type: "youtube",
      url: "https://youtu.be/dQw4w9WgXcQ",
    }));
    expect(parseMediaItems(many)).toHaveLength(MAX_MEDIA_ITEMS);
  });
});

describe("parseSetlistEntries", () => {
  it("keeps the title and only safe streaming links", () => {
    const result = parseSetlistEntries([
      {
        title: "<i>Song A</i>",
        spotify: "https://open.spotify.com/track/1",
        apple: "javascript:alert(1)",
        youtube: "https://youtu.be/dQw4w9WgXcQ",
      },
    ]);
    expect(result).toEqual([
      { title: "Song A", spotify: "https://open.spotify.com/track/1", youtube: "https://youtu.be/dQw4w9WgXcQ" },
    ]);
  });

  it("drops entries without a title and non-array input, and caps length", () => {
    expect(parseSetlistEntries([{ spotify: "https://open.spotify.com/track/1" }])).toEqual([]);
    expect(parseSetlistEntries({})).toEqual([]);
    const many = Array.from({ length: MAX_SETLIST_ENTRIES + 5 }, (_, i) => ({ title: `Song ${i}` }));
    expect(parseSetlistEntries(many)).toHaveLength(MAX_SETLIST_ENTRIES);
  });
});

describe("parseSetlistText", () => {
  it("extracts plain song titles from a pasted Telegram setlist", () => {
    const message = `1.  Runaway Baby (dj) + 1 semitone
(intro b4 'i aint trynna hurt u baby'

 2. Poker Face / Bad Romance Mashup (dj)
3. Robbers (The 1975) (dj)
4. bad (wave to earth) (+2 semitones) (rd)
 5. Moves Like Jagger (rd)
 6. Beauty and a Beat (rd)
 7. The Story of Us (rj)
 8. Yellow (rj)
 9. Mr. Brightside (rj) + 1 semitone`;

    expect(parseSetlistText(message)).toEqual([
      "Runaway Baby",
      "Poker Face / Bad Romance Mashup",
      "Robbers",
      "bad",
      "Moves Like Jagger",
      "Beauty and a Beat",
      "The Story of Us",
      "Yellow",
      "Mr. Brightside",
    ]);
  });

  it("treats every non-empty line as a song when there are no list markers", () => {
    expect(parseSetlistText("Yellow\n\nMr. Brightside (rj)\n  ")).toEqual(["Yellow", "Mr. Brightside"]);
  });

  it("returns an empty list for blank input", () => {
    expect(parseSetlistText("")).toEqual([]);
    expect(parseSetlistText("   \n  \n")).toEqual([]);
  });
});
