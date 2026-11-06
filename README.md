# Marketplace (Airbnb-style) — app repo

Two-sided stays marketplace on AWS: EKS services, DynamoDB single table, S3 + CloudFront photos,
Cognito auth, Razorpay Route payments, GitHub Actions to ECR, Argo CD GitOps, and an Expo app.

"StayBook" and `example.in` are placeholders. Replace the brand, domains, `your-org` and
`123456789012` everywhere before going live.

## Layout

```
.github/
  services.json                 build matrix source of truth (service -> GitOps group)
  scripts/changed-services.mjs  picks services to build from the git diff
  scripts/gitops-images.mjs     edits Kustomize image tags in the GitOps repo
  workflows/ci-cd.yaml          main: test, scan, push to ECR, bump dev overlay
  workflows/promote.yaml        manual: dev->staging->prod as a PR in the GitOps repo
  workflows/pr-validate.yaml    PRs: backend + web checks, terraform validate, script dry run
  workflows/mobile.yaml         PRs: bundle check; mobile-v* tags: EAS store builds
  workflows/lambda-deploy.yaml  main: test, package and deploy the Lambdas (publishes a version)
packages/shared/                geohash, keys, auth, http, booking rules, Razorpay clients
packages/test-utils/            moto-backed DynamoDB with the real table schema
services/listing-svc/           listings, host calendar, photo uploads, publish gating, admin suspend
services/search-svc/            map search: geohash cells -> GSI3 -> availability + stay price, room/Instant Book
                                filters, flexible dates (weekend/week/month), place lookup (/v1/places)
services/booking-svc/           quotes, holds, request to book (accept/decline), Razorpay orders, trips,
                                host reservations, cancellations, refunds
services/user-svc/              profile, wishlist, host onboarding (Razorpay Route linked account + Cognito host group)
services/review-svc/            reviews after check-out, host replies, rating aggregates, hosts review guests
services/message-svc/           guest-host messaging: threads, inbox, unread counts, push tokens
services/admin-svc/             staff API: work queues, daily metrics, user lookup/disable, audit log
lambdas/payment-webhook/        Razorpay webhook: confirm bookings, auto-refund, host KYC status
lambdas/hold-expirer/           every minute: close unpaid holds and release their nights
lambdas/image-processor/        S3 upload -> strip EXIF/GPS -> w360/w720/w1280 WebP
lambdas/booking-notifier/       DynamoDB stream -> SES emails + Expo push (bookings, requests, new messages)
lambdas/ops-indexer/            DynamoDB stream -> staff queues (GSI5) + daily metrics, each change counted once
lambdas/host-evaluator/         daily: Superhost status and host stats (response rate, cancellations)
docker/node-service.Dockerfile  one Dockerfile for all Node services (test + distroless runtime)
docker/web.Dockerfile           Next.js standalone build (test + distroless runtime)
infra/terraform/                DynamoDB, Cognito, S3/CloudFront, ECR, GitHub OIDC, Pod Identity,
                                Razorpay secret, Lambdas + triggers + alarms
apps/web/                       Next.js 16 site: search + map, listing, checkout, trips, wishlist,
                                profile, host dashboard, listing editor (photos, calendar), payouts,
                                admin console (/admin) for operations staff and the sales team
apps/mobile/                    Expo SDK 58 app: map + place search, filters, listing, checkout, trips,
                                inbox + push, wishlist, reviews, profile, hosting, payout onboarding
gitops-seed/                    initial contents for Repo B (marketplace-gitops)
```

## What each app covers

| | Web | Mobile |
|---|---|---|
| Search (map + list), listing page, reviews, save to wishlist | yes | yes |
| Book and pay (Razorpay), resume an unpaid hold, cancel, see refund | yes | yes |
| Itemised price (cleaning, discounts, GST), Instant Book or request to book | yes | yes |
| Place search, filters (price, rooms, type, Instant Book), flexible dates | yes | yes |
| Message host / guest, inbox, unread badge | yes | yes (plus push) |
| Review a stay after check-out; hosts review guests | yes | yes |
| Profile | yes | yes |
| Host: payout onboarding, dashboard, reservations, accept/decline requests, cancel, reply to reviews, publish/unlist | yes | yes |
| Host: create/edit listing, photos, map pin, calendar, fees, discounts, stay limits, Instant Book | yes | opens the web editor |
| Staff: admin console | yes (`/admin`) | no |

## Staff roles and the admin console

