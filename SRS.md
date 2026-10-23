# Software Requirements Specification

## 1. Introduction

### 1.1 Purpose

This document specifies the current authentication prototype and the proposed
requirements for a role-aware attendance portal for IIIT Dharwad. It is
intended for stakeholders, developers, testers, and administrators.

### 1.2 Scope

The software will provide:

- A student portal for viewing personal attendance, class sessions, and
  verification outcomes.
- A teacher portal for managing class sessions, initiating attendance,
  reviewing attendance records, and resolving exceptions.
- Attendance verification that combines an enrolled student's visual
  verification with the student's location and evidence that the device is
  connected through the classroom's trusted network.
- Institutional account authentication and role-based access.

The repository contains account registration, sign-in, Google verification,
JWT-protected current-user lookup, and a welcome page. It also contains an
evaluation-only face identity component using YuNet detection and SFace
embeddings. Its similarity threshold is not calibrated for the institution,
its liveness interface always returns inconclusive, and it cannot produce a
production-verified result or mark attendance. Student and teacher attendance
functions, anti-spoof/liveness inference, GPS checks, and classroom Wi-Fi
verification are **not implemented**. Dashboard figures are static sample
content and must not be treated as real attendance records.

### 1.3 Definitions

| Term | Definition |
| --- | --- |
| CNN | Convolutional neural network used as part of the visual verification pipeline. |
| Liveness / presentation-attack detection | Check intended to distinguish a live person from a photo, replay, or other spoof attempt. It is not guaranteed by face matching alone. |
| GPS evidence | Device-reported coordinates and accuracy used to evaluate proximity to the scheduled classroom. |
| Trusted classroom network | Institution-managed Wi-Fi/network evidence verified by a trusted server-side or administrator-managed mechanism. |
| Attendance attempt | A student's request to be marked present for a particular scheduled class session. |
| Exception | A failed or unavailable automated verification requiring teacher/admin review. |

### 1.4 References

- Repository usage and local setup: [README.md](./README.md)
- Current implementation: Express, MongoDB/Mongoose, Passport Google OAuth,
  and JWT authentication.

## 2. Overall description

### 2.1 Product perspective

The portal is a browser-based client served by an Express application. The
current application persists user accounts in MongoDB. The proposed attendance
capabilities will require additional attendance/session data, verification
services, and authorized access to camera, location, and institution-managed
network evidence.

### 2.2 User classes

| User | Description |
| --- | --- |
| Student | Signs in, checks class/session information, submits attendance evidence, and reviews their own attendance and exceptions. |
| Teacher | Creates or manages class sessions, opens/closes attendance, views records for assigned classes, and reviews flagged attempts. |
| Administrator | Manages institutional accounts, roles, class/network configuration, model and policy settings, audit access, and escalated exceptions. |

Teacher and administrator permissions must be granted and enforced by the
server. A role selected in a browser form must not itself grant elevated access.

### 2.3 Operating environment

- Modern desktop or mobile browser with JavaScript enabled.
- Express/Node.js application and MongoDB database.
- HTTPS for deployed use and for browser camera/location permission workflows.
- A configured Google OAuth client for the existing Google authentication
  flows.
- Institution-managed classroom network infrastructure for trustworthy
  network verification.
- A separately evaluated and deployed CNN-based verification service/model
  before automated visual attendance is enabled.

### 2.4 Constraints and assumptions

1. Only institutional identities in the approved `@iiitdwd.ac.in` domain may
   create accounts or authenticate.
2. GPS availability and accuracy vary by device and indoor conditions.
   Location permission denial or inaccurate readings must not be silently
   represented as successful verification.
3. Browsers generally do not expose a reliable Wi-Fi hardware MAC/BSSID to
   web applications; device MAC addresses may also be randomized. Therefore,
   the implementation must **not** rely on a client-provided MAC address as
   proof of classroom presence.
4. Wi-Fi evidence must use an institution-approved, server-verifiable method,
   such as managed access-point/network attestation or an authenticated
   network gateway. Whether AP BSSID, network identity, or another trusted
   signal is available must be confirmed with campus IT.
5. The CNN must not be considered a complete anti-proxy solution without
   appropriate liveness/presentation-attack controls and an independent
   identity-binding process.
6. The exact CNN architecture, thresholds, data retention periods, location
   radius, and exception/appeal policy require institutional approval before
   production.

## 3. Functional requirements

### 3.1 Identity, authentication, and authorization

- **FR-001:** The system shall allow a user to register with an approved
  institutional email address and a supported role.
- **FR-002:** The system shall verify control of the institutional account
  through the configured identity provider before enabling the account.
