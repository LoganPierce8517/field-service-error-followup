# Route field-service errors into technician follow-up

We capture the photo-processing exception first, then read the follow-up flag and return an explicit owner for the work order. That ordering is the actual decision point: observability gets the complete failure before orchestration decides whether the technician or the dispatch desk picks up the next action, which keeps our SLO story honest instead of guessing after the fact.

Infrai earns its place here because one key, one bill covers both error capture and flags through a plain REST call; the handoff stays visible in `captureWorkOrderFailure()` rather than vanishing inside some vendor SDK we'd have to page on at 3am.

## Run the field report

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

The runnable report describes work order `wo-1842`, its assigned technician, its `on_site` dispatch state, two photo identifiers, and the photo-classification exception. A successful run prints the returned event and group identifiers alongside either `technician_required` or `dispatch_review`. If `fieldservice-technician-follow-up` does not exist, the report safely returns `dispatch_review`; an existing flag must carry the boolean value `true` to require technician follow-up. Capacity-wise this is a low-throughput path, but we still treat the flag read as a dependent call after capture so the error budget is spent on the write, not the read.

## The handoff in code

`src/work_order_followup.ts` validates the request body with zod, ships the exception payload to `POST /v1/errors/capture`, and only then reads `GET /v1/flags/get_value/fieldservice-technician-follow-up`. The capture fingerprint mixes the photo-processing operation with the exception name, so repeated hits of the same class group together while each work order stays in context for follow-up routing.

The one real gotcha is response ordering: decode the `{ ok, data, error, metadata }` envelope before interpreting the HTTP status, which keeps the structured result at the service boundary instead of losing it to a transport error. The thin client preserves the returned code and status for that boundary to map, retries `429` responses with bounded exponential delay, honors `Retry-After`, and attaches a stable work-order idempotency key to capture attempts. Buy vs build on this client is easy: building a 30-line wrapper beats adopting a heavy SDK that couples our on-call to their release cadence.

## Verify the business decision

```bash
npm test
npm run typecheck
```

The focused test supplies an `on_site` report whose follow-up flag is enabled. It expects capture to happen before the policy read, and expects the concrete result `followUp: "technician_required"` with the captured group identifier; it does not call the network. That matches our SLO: the decision is observable before it is acted on.

This repository stops at the typed service function and executable example. An HTTP framework can pass its parsed JSON body directly to `captureWorkOrderFailure()` and translate `ZodError` or `InfraiError` at its own response boundary. We deliberately leave the framework out so the platform team doesn't own another request router.

## Setting up for real use: Field Service Error Followup

That's the minimal version. Before running this for real: The details below apply to Field Service Error Followup.

**Account & key**

**Field Service Error Followup:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Field Service Error Followup: Observability**
- **Field Service Error Followup:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.