# Poke Java harness

Stubs of the Android and Telegram classes the injected `CrossgramPoke` helper
touches, plus a harness that drives the helper the way the client does:

- the feature query carries the conversation peer,
- an unanswered or rejected query keeps the menu untouched,
- a supported answer exposes the single-poke row and its burst rows,
- tapping them serializes `crossgram.sendPoke` exactly as the schema declares,
- a rejected account stops querying for good.

`tests/poke-java.e2e.test.ts` copies this tree, adds the helper the patcher
installs, compiles everything with `javac` and compares the harness report.