| Cognito group | Who | Sees in `/admin` |
|---|---|---|
| `admin` | operations / support | everything: overview, metrics, refunds queue (retry), hosts stuck in payout setup, listing moderation (suspend/reinstate), booking and user lookup, disable/enable accounts, audit log |
| `analyst` | digital & sales team | overview and metrics only (with CSV export); nothing personal |

Everyone else gets a 404 at `/admin`. Add staff in the Cognito console or with
`aws cognito-idp admin-add-user-to-group --user-pool-id <pool> --username <sub> --group-name analyst`
(they must sign out and in again). Every staff action (suspend, reinstate, cancel, refund retry,
disable, enable) is written to the audit log with who, what and why, kept for 3 years.

Queues and metrics come from **ops-indexer** reading the table stream, so they lag by seconds and
cover changes made after it was deployed. It counts each stream record exactly once (a mark item
claimed in the same transaction as the counter update). Metric days are India time.

## Setup order

1. **Terraform** (needs the VPC/EKS stack from the earlier blueprint, with the `eks-pod-identity-agent` add-on):
   ```bash
   cd infra/terraform
   terraform init -backend-config=env/dev.backend.hcl
   terraform apply -var-file=env/dev.tfvars
   ```
   Set `ses_from_email` to a verified SES identity to switch on booking emails (until then the
   notifier only sends push). SES starts in sandbox mode: request production access.
   **Existing tables:** this version widens the GSI3 projection (search needs the pricing fields).
   DynamoDB rebuilds that index, so search returns nothing for a few minutes; apply off-peak.
2. **Repo B**: push `gitops-seed/` to `your-org/marketplace-gitops`. Fill the `REPLACE*` values in the
   overlays from `terraform output` (the web overlay needs the hosted-UI domain and the web client id).
   Register clusters in Argo CD as `dev`, `staging`, `prod`, then
   `kubectl apply -n argocd -f argocd/bootstrap/root-app.yaml`.
3. **Repo A settings**: variable `AWS_ROLE_ARN` (= `github_ci_role_arn` output), variable `GITOPS_APP_ID`,
   secret `GITOPS_APP_PRIVATE_KEY` (a GitHub App with Contents and Pull requests write on Repo B).
   Change `your-org` in `ci-cd.yaml` and `promote.yaml`.
4. **Razorpay** (test mode first):
   - Put the keys in the secret: `aws secretsmanager put-secret-value --secret-id $(terraform output -raw razorpay_secret_arn) --secret-string '{"key_id":"rzp_test_...","key_secret":"...","webhook_secret":"..."}'`
   - Dashboard > Webhooks: URL = `terraform output payment_webhook_url`, same `webhook_secret`, events
     `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`, `account.activated`,
     `account.needs_clarification`, `account.under_review`, `account.suspended`, `account.rejected`.
   - Dashboard > Payment capture: **automatic**. Route (with linked-account creation via API) must be enabled.
   - Deploy the Lambda code once: run `lambda-deploy` (Terraform ships a placeholder that refuses to run).
     Do this promptly after `terraform apply`: the stream keeps 24 hours, and ops-indexer starts from the latest record.
5. **Push to main**. The changed services (and the web app) build, the dev overlay tags update, and
   Argo CD syncs dev. Run `promote` to raise PRs for staging, then prod (prod sync is manual in Argo CD).
6. **Web locally**: `cd apps/web && cp .env.example .env.local`, fill it, `npm ci && npm run dev`.
   Add `http://localhost:3000/auth/callback` to the web client's callback URLs (dev tfvars already do).
7. **Mobile**: `cd apps/mobile && cp .env.example .env.local`, fill it from `terraform output`
   (`EXPO_PUBLIC_WEB_URL` = the web app, used for listing editing), then `npx expo run:android`
   (or `ios`). Razorpay needs this dev build; Expo Go can browse but not pay.

## Local development

```bash
pip install "moto[server,dynamodb]==5.1.22"   # DynamoDB emulator with transaction support
npm ci
npm run typecheck && npm test        # 183 backend tests against moto, no AWS needed
npm run build                        # esbuild bundles in services/*/dist and lambdas/*/dist
cd apps/web && npm ci && npm test && npm run build    # 11 tests + production build
cd apps/mobile && npm ci && npx tsc --noEmit
```

## How a booking works

