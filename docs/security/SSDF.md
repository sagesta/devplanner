# SSDF practice mapping (focused implementation)

This is a mapping of delivered practices to NIST SP 800-218 terminology, not certification or a complete compliance assessment.

- Prepare the organization: immutable implementation spec, project card, scoped workstream ownership, fixed acceptance gates.
- Protect software: preserve existing working-tree changes, no remote publish/deploy, runtime-only secrets and synthetic fixtures.
- Produce well-secured software: typed contracts, explicit account checks, revision/idempotency guards, peer review, parser properties, migration and failure-injection tests.
- Respond to vulnerabilities: dependency audit with raw results, compatible fixes, unresolved findings and required follow-up recorded without lowering thresholds.

Remaining: repository-wide static security scanning, history secret scan, complete ASVS verification, signed/reproducible release provenance and clean-machine acceptance. These must not be inferred from the focused tests.
