import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { events, lists } from "../src/db/schema";
import { createTask, deleteTask, findTasks, getTask, moveTask, setCompleted, updateTask } from "../src/domain/tasks";
import { ApiError } from "../src/lib/errors";
import { newId, now } from "../src/lib/ids";
import { db, reset } from "./helpers";

/** The task rules called directly, without HTTP. */
const list = async (name: string) => {
  const row = { id: newId(), name, folderId: null, position: `a${name}`, archivedAt: null, createdAt: now(), updatedAt: now(), deletedAt: null };
  await db.insert(lists).values(row);
  return row;
};

let home: { id: string };
let work: { id: string };
beforeEach(async () => {
  await reset();
  home = await list("Home");
  work = await list("Work");
});

describe("the task module", () => {
  it("creates, updates, moves, completes and deletes, logging each change as the actor", async () => {
    const parent = await createTask(db, "cli", { listId: home.id, title: "Paint the shed", labels: ["weekend"] });
    const child = await createTask(db, "cli", { listId: home.id, parentId: parent.id, title: "Buy paint" });
    expect(await updateTask(db, "cli", parent.id, { priority: "high", labels: [] })).toMatchObject({ priority: "high", labels: [] });

    const moved = await moveTask(db, "cli", parent.id, { listId: work.id });
    expect(moved).toMatchObject({ listId: work.id, parentId: null });
    expect((await getTask(db, child.id)).listId).toBe(work.id); // The subtask went along.

    expect(await setCompleted(db, "cli", parent.id, true)).toMatchObject({ subtasks: 1 });
    expect(await findTasks(db, { listId: work.id, status: "open", limit: 100, offset: 0 })).toEqual([]);

    await deleteTask(db, "cli", parent.id);
    await expect(getTask(db, child.id)).rejects.toBeInstanceOf(ApiError);
    const logged = await db.select({ type: events.type, actor: events.actor }).from(events).where(eq(events.entityId, parent.id));
    expect(logged.map((e) => e.type)).toEqual(["created", "updated", "moved", "completed", "deleted"]);
    expect(new Set(logged.map((e) => e.actor))).toEqual(new Set(["cli"]));
  });

  it("refuses a task nested under a heading, as an ApiError the routes can show", async () => {
    const heading = await createTask(db, "cli", { listId: home.id, kind: "heading", title: "Spring" });
    await expect(createTask(db, "cli", { listId: home.id, parentId: heading.id, title: "Weed" })).rejects.toMatchObject({ status: 422, code: "invalid_parent" });
  });
});