```
POST /v1/bookings (Idempotency-Key)
  1 one transaction: claim key + create booking + HOLD every night (15 min)   -> 409 if any night is taken
  2 Razorpay order, host share as an on-hold Route transfer (until check-out + 24h)
      fails? -> hold and key released, 502, client may retry with the same key
  3 app opens Razorpay Checkout with orderId
payment.captured webhook
  4 one transaction: booking CONFIRMED + nights BOOKED
      nights taken by someone else, booking cancelled, wrong amount, second payment?
      -> full refund with reverse_all, exactly once (AUTOREFUND#<paymentId> guard)
hold-expirer (every minute, 5 min grace) closes holds nobody paid for and lapses unanswered requests

Request to book: step 1 creates REQUESTED (24h hold, no order) -> host accepts -> PENDING_PAYMENT
with a 12h hold and the order -> steps 3-4 as above. Decline or lapse -> DECLINED, nights released.
```

Cancellation: guest refunds follow the listing's policy (`packages/shared/src/booking.ts`); host and
admin cancellations refund in full. Partial refunds reverse only the host's proportional share of the
transfer. A failed refund is recorded as `refundStatus: FAILED`; retry with
`POST /v1/admin/bookings/:id/retry-refund`. Check-in is 14:00 IST, check-out 11:00 IST.

## Pricing, GST and booking modes

`packages/shared/src/pricing.ts` is the one price calculation (search totals, `/v1/quote`, bookings):
nightly prices, extra-guest fee above `guestsIncluded`, weekly (7+ nights) or monthly (28+) discount,
cleaning fee, then GST on the whole stay: **5% when the value per night is up to ₹7,500, 18% above**
(rates from 22 Sep 2025). The guest sees the itemised breakdown before paying and on the trip.
Hosts set `minNights`/`maxNights`; search hides stays that break them and the quote explains why.

GST and the platform: a host with a GSTIN gets the tax in their payout and files it; for hosts without
one, the platform keeps the tax (`platformGstPaise`) and remits it as the e-commerce operator under
section 9(5). **Confirm this treatment with your CA before launch**; it is one switch in `splitStay`.

**Instant Book** (default on) books on payment. With it off, the guest sends a request with a note,
the nights are held for 24h, and the host accepts (guest then has 12h to pay) or declines.
Unanswered requests lapse via hold-expirer and count against the host's response rate.

**Superhost** (host-evaluator, daily 08:00 IST, Airbnb's criteria over the last 365 days): 10+ stays
(or 3+ stays and 100+ nights), rating 4.8+ (with 3+ reviews), under 1% host cancellations, and 90%+
of new conversations and requests answered within 24h. Shown on listings, cards and the host card.
"Identity verified" on a host means their Razorpay KYC is activated. Guest ID verification is not
built (it needs a vendor such as DigiLocker).

## Messaging

One thread per guest and listing (`/v1/threads`). Phone numbers, emails and links are masked
until the guest has a confirmed booking with that host. Clients poll `/v1/inbox/summary` (a cheap
version counter) and the notifier sends Expo push for new messages. Push needs `EAS_PROJECT_ID`
set when building the app (`eas init` prints it); without it push is off and polling still works.
Real-time sockets would need API Gateway WebSockets, which is outside the current stack.

Place search uses GeoNames data (CC BY 4.0, via the `cities.json` package); keep the attribution
the apps show. Regenerate with `npm run build:places -w services/search-svc`.

## Contracts other services must follow

- **Night items are sparse.** A missing `LISTING#<id> / NIGHT#<date>` item means FREE at the base price.
  Anything that writes nights must refuse to overwrite `HELD`/`BOOKED`, as listing-svc does.
- **Photos**: clients upload originals to `uploads/listings/<listingId>/<photoId>` (presigned POST);
  image-processor writes `listings/<listingId>/<photoId>/w{360,720,1280}.webp` a few seconds later.
  The apps show "Processing…" and retry until the rendition exists.
- **Hosts**: user-svc adds users to the Cognito `host` group and writes `USER#<id> / PROFILE` with
  `razorpayAccountStatus`; the webhook keeps that status current. listing-svc refuses to publish until
  it is `activated`. Clients must refresh tokens after onboarding to see the new group (both apps do).
- **Web sessions**: tokens live in httpOnly cookies; the browser calls the API through `/api/bff/v1/*`.
  Never link to `/auth/*` with a prefetching `<Link>` (a prefetch would start a new sign-in).

## Adding a service

Add it to `.github/services.json`, create its ECR repo (`var.services`), add a Pod Identity role in
`iam_pods.tf`, and copy one of the `gitops-seed/apps/*/*` folders. CI picks it up automatically.
