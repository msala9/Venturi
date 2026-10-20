import test from "node:test";
import assert from "node:assert/strict";
import { sendMutation, persistentClientId } from "../js/api.js";
test("writer identity survives reload in one tab and remains isolated from another tab",()=>{
  const values = new Map(), storage = {getItem:(key)=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  assert.equal(persistentClientId(storage,()=>"first-client"),"first-client");
  assert.equal(persistentClientId(storage,()=>"different-client"),"first-client");
  assert.equal(persistentClientId({getItem:()=>null,setItem(){}},()=>"other-tab"),"other-tab");
  assert.equal(persistentClientId({getItem(){throw new Error("Blocked");}},()=>"fallback"),"fallback");
});
test("a lost mutation response looks up the same ID without replaying", async () => {
  const calls = [];
  const fetcher = async (path, options) => {
    calls.push({ path, method: options.method });
    if (calls.length === 1) throw new TypeError("Disconnected");
    return {
      ok: true,
      json: async () => ({ command_id: "same-id", status: "applied" }),
    };
  };
  const result = await sendMutation(
    "/timelines/0/commands",
    { command_id: "same-id" },
    fetcher,
  );
  assert.equal(result.status, "applied");
  assert.deepEqual(calls, [
    { path: "/api/v1/timelines/0/commands", method: "POST" },
    { path: "/api/v1/commands/same-id", method: "GET" },
  ]);
});
test("unknown outcomes remain explicit and are never blindly resent", async () => {
  let count = 0;
  await assert.rejects(
    sendMutation("/projects/commands", { command_id: "unknown" }, async () => {
      count++;
      throw new TypeError("Offline");
    }),
    (error) => error.code === "OUTCOME_UNKNOWN",
  );
  assert.equal(count, 2);
});
