import assert from "node:assert/strict";
import test from "node:test";
import { captureWorkOrderFailure } from "../src/work_order_followup.js";
import { InfraiError, type InfraiClient } from "../src/infrai_client.js";

const report = {
  workOrderId: "wo-1842",
  technicianId: "tech-27",
  dispatchStatus: "on_site",
  photoIds: ["photo-serial-label"],
  failure: {
    name: "PhotoClassificationError",
    message: "Serial label could not be classified",
    stack: "PhotoClassificationError: Serial label could not be classified",
  },
} as const;

test("an enabled follow-up policy assigns the technician after capture", async () => {
  const calls: string[] = [];
  const infrai = {
    errors: {
      capture: async () => {
        calls.push("capture");
        return { event_id: "evt-41", error_group_id: "grp-photo" };
      },
    },
    flags: {
      get_value: async () => {
        calls.push("follow-up-policy");
        return { value: true };
      },
    },
  } as InfraiClient;

  const result = await captureWorkOrderFailure(
    report,
    infrai,
  );

  assert.deepEqual(calls, ["capture", "follow-up-policy"]);
  assert.equal(result.followUp, "technician_required");
  assert.equal(result.errorGroupId, "grp-photo");
});

test("a missing follow-up flag sends the work order to dispatch review", async () => {
  const infrai = {
    errors: {
      capture: async () => ({ event_id: "evt-42", error_group_id: "grp-photo" }),
    },
    flags: {
      get_value: async () => {
        throw new InfraiError({ code: "NOT_FOUND", message: "Flag not found" }, 404);
      },
    },
  } as InfraiClient;

  const result = await captureWorkOrderFailure(report, infrai);

  assert.equal(result.followUp, "dispatch_review");
  assert.equal(result.eventId, "evt-42");
});
