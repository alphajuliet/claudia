import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiNetworkError, ApiUnauthorized, apiFetch, fetchMe } from "./api";
import { tokenStore } from "./store";

afterEach(() => vi.restoreAllMocks());

describe("tokenStore", () => {
  it("round-trips and clears", () => {
    expect(tokenStore.get()).toBeNull();
    tokenStore.set("cl_abc");
    expect(tokenStore.get()).toBe("cl_abc");
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it("does not throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(tokenStore.get()).toBeNull();
    expect(() => tokenStore.set("cl_abc")).not.toThrow();
  });
});

describe("apiFetch", () => {
  it("sends the bearer token and the client header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("cl_abc", "/api/me");
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/api/me");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer cl_abc");
    expect(headers.get("X-Claudia-Client")).toBe("web");
  });

  it("keeps headers the caller passes as a Headers instance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("cl_abc", "/api/tasks", { headers: new Headers({ "Content-Type": "application/json" }) });
    const headers = new Headers(fetchMock.mock.calls[0]![1].headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer cl_abc");
  });

  it("throws ApiUnauthorized on 401 and ApiNetworkError when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(apiFetch("x", "/api/me")).rejects.toBeInstanceOf(ApiUnauthorized);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(apiFetch("x", "/api/me")).rejects.toBeInstanceOf(ApiNetworkError);
  });
});

describe("fetchMe", () => {
  it("parses the response", async () => {
    const me = { name: "laptop", scopes: ["write"], expiresAt: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(me), { status: 200 })));
    expect(await fetchMe("cl_abc")).toEqual(me);
  });
});
