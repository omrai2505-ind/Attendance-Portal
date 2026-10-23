# Dynamic QR Attendance, GPS Geofencing, and Anti-Proxy Architecture

This document specifies the technical architecture, security mechanisms, verification policies, and integration details for the **Dynamic QR Code Attendance and GPS Location Verification System** for IIIT Dharwad.

---

## 1. Classroom Location Configuration & Geofencing

### 1.1 Teacher Workflow
When an instructor opens an attendance session:
1. **Explicit Geofence Setup**: The system does not assume coordinates. The teacher must review and confirm the classroom coordinates (`latitude`, `longitude`) and radius before the session opens.
2. **Browser Geolocation API Assistance**: A **"🧭 Detect My Current Location"** option requests high-accuracy coordinates (`enableHighAccuracy: true`, `timeout: 10000`, `maximumAge: 0`) and displays reported horizontal accuracy.
3. **Manual Override**: If geolocation is denied, unavailable, or imprecise indoors, teachers can manually input coordinates.
4. **Validation**:
   - Latitude: finite number in `[-90, 90]`.
   - Longitude: finite number in `[-180, 180]`.
   - Radius: finite positive number in `[1, 500]` meters (Default: `50` meters).
   - Reject missing or non-numeric values.

### 1.2 Geofence Formula & Conservative Policy
- **Haversine Distance**: Computed server-side using mean Earth radius $R = 6,371,000\text{ m}$:
  $$\Delta\sigma = 2 \arcsin \left( \sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos\phi_1\cos\phi_2\sin^2\left(\frac{\Delta\lambda}{2}\right)} \right)$$
  $$\text{distance} = R \cdot \Delta\sigma$$
- **Conservative Acceptance Rule**:
  $$\text{distanceMeters} + \text{accuracyMeters} \le \text{radiusMeters}$$
  If the student's reported uncertainty sphere extends outside the permitted boundary, the request is rejected with `LOCATION_OUT_OF_BOUNDS`.
- **Accuracy Ceiling**: If reported accuracy $> 25\text{ m}$ (configurable via `GPS_MAX_ACCURACY_METERS`), the request is rejected with `LOCATION_UNRELIABLE`.
- **Untrusted Client Inputs**: Client-provided booleans (e.g. `locationVerified: true` or `distanceMeters: 0`) are ignored; distance is calculated solely on the backend.

---

## 2. Dynamic Rotating QR Code Protocol

### 2.1 Cryptographic Design
- **Session Secret**: High-entropy 256-bit cryptographic secret (`crypto.randomBytes(32).toString('hex')`) generated when a session opens. The secret is marked `select: false` in Mongoose and is **never** sent to the client.
- **Time Windows**: Time is discretized into 15-second windows:
  $$\text{window} = \left\lfloor \frac{\text{nowMs}}{15000} \right\rfloor$$
- **HMAC-SHA256 Token**:
  $$\text{Token} = \text{HMAC-SHA256}(\text{qrSecret}, \text{"sessionId:window"})$$
- **Payload**:
  ```json
  {
    "sid": "<sessionId>",
    "w": 115200000,
    "t": "<64-character-hex-token>"
  }
  ```

### 2.2 Expiration & Timing Window Policy
- **Valid Windows**: The server accepts the current window (`currentWindow`) and the immediately preceding window (`currentWindow - 1`) to account for camera scan latency and network transmission delay.
- **Maximum Lifespan**: Bounded to $\approx 30\text{ seconds}$. Submissions with older windows are rejected with `INVALID_OR_EXPIRED_QR`.
- **Timing Safe Verification**: MAC tokens are compared using `crypto.timingSafeEqual` to eliminate timing side-channel attacks.
- **Lifecycle Invalidation**: When a teacher closes a session, `qrEnabled` is set to `false`, `qrSecret` is cleared, and subsequent attendance submissions are rejected with `SESSION_CLOSED`.

---

## 3. Server-Side Face Verification Integration

1. **Independent Verification**: Client booleans such as `{ verificationStatus: "verified" }` or `{ faceVerified: true }` are never trusted by themselves.
2. **Cryptographic Verification Token**:
   - Upon comparing the captured JPEG against the AES-256-GCM encrypted biometric template in MongoDB, the server issues a signed JWT (`verificationToken`).
   - The token is cryptographically signed with `JWT_SECRET`, valid for 5 minutes, and bound to:
     - `studentId`: must match the authenticated student.
     - `sessionId`: bound to the target session.
     - `identityStatus`: must be `'match'`.
     - `livenessStatus`: must not be `'fail'`.
     - `nonce`: random single-use identifier preventing token reuse.
3. **Biometric Data Safety**: Raw face images and raw biometric embeddings are never stored in attendance records. Only verification references and statuses are persisted.

---

## 4. Multi-Factor Atomic Attendance Submission

The student dashboard replaces direct attendance marking with a 3-step guided workflow:
1. **Scan QR**: Uses `html5-qrcode` to scan the instructor's projected rotating QR code.
2. **Acquire GPS**: Fetches fresh coordinates (`maximumAge: 0`, `enableHighAccuracy: true`).
3. **Face Check**: Executes biometric comparison and attaches the signed verification token.
4. **Backend Enforcement**:
   - Validates student role & active course enrollment.
   - Verifies session is open and configured with classroom coordinates.
   - Verifies dynamic QR token against session secret and window.
   - Computes Haversine distance and checks conservative geofence rule.
   - Verifies face verification token authenticity and student binding.
   - Enforces database uniqueness on `(sessionId, studentId)` to prevent duplicate or concurrent submission races.
   - Persists attendance evidence (`distanceMeters`, `gpsAccuracyMeters`, `locationVerified`, `qrVerified`, `networkRisk`).

---

## 5. Network Policy & Hotspot Compatibility

- **Default Behavior**: Campus Wi-Fi is **NOT required**. Students can connect via personal hotspots, 4G, 5G, or residential broadband (`CAMPUS_NETWORK_CHECK_ENABLED=false`).
- **Optional Campus Network Check**: If campus IT enables `CAMPUS_NETWORK_CHECK_ENABLED=true` and sets `CAMPUS_IP_RANGES`, incoming IPs are audited against campus subnets without breaking non-network verification.
- **Audit Logging**: Client IP and network risk signals are recorded in `AttendanceRecord.networkRisk` for post-event security auditing.

---

## 6. Residual Risks & Security Boundaries

1. **Browser GPS Spoofing**: Operating systems and developer tools allow virtual location simulation (e.g., GPS spoofing apps, Chrome DevTools Sensors). While conservative geofencing detects noisy signals, client-side GPS cannot prove physical presence on its own.
2. **Real-Time QR Relay**: A student physically present in the lecture hall could take a photo of the projected QR code and send it over messaging apps to a remote student. The 15-second rotation window limits this relay window, and the remote student would still fail the GPS geofence check.
3. **Biometric Presentation Attacks (Liveness)**: YuNet detection and SFace embeddings verify identity matching against enrolled templates. Without active 3D structured light or multi-frame interactive challenges, high-resolution photo or screen presentation attacks remain a risk that requires ongoing calibration.
