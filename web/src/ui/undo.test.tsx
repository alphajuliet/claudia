import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errands, main, renderAt, stubApi, task } from "./testApi";

afterEach(() => vi.restoreAllMocks());

const uncompletes = (fetchMock: ReturnType<typeof stubApi>, id: string) =>
  fetchMock.mock.calls.filter(([p]) => p === `/api/tasks/${id}/uncomplete`).length;

/** Completes "Buy stamps" from the Next view, leaving its Undo as the last change. */
async function completeStamps() {
  const stamps = task({ title: "Buy stamps", listId: errands.id, labels: ["next"] });
  const fetchMock = stubApi([stamps]);
  renderAt("/next");
  await userEvent.click(await main().findByRole("checkbox", { name: "Complete Buy stamps" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Completed “Buy stamps”"));
  return { stamps, fetchMock };
}

/** Three hard swings of the phone, as `devicemotion` events. */
function shake() {
  for (const [x, t] of [[20, 0], [-20, 200], [20, 400]] as const) {
    const e = new Event("devicemotion");
    Object.defineProperties(e, {
      acceleration: { value: { x, y: 0, z: 0 } },
      accelerationIncludingGravity: { value: null },
      timeStamp: { value: 10_000 + t },
    });
    act(() => { window.dispatchEvent(e); });
  }
}

describe("undo with z", () => {
  it("undoes the last change, says so, and then has nothing left to undo", async () => {
    const { stamps, fetchMock } = await completeStamps();
    await userEvent.keyboard("z");
    await waitFor(() => expect(uncompletes(fetchMock, stamps.id)).toBe(1));
    expect(screen.getByRole("status").textContent).toContain("Undone: Completed “Buy stamps”");
    expect(await main().findByText("Buy stamps")).toBeTruthy();

    await userEvent.keyboard("z");
    expect(screen.getByRole("status").textContent).toContain("Nothing to undo");
    expect(uncompletes(fetchMock, stamps.id)).toBe(1);
  });

  it("has nothing to undo once the toast's Undo has run", async () => {
    const { stamps, fetchMock } = await completeStamps();
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    await userEvent.keyboard("z");
    expect(screen.getByRole("status").textContent).toContain("Nothing to undo");
    expect(uncompletes(fetchMock, stamps.id)).toBe(1);
  });
});

describe("shake to undo", () => {
  it("asks, naming the change, then undoes it", async () => {
    localStorage.setItem("claudia.shakeToUndo", "on");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { stamps, fetchMock } = await completeStamps();
    shake();
    expect(confirm).toHaveBeenCalledWith("Undo this?\n\nCompleted “Buy stamps”");
    await waitFor(() => expect(uncompletes(fetchMock, stamps.id)).toBe(1));
  });

  it("leaves the change when the question is cancelled", async () => {
    localStorage.setItem("claudia.shakeToUndo", "on");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { stamps, fetchMock } = await completeStamps();
    shake();
    expect(uncompletes(fetchMock, stamps.id)).toBe(0);
  });

  it("does nothing with the setting off", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { stamps, fetchMock } = await completeStamps();
    shake();
    expect(confirm).not.toHaveBeenCalled();
    expect(uncompletes(fetchMock, stamps.id)).toBe(0);
  });

  it("says when there's nothing to undo", async () => {
    localStorage.setItem("claudia.shakeToUndo", "on");
    const confirm = vi.spyOn(window, "confirm");
    stubApi([]);
    renderAt("/next");
    await main().findByText("Nothing here.");
    shake();
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Nothing to undo");
  });
});

describe("the Shake to undo switch", () => {
  const touchWithMotion = (permission: "granted" | "denied") => {
    const requestPermission = vi.fn(async () => permission);
    vi.stubGlobal("DeviceMotionEvent", Object.assign(function DeviceMotionEvent() {}, { requestPermission }));
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(pointer: coarse)", addEventListener() {}, removeEventListener() {} }));
    return requestPermission;
  };

  it("is only on touch screens that report motion", async () => {
    stubApi([]);
    renderAt("/next");
    await main().findByText("Nothing here.");
    expect(screen.queryByRole("switch", { name: "Shake to undo" })).toBeNull();
  });

  it("asks for motion access, then turns on and stays on", async () => {
    const ask = touchWithMotion("granted");
    stubApi([]);
    renderAt("/next");
    const toggle = await screen.findByRole("switch", { name: "Shake to undo" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await userEvent.click(toggle);
    expect(ask).toHaveBeenCalledOnce();
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    expect(localStorage.getItem("claudia.shakeToUndo")).toBe("on");

    await userEvent.click(toggle);
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));
    expect(localStorage.getItem("claudia.shakeToUndo")).toBeNull();
  });

  it("stays off and says why when motion access is refused", async () => {
    touchWithMotion("denied");
    stubApi([]);
    renderAt("/next");
    const toggle = await screen.findByRole("switch", { name: "Shake to undo" });
    await userEvent.click(toggle);
    expect(await screen.findByText(/Motion access wasn't allowed/)).toBeTruthy();
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(localStorage.getItem("claudia.shakeToUndo")).toBeNull();
  });
});
