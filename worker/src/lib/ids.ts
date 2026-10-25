import { monotonicFactory } from "ulidx";

export const newId = monotonicFactory();
export const now = () => new Date().toISOString();