- **FR-003:** The system shall authenticate users and protect authenticated
  endpoints.
- **FR-004:** The system shall authorize every protected operation on the
  server according to the authenticated user's role and class assignment.
- **FR-005:** A student shall only read their own attendance and verification
  information.
- **FR-006:** A teacher shall only manage sessions and view records for classes
  they are assigned to, unless an administrator grants broader authority.
- **FR-007:** The system shall record auditable changes to roles, sessions,
  attendance decisions, and exception resolutions.

### 3.2 Student portal

- **FR-008:** The student portal shall show the student's scheduled classes
  and whether each session is open for attendance.
- **FR-009:** The student shall be able to initiate one attendance attempt for
  an eligible open class session.
- **FR-010:** Before collecting camera or location evidence, the portal shall
  explain its purpose and request the applicable browser permissions.
- **FR-011:** The portal shall show each attendance attempt's result and
  reason category, such as accepted, pending review, or rejected.
- **FR-012:** The student shall be able to view their recorded attendance by
  class and date and report a suspected error through the approved exception
  process.
- **FR-013:** The system shall prevent a student from submitting attendance
  for a session outside its configured open/close window, except through an
  authorized correction process.

### 3.3 Teacher portal

- **FR-014:** The teacher shall be able to view and manage only assigned
  courses/classes.
- **FR-015:** The teacher shall be able to create or select a scheduled
  session and set its attendance window and assigned classroom.
- **FR-016:** The teacher shall be able to open and close a session and see
  its attendance status.
- **FR-017:** The teacher shall be able to view the roster and the result of
  each student's attendance attempt for an assigned session.
- **FR-018:** The teacher shall be able to review flagged or incomplete
  attempts and record an override decision with a reason; overrides shall be
  auditable.
- **FR-019:** The system shall distinguish automatically verified records
  from teacher-approved corrections.
- **FR-020:** The teacher shall be able to export or report attendance only
  for authorized classes and within administrator-approved access controls.

### 3.4 Attendance verification: CNN, GPS, and trusted Wi-Fi

- **FR-021:** For an open session, the system shall bind each attendance
  attempt to the authenticated student, scheduled session, server timestamp,
  and a unique attempt identifier.
- **FR-022:** The system shall capture a live camera sample only after
  informing the student and obtaining camera permission. Raw image/video
  handling shall follow approved privacy and retention policies.
- **FR-023:** The visual verification service shall use an institution-approved
  CNN-based face-recognition model to compare the submitted live sample
  against the authenticated student's securely enrolled facial reference.
- **FR-024:** The visual verification pipeline shall include a separately
  evaluated liveness/presentation-attack check. A CNN match alone shall not
  be treated as proof that the student is physically present.
- **FR-025:** The visual service shall return a structured outcome (pass,
  fail, or indeterminate), a calibrated confidence/risk score, and a reason
  code. Attendance shall not be accepted solely on an uncalibrated model
  score.
- **FR-026:** The client shall request GPS permission and submit coordinates,
  reported accuracy, and capture time over a protected channel. The server
  shall validate the evidence against the configured classroom location and
  an administrator-approved radius and freshness limit.
- **FR-027:** The system shall validate classroom Wi-Fi/network presence using
  the institution-approved trusted network mechanism. Client-reported SSID
  or MAC/BSSID alone shall not constitute trusted proof.
- **FR-028:** An attendance attempt shall be automatically accepted only
  when the session is eligible and the required visual/liveness, GPS, and
  trusted-network checks all pass their approved policies.
- **FR-029:** If any required signal is denied, unavailable, stale,
  inaccurate, inconsistent, or indeterminate, the attempt shall be marked
  pending review or rejected according to the institution-approved policy;
  the system shall not fabricate a successful check or silently waive a
  missing signal.
- **FR-030:** The system shall rate-limit repeated attempts and record
  sufficient audit metadata to detect duplicate submissions and support
  investigation, without retaining unnecessary biometric or location data.
- **FR-031:** Every automatic decision shall retain its session, timestamp,
  rule/model version, outcome, and reason codes for authorized audit. It shall
  not expose another student's evidence to a student or unauthorized teacher.

### 3.5 Administration and configuration

- **FR-032:** An administrator shall be able to configure class schedules,
  classrooms, approved network-verification settings, verification policies,
  and authorized user/class assignments.
- **FR-033:** An administrator shall be able to manage model version
  activation and rollback, and inspect operational health without exposing
  biometric data unnecessarily.
- **FR-034:** The system shall maintain an auditable mechanism for correcting
  erroneous attendance records and handling student disputes.

## 4. External interface requirements

### 4.1 User interface

