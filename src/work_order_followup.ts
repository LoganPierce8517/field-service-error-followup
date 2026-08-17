import { z } from "zod";
import {
  createInfraiClient,
  InfraiError,
  type InfraiClient,
} from "./infrai_client.js";

export const workOrderReportSchema = z.object({
  workOrderId: z.string().min(1),
  technicianId: z.string().min(1),
  dispatchStatus: z.enum(["assigned", "en_route", "on_site", "completed"]),
  photoIds: z.array(z.string().min(1)).min(1),
  failure: z.object({
    name: z.string().min(1),
    message: z.string().min(1),
    stack: z.string().min(1),
  }),
});

export type WorkOrderReport = z.infer<typeof workOrderReportSchema>;

export type FollowUpResult = {
  workOrderId: string;
  eventId: string | null;
  errorGroupId: string | null;
  followUp: "technician_required" | "dispatch_review";
};

export async function captureWorkOrderFailure(
  body: unknown,
  infrai: InfraiClient,
): Promise<FollowUpResult> {
  const report = workOrderReportSchema.parse(body);
  const captured = await infrai.errors.capture(
    {
      title: `Work-order photo processing failed`,
      message: report.failure.message,
      level: "error",
      fingerprint: ["work-order-photo", report.failure.name],
      exception: report.failure.stack,
      context: {
        workOrderId: report.workOrderId,
        technicianId: report.technicianId,
        dispatchStatus: report.dispatchStatus,
        photoIds: report.photoIds,
      },
    },
    `work-order-error:${report.workOrderId}:${report.failure.name}`,
  );

  let policy: { value?: unknown };
  try {
    policy = await infrai.flags.get_value("fieldservice-technician-follow-up");
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 404) throw error;
    policy = { value: false };
  }
  const followUp = policy.value === true
    ? "technician_required"
    : "dispatch_review";

  return {
    workOrderId: report.workOrderId,
    eventId: captured.event_id ?? null,
    errorGroupId: captured.error_group_id ?? null,
    followUp,
  };
}

async function main() {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the example");

  const result = await captureWorkOrderFailure(
    {
      workOrderId: "wo-1842",
      technicianId: "tech-27",
      dispatchStatus: "on_site",
      photoIds: ["photo-front-panel", "photo-serial-label"],
      failure: {
        name: "PhotoClassificationError",
        message: "Serial label could not be classified",
        stack: "PhotoClassificationError: Serial label could not be classified\n    at classifyWorkOrderPhoto",
      },
    },
    createInfraiClient(apiKey),
  );
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
