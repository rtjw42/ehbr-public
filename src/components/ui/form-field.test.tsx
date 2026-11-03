// The association between a field's error and its control is the one thing that
// kept drifting: it used to be hand-wired at each call site, and every caller with
// more than two fields forgot at least one. It is structural now (FormField
// publishes, the control consumes), so these lock the structure rather than the
// call sites — a regression here is silent in the browser and invisible to a
// screen reader, which is exactly why it went unnoticed for so long.
import { describe, expect, it, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";

import { FormField } from "@/components/ui/form-field";
import { FieldRow } from "@/components/ui/field-row";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const render = (ui: React.ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
  return container;
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("FormField error association", () => {
  it("points a text input at its error message", () => {
    const el = render(
      <FormField id="title" label="Title" error="Title is required">
        <Input id="title" />
      </FormField>,
    );
    const input = el.querySelector("input")!;
    const message = el.querySelector("p")!;

    expect(message.id).toBe("title-error");
    expect(input.getAttribute("aria-describedby")).toBe("title-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("points a picker row at its error — the case that was impossible before", () => {
    // FieldRow had no prop for this, so every picker field in the app was unwired
    // however carefully the caller was written.
    const el = render(
      <FormField id="date" label="Date" error="Pick a date">
        {/* the positioning wrapper is why cloning the child cannot work */}
        <div className="relative">
          <FieldRow id="date" value="Select a date" onClick={() => {}} />
        </div>
      </FormField>,
    );
    const row = el.querySelector("button")!;

    expect(row.getAttribute("aria-describedby")).toBe("date-error");
    expect(row.getAttribute("aria-invalid")).toBe("true");
  });

  it("wires a textarea the same way", () => {
    const el = render(
      <FormField id="notes" label="Notes" error="Too long">
        <Textarea id="notes" />
      </FormField>,
    );
    expect(el.querySelector("textarea")!.getAttribute("aria-describedby")).toBe("notes-error");
  });

  it("describes nothing while the field is valid", () => {
    const el = render(
      <FormField id="title" label="Title">
        <Input id="title" />
      </FormField>,
    );
    const input = el.querySelector("input")!;

    expect(el.querySelector("p")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("leaves an explicit aria-describedby alone", () => {
    const el = render(
      <FormField id="title" label="Title" error="Title is required">
        <Input id="title" aria-describedby="something-else" />
      </FormField>,
    );
    expect(el.querySelector("input")!.getAttribute("aria-describedby")).toBe("something-else");
  });

  it("keeps a hidden label as the control's name and still wires the error", () => {
    // A list row whose icon is its visible label (media URL rows) — the label
    // must survive for assistive tech, and the error beneath must still describe
    // the input, or the row would be a FormField in name only.
    const el = render(
      <FormField id="row-1" label="YouTube video" labelHidden error="Enter a valid YouTube link.">
        <Input id="row-1" />
      </FormField>,
    );
    const label = el.querySelector("label")!;
    const input = el.querySelector("input")!;

    expect(label.getAttribute("for")).toBe("row-1");
    expect(label.className).toContain("sr-only");
    expect(input.getAttribute("aria-describedby")).toBe("row-1-error");
  });

  it("does not touch a control used outside a FormField", () => {
    // Input and Textarea are used on pages and in the auth panel too.
    const el = render(<Input id="loose" />);
    const input = el.querySelector("input")!;

    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });
});
