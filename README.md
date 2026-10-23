# IIIT Dharwad Attendance Portal

A web portal prototype for IIIT Dharwad institutional account registration,
sign-in, Google identity verification, and a role-aware landing page. The
attendance dashboard and attendance-taking capabilities described in the SRS
are planned requirements; they are not implemented in the current code.

## Current capabilities

- Register as a student or teacher using an `@iiitdwd.ac.in` email address.
- Require a strong password for password-based registration.
- Verify the institutional Google account before password sign-in.
- Secure Teacher Account Provisioning via `scripts/provision-teacher.js`.
- Teacher Dashboard (`teacher-dashboard.html`):
  - View aggregate attendance stats and real-time open sessions.
  - Create and manage courses and student rosters.
  - Start, open, and close attendance sessions.
  - View live attendance roster and perform manual attendance corrections.
- Student Dashboard (`student-dashboard.html`):
  - View enrolled courses and individual attendance percentage.
  - Submit attendance with automated face verification and GPS location.
- Protected REST API with JWT role-based access control (RBAC).
- Comprehensive end-to-end test suite (`server/tests/api.test.js`).

## Provisioning a Teacher Account

Because teacher accounts have elevated academic privileges, self-granting the teacher role through signup requires administrative verification. To provision or verify a teacher account:

```powershell
node scripts/provision-teacher.js --email prof.sharma@iiitdwd.ac.in --password "Prof@1234Secure"
```

## Provisioning or Resetting a Student Account

To create a new verified student account or reset the password of an existing student (e.g. `25bcs049@iiitdwd.ac.in` or `25bcs107@iiitdwd.ac.in`):

```powershell
node scripts/provision-student.js --email 25bcs049@iiitdwd.ac.in --password "Student@1234"
```


## Running the Automated Test Suite

Ensure the Node server is running at `http://localhost:3000`, then run:

```powershell
node --test server/tests/api.test.js
```

This runs 30 automated tests covering:
- Teacher authentication and verification
- Role-based access control (RBAC)
- Input validation and email domain enforcement
- Protected face verification endpoints
- Teacher dashboard, courses, and session lifecycle
- Attendance submission and manual corrections

## Requirements

- Node.js and npm
- A reachable MongoDB database
- A Google OAuth 2.0 application for Google sign-in and verification
- Python 3.10–3.13 and Git LFS for the optional face-verification evaluation

## Setup

The Node.js project is in `Attendence_project\server`, not the outer
`Attendance_Software` folder. From a PowerShell prompt currently at
`D:\webdev\Attendance_Software`, enter the commands below. Running `npm
install` from the outer folder fails because that folder does not contain a
`package.json`.

1. Change to the server directory and install the Node dependencies:

   ```powershell
   Set-Location .\Attendence_project\server
   npm install
   ```

2. Create the local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `.env` and set the environment variables:

   | Variable | Required | Description |
   | --- | --- | --- |
   | `PORT` | No | HTTP port; defaults to `3000`. |
   | `CLIENT_URL` | No | Allowed client origin for CORS; defaults to `http://localhost:3000`. |
   | `MONGO_URI` | Yes | MongoDB connection URI. |
   | `JWT_SECRET` | Yes | Secret used to sign and verify JWTs. |
   | `SESSION_SECRET` | Yes | Secret used to sign Express session cookies. |
   | `GOOGLE_CLIENT_ID` | For Google flows | Google OAuth client ID. |
   | `GOOGLE_CLIENT_SECRET` | For Google flows | Google OAuth client secret. |
   | `FACE_SERVICE_TOKEN` | For face evaluation | Random shared secret; must match `inference/.env`. |
   | `FACE_TEMPLATE_ENCRYPTION_KEY` | For face evaluation | 32-byte AES key as 64 hexadecimal characters. |
   | `FACE_MATCH_THRESHOLD` | For face evaluation | Provisional SFace threshold; not calibrated for IIIT Dharwad. |

   Use private, randomly generated values for both secrets. Do not commit
   `server/.env` or share its values.

4. To enable Google sign-in and finish account verification, create a
   **Web application** OAuth client in Google Cloud Console under
   **APIs & Services → Credentials**. Configure:

   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI:

   ```text
   http://localhost:3000/api/auth/google/callback
   ```

   Copy the generated client ID and client secret into `server/.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

   If the OAuth consent screen is in testing mode, add the Google account
   used for testing as a test user. Without these credentials, the server
   prints `Google OAuth disabled`; registration may create a pending account,
   but Google verification/sign-in cannot complete. Never commit or share the
   real client secret.

5. Start (or restart) the server from the same `server` directory so it loads
   the updated `.env`:

   ```powershell
   npm start
   ```

   For development with automatic restarts:

   ```powershell
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in a browser. The root
   page redirects to sign-in unless a token is already stored.

## Using the portal

### Optional face-verification evaluation service

