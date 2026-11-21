import { describe, expect, test } from "bun:test";
import { fitHeader, HEADER_MAX } from "./pins-lib.ts";

describe("fitHeader (commitlint header-max-length)", () => {
  test("a short header stays the same", () => {
    expect(fitHeader("chore: pin core to d305216 (fix: a", ")")).toBe("chore: pin core to d305216 (fix: a)");
  });

  test("a long core subject is cut, and the tail stays", () => {
    const subject = "fix(sideband): trailing gives the whole end region when the codec hint knows only its last part";
    const h = fitHeader(`chore: pin core to d305216 (${subject}`, ")");
    expect(h.length).toBeLessThanOrEqual(HEADER_MAX);
    expect(h.startsWith("chore: pin core to d305216 (fix(sideband): trailing")).toBe(true);
    expect(h.endsWith("...)")).toBe(true);
  });

  test("the cut is at a word end when one is near", () => {
    const h = fitHeader(`chore: pin core to abc1234 (${"word ".repeat(40)}`, ")");
    expect(h.length).toBeLessThanOrEqual(HEADER_MAX);
    expect(h).toMatch(/word\.\.\.\)$/);
  });

  test("the umbrella header keeps its SHA range", () => {
    const h = fitHeader(`chore: bump ${"plugins, cli, web, ".repeat(6)}for the core pin refresh`, " (a126757 to d305216)");
    expect(h.length).toBeLessThanOrEqual(HEADER_MAX);
    expect(h.endsWith("... (a126757 to d305216)")).toBe(true);
  });

  test("the length is in code points, as commitlint counts", () => {
    const h = fitHeader(`chore: pin core to abc1234 (${"é".repeat(120)}`, ")");
    expect([...h].length).toBeLessThanOrEqual(HEADER_MAX);
  });
});
