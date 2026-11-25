# Firestore Security Specification

## Data Invariants
1. **Owner-Only Profile & PII Isolation**: A user can only read/write `/users/{userId}` and `/users/{userId}/private/account` when `request.auth.uid == userId` and `request.auth.token.email_verified == true`.
2. **No Self-Escalation of Plan**: A client creating `/users/{userId}` can only set `plan == 'free'` and cannot change `plan` on update (`incoming().plan == existing().plan`); authoritative Pro plan upgrades are verified server-side via Stripe Checkout + Firebase ID token verification.
3. **Sponsor Campaign Ownership**: Every `/sponsors/{sponsorId}` document requires `ownerId == request.auth.uid`, valid bounded strings, and `http(s)://` `ctaUrl`. Lists and reads strictly enforce `resource.data.ownerId == request.auth.uid`.
4. **User Link Ownership & Immutable Creation Fields**: Every `/userLinks/{linkId}` document requires `ownerId == request.auth.uid`, valid `code` (`3..30` chars), valid `targetUrl` (`<= 2048` chars), and immutable `createdAt`, `id`, and `ownerId`.
5. **Timestamp Integrity**: Every `create` sets `createdAt == request.time` and `updatedAt == request.time`; every `update` preserves `createdAt == existing().createdAt` and sets `updatedAt == request.time`.

## Adversarial ("Dirty Dozen") Payloads Verified Blocked
1. Unauthenticated read/write to `/users/u1` -> DENIED
2. Unverified email (`email_verified == false`) write to `/users/u1` -> DENIED
3. Self-escalation on `/users/u1` create with `plan: "pro"` -> DENIED
4. Self-escalation on `/users/u1` update changing `plan` from `"free"` to `"pro"` -> DENIED
5. Shadow field injection on `/users/u1` (`isAdmin: true`) -> DENIED
6. Cross-user PII read on `/users/otherUid/private/account` -> DENIED
7. Spoofed `ownerId` on `/sponsors/s1` create (`ownerId: "victimUid"`) -> DENIED
8. Oversized ID poisoning (`1500`-char `sponsorId`) -> DENIED
9. Unsafe scheme (`ctaUrl: "javascript:alert(1)"`) on `/sponsors/s1` -> DENIED
10. Blanket `list` query on `/sponsors` without `where('ownerId', '==', uid)` -> DENIED
11. Mutating `createdAt` or `ownerId` on `/userLinks/l1` update -> DENIED
12. Client-forged `updatedAt` timestamp not equal to `request.time` -> DENIED