The face component runs only for verified student accounts. Keep its internal
inference service bound to localhost; do not expose it publicly.

1. From the repository root, download the model files from a pinned OpenCV
   Zoo revision using Git LFS:

   ```powershell
   .\inference\download-models.ps1
   ```

   This checks out revision `47534e27c9851bb1128ccc0102f1145e27f23f98` and
   downloads YuNet `face_detection_yunet_2023mar.onnx` and SFace
   `face_recognition_sface_2021dec.onnx`. Their upstream model directories
   state MIT (YuNet) and Apache-2.0 (SFace); review the upstream licenses and
   model documentation before deployment.

2. Create and install the Python environment:

   ```powershell
   Set-Location .\inference
   py -3.13 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   Copy-Item .env.example .env
   ```

3. Set `FACE_SERVICE_TOKEN` to the same randomly generated value in both
   `server/.env` and `inference/.env`. Generate a template-encryption key for
   `server/.env` with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Store these values privately. Losing the encryption key makes saved face
   references unusable. Never commit either `.env` file.

4. In a separate PowerShell window, start the service from the `inference`
   directory:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
   ```

5. Start the Node server as described in Setup. Missing models or secrets
   cause face endpoints to fail explicitly; they never return a successful
   verification fallback.

See [docs/face-verification.md](./docs/face-verification.md) for integration,
API details, evaluation limitations, and tests.

### Create an account

1. Select **Create Account** from the sign-in page.
2. Choose the student or teacher role.
3. Enter an `@iiitdwd.ac.in` email and a password with at least eight
   characters, including uppercase and lowercase letters, a number, and a
   special character.
4. Complete Google verification using the same institutional email address.

### Sign in

1. Select the relevant student or faculty role on the sign-in form.
2. Sign in with the verified institutional account. The server also exposes a
   Google sign-in route, but the current sign-in page does not include a
   Google sign-in button.
3. The welcome page displays the account name and role. Use **Sign Out** to
   clear the local sign-in token.

Google identity verification is required once during account setup. After the
OAuth callback confirms the matching institutional email, the server saves
`isVerified: true` and the linked Google account in MongoDB, so later password
sign-ins do not require another Google verification.

The role selection is currently used during account creation and Google
sign-in. The existing dashboard does not yet provide different student and
teacher attendance workflows.

## HTTP API

The current API routes are mounted under `/api/auth`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create an account pending Google verification. |
| `POST` | `/api/auth/signin` | Sign in with a verified account and password. |
| `GET` | `/api/auth/google?role=student` | Start Google sign-in; `role` may be `student` or `teacher`. |
| `GET` | `/api/auth/google/verify?email=...` | Start Google verification for the submitted email. |
| `GET` | `/api/auth/google/callback` | OAuth callback configured with Google. |
| `GET` | `/api/auth/me` | Return the current user; requires `Authorization: Bearer <token>`. |

## Project layout

The face-verification routes are mounted separately under
`/api/face-verification` and require a verified student JWT:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/face-verification/enrollment` | Return the authenticated student's enrollment state. |
| `POST` | `/api/face-verification/preview` | Submit one JPEG for face detection; the image is not persisted. |
| `POST` | `/api/face-verification/enrollment` | Enroll two or three JPEG samples with explicit consent. |
| `POST` | `/api/face-verification/verify` | Compare a JPEG with the authenticated student's encrypted reference. |
| `DELETE` | `/api/face-verification/enrollment` | Delete the authenticated student's face reference. |

These endpoints do not create or update attendance records.

```text
public/                 Static HTML, CSS, images, and browser JavaScript
server/
  config/               MongoDB and Passport configuration
  face-verification/    Embedding, encryption, inference-client, and rate-limit helpers
  middleware/           JWT authentication middleware
  models/               Mongoose models
  routes/               Express API routes
  server.js             Express application entry point
  .env.example          Local configuration template
inference/
  app/                  Python/OpenCV inference and liveness interface
  tests/                Inference unit tests
  download-models.ps1   Pinned model-weight downloader
docs/                   Face component setup, API, and limitations
README.md               Setup and usage guide
SRS.md                  Software requirements specification
```

## Attendance feature status

The proposed attendance system is specified in [SRS.md](./SRS.md). It covers
separate student and teacher portals and attendance verification using visual
checks, GPS, and trusted classroom Wi-Fi/network evidence. Only an
evaluation-only face identity component is present; anti-spoof/liveness, GPS,
trusted-network verification, attendance sessions, and the remaining
attendance workflow are not implemented.

## Troubleshooting

- **MongoDB connection fails:** Check that MongoDB is reachable and
  `MONGO_URI` is correct.
- **Google OAuth fails:** Confirm the OAuth client credentials and exact
  callback URI, and use an institutional Google account.
- **Google sign-in is unavailable:** Set `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET` in `server/.env`, then restart the server.
- **Sign-in redirects repeatedly:** Sign in again; the browser token may be
  missing, invalid, or expired.
