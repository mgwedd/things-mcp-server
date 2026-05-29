import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAddProjectUrl,
  buildAddUrl,
  buildJsonUrl,
  buildSearchUrl,
  buildShowUrl,
  buildUpdateProjectUrl,
  buildUpdateUrl,
} from "../things-url.js";

describe("things-url: buildAddUrl", () => {
  it("encodes a simple title", () => {
    const url = buildAddUrl({ title: "Buy milk" });
    assert.equal(url, "things:///add?title=Buy%20milk");
  });

  it("omits absent params", () => {
    const url = buildAddUrl({ title: "X" });
    assert.equal(url.includes("notes="), false);
    assert.equal(url.includes("when="), false);
  });

  it("encodes tags as comma-joined", () => {
    const url = buildAddUrl({ title: "X", tags: ["Errand", "Home"] });
    assert.match(url, /tags=Errand%2CHome/);
  });

  it("encodes titles as newline-joined", () => {
    const url = buildAddUrl({ titles: ["A", "B", "C"] });
    assert.match(url, /titles=A%0AB%0AC/);
  });

  it("encodes special characters safely", () => {
    const url = buildAddUrl({ title: "100% & ?=#" });
    assert.match(url, /title=100%25%20%26%20%3F%3D%23/);
  });

  it("encodes checklist items with newlines", () => {
    const url = buildAddUrl({ title: "Shop", checklistItems: ["Bread", "Milk", "Eggs"] });
    assert.match(url, /checklist-items=Bread%0AMilk%0AEggs/);
  });

  it("encodes when=date-time string", () => {
    const url = buildAddUrl({ title: "X", when: "2026-06-01@09:00" });
    assert.match(url, /when=2026-06-01%4009%3A00/);
  });

  it("includes reveal=true literally", () => {
    const url = buildAddUrl({ title: "X", reveal: true });
    assert.match(url, /reveal=true/);
  });

  it("preserves list (area/project) name with spaces", () => {
    const url = buildAddUrl({ title: "X", list: "Athena Care" });
    assert.match(url, /list=Athena%20Care/);
  });
});

describe("things-url: buildAddProjectUrl", () => {
  it("encodes project with area and todos", () => {
    const url = buildAddProjectUrl({
      title: "Vacation",
      area: "Family",
      todos: ["Book flights", "Pack bags"],
    });
    assert.match(url, /title=Vacation/);
    assert.match(url, /area=Family/);
    assert.match(url, /to-dos=Book%20flights%0APack%20bags/);
  });
});

describe("things-url: buildUpdateUrl", () => {
  it("includes auth-token", () => {
    const url = buildUpdateUrl({ id: "ABC123", title: "New" }, "tok-456");
    assert.match(url, /auth-token=tok-456/);
    assert.match(url, /id=ABC123/);
    assert.match(url, /title=New/);
  });

  it("preserves empty string for field-clear", () => {
    // Empty when= should be present (signals clearing)
    const url = buildUpdateUrl({ id: "X", when: "" }, "tok");
    assert.match(url, /when=&|when=$/);
  });

  it("omits undefined fields", () => {
    const url = buildUpdateUrl({ id: "X" }, "tok");
    assert.equal(url.includes("title="), false);
    assert.equal(url.includes("notes="), false);
  });

  it("uses addTags vs tags correctly", () => {
    const urlReplace = buildUpdateUrl({ id: "X", tags: ["A"] }, "tok");
    const urlAppend = buildUpdateUrl({ id: "X", addTags: ["A"] }, "tok");
    assert.match(urlReplace, /[?&]tags=A/);
    assert.match(urlAppend, /add-tags=A/);
  });

  it("encodes completed=true / canceled=true as booleans", () => {
    const url = buildUpdateUrl({ id: "X", completed: true, canceled: false }, "tok");
    assert.match(url, /completed=true/);
    assert.match(url, /canceled=false/);
  });
});

describe("things-url: buildUpdateProjectUrl", () => {
  it("emits area-id correctly", () => {
    const url = buildUpdateProjectUrl({ id: "P", areaId: "Lg8Uq" }, "tok");
    assert.match(url, /area-id=Lg8Uq/);
  });
});

describe("things-url: buildJsonUrl", () => {
  it("serializes JSON in data param", () => {
    const data = [{ type: "to-do", attributes: { title: "Milk" } }];
    const url = buildJsonUrl(data);
    assert.match(url, /^things:\/\/\/json\?data=/);
    // Decode the data param to verify the JSON is preserved
    const params = new URLSearchParams(url.substring(url.indexOf("?") + 1));
    const parsed = JSON.parse(params.get("data")!);
    assert.deepEqual(parsed, data);
  });

  it("includes auth-token when provided", () => {
    const url = buildJsonUrl([], "tok-123");
    assert.match(url, /auth-token=tok-123/);
  });

  it("omits auth-token when not provided", () => {
    const url = buildJsonUrl([]);
    assert.equal(url.includes("auth-token="), false);
  });
});

describe("things-url: buildShowUrl / buildSearchUrl", () => {
  it("show with id", () => {
    assert.equal(buildShowUrl({ id: "today" }), "things:///show?id=today");
  });

  it("show with query + filter", () => {
    const url = buildShowUrl({ query: "Vacation", filter: ["Errand"] });
    assert.match(url, /query=Vacation/);
    assert.match(url, /filter=Errand/);
  });

  it("search with no query", () => {
    assert.equal(buildSearchUrl({}), "things:///search");
  });

  it("search with query", () => {
    const url = buildSearchUrl({ query: "milk" });
    assert.equal(url, "things:///search?query=milk");
  });
});
