# New Dependency Adoption Checklist

Complete this before merging ANY new npm dependency (direct or transitive change).

- [ ] Published > 7 days ago (the gate enforces this; confirm intent).
- [ ] npm provenance / sigstore attestation present; source repo matches the package.
- [ ] Maintainer account age, 2FA, and history look legitimate; not a recent ownership transfer.
- [ ] Real download volume + a maintained issue tracker.
- [ ] Transitive dependency count is justified (each transitive dep is also risk).
- [ ] No open security advisories (`npm audit`, GitHub advisories, OSV).
- [ ] Does it require install scripts? If yes, scrutinize heavily or reject (we run `ignore-scripts`).
- [ ] Could the Node stdlib do this instead? Prefer stdlib.

Add the package with `scripts/add-dep.sh <pkg>` so the 7-day cutoff is applied at resolution.