- The interface shall clearly distinguish the student and teacher portals.
- Each role shall see only the functions and records authorized for it.
- The interface shall explain camera, GPS, and network checks before an
  attendance attempt and provide understandable status/reason messages.
- The interface shall support keyboard navigation and responsive mobile and
  desktop layouts.

### 4.2 Hardware and browser interfaces

- Camera capture and GPS access shall use browser permission APIs over HTTPS
  in deployed environments.
- No browser API assumption shall be made that exposes a stable Wi-Fi MAC
  address. Trusted network verification is an integration with campus-managed
  infrastructure, not a client-side claim.

### 4.3 Software interfaces

- Authentication and account persistence shall integrate with the existing
  Express, Passport, JWT, and MongoDB components.
- Attendance records and session management shall be exposed through
  authenticated, role-authorized server APIs.
- The visual model shall be accessed through a protected service contract
  that defines input constraints, result schema, timeouts, versioning, and
  failure behavior.

## 5. Non-functional requirements

- **NFR-001 Security:** Production traffic shall use HTTPS. Secrets shall be
  stored outside source control. Sensitive endpoints shall enforce
  authentication, authorization, input validation, and rate limiting.
- **NFR-002 Privacy:** Camera, biometric, and location data shall be collected
  only for disclosed attendance purposes and according to institutionally
  approved consent, access, retention, and deletion policies.
- **NFR-003 Data protection:** Biometric references and sensitive evidence
  shall be encrypted in transit and at rest, access-controlled, and excluded
  from routine logs.
- **NFR-004 Reliability:** A timeout or outage in the model or network
  verification service shall produce an explicit indeterminate/exception
  outcome, never an automatic success.
- **NFR-005 Performance:** Under an institution-defined expected peak load,
  the system shall return an attendance outcome or pending status within a
  target response time to be agreed before deployment.
- **NFR-006 Auditability:** Access to attendance data, automated decisions,
  manual overrides, and configuration changes shall be attributable and
  timestamped.
- **NFR-007 Accessibility:** Core student and teacher flows shall be usable
  with keyboard navigation and assistive technologies, and provide an
  accessible alternative for users unable to complete an automated check.
- **NFR-008 Fairness and review:** Model performance shall be evaluated on
  representative data for false acceptance and false rejection. A student
  shall have a documented human review route for a disputed or inaccessible
  automated check.
- **NFR-009 Maintainability:** Attendance policy and model versions shall be
  identifiable in audit data and support deployment and rollback without
  changing historical decisions.

## 6. Data requirements

The proposed implementation will need records for:

- Users, roles, and class/course assignments.
- Scheduled class sessions and their authorized classrooms/network policy.
- Attendance attempts, status, reason codes, timestamps, and decision source.
- Verification outcomes and relevant policy/model version metadata.
- Teacher/admin corrections and audit events.

The system should store verification outcomes and minimal evidence needed for
auditing rather than raw camera recordings or precise location histories.
Specific fields, encryption, retention duration, deletion, and consent policy
must be approved before data collection is enabled.

## 7. Key acceptance criteria

1. An unverified account cannot access authenticated portal functions.
2. A student cannot read another student's attendance or create/update a
   teacher's session.
3. A teacher cannot access an unassigned class's roster or records.
4. An attendance attempt outside an open session window is not automatically
   accepted.
5. A successful attempt requires the approved CNN visual/liveness outcome,
   valid fresh GPS evidence inside the configured classroom boundary, and
   server-verifiable trusted classroom network evidence.
6. Missing or failed required evidence never produces a present/accepted
   attendance result; it produces the configured rejection or review state
   with a reason.
7. A teacher override includes the authenticated actor, timestamp, and
   required reason and is distinguishable from an automatic decision.
8. Dashboard counts and percentages are computed from persisted authorized
   attendance records, not hard-coded sample values.
9. Biometric and location data are inaccessible to unauthorized users and
   handled according to the approved retention policy.

## 8. Open decisions before production implementation

- Campus IT must confirm the trusted Wi-Fi/network verification integration
  available in the classrooms; a client-side Wi-Fi name or device MAC is not
  sufficient.
- The institution must select the model provider/architecture, enrollment
  process, liveness method, calibrated thresholds, and error-rate criteria.
- The institution must approve the classroom GPS radius, GPS accuracy and
  freshness thresholds, and policy for indoor GPS failures.
- The institution must approve consent, alternatives, appeals, access,
  retention, deletion, and incident-response policies for biometric and
  location information.
- Peak-load targets, service availability objectives, and attendance
  correction rules must be defined with stakeholders.

Until these decisions are approved and the corresponding features are
implemented and tested, this repository must be treated as an authentication
prototype, not a production attendance tracking system.
