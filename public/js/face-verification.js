(function () {
  'use strict';

  const stateMessages = {
    starting: 'Requesting camera access...',
    camera: 'Center your face in the frame and use even lighting.',
    unsupported: 'This browser does not support camera access.',
    permission: 'Camera permission was denied. Allow camera access in browser settings, then retry.',
    unavailable: 'No usable camera was found. Connect or enable a camera and retry.',
    no_face: 'No face detected. Move into the frame and improve the lighting.',
    multiple_faces: 'More than one face detected. Make sure only you are in the frame.',
    quality_insufficient: 'Face quality is insufficient. Move closer and face the camera.',
    ready: 'Face detected. You are ready to capture.',
    idle: 'Camera is off. Start it when you are ready.',
    service: 'Face verification service is unavailable. Try again later.',
    network: 'Could not contact the verification service. Check your connection and retry.'
  };

  class FaceVerificationComponent {
    constructor(container, options) {
      this.container = container;
      this.options = options;
      this.stream = null;
      this.trackEndHandlers = [];
      this.pollTimer = null;
      this.enrolled = false;
      this.enrollmentLoaded = false;
      this.busy = false;
      this.cameraStarting = false;
      this.pollingPaused = false;
      this.destroyed = false;
      this.lastDetection = null;
      this.cameraRequestController = null;
      this.abortController = new AbortController();
      this.render();
      this.bindEvents();
    }

    render() {
      this.container.innerHTML = `
        <section class="fv-card" aria-labelledby="fv-title">
          <div class="fv-heading">
            <p class="mb-1 text-xs font-bold uppercase tracking-wider text-blue-700">Biometric Attendance</p>
            <h2 id="fv-title" class="text-lg font-extrabold text-slate-900">Face Identity Verification</h2>
            <p class="mt-1 text-sm text-slate-600">Secure facial recognition attendance verification.</p>
          </div>
          <div class="fv-camera-wrap">
            <video class="fv-video" autoplay playsinline muted aria-label="Live camera preview"></video>
            <canvas class="fv-overlay" aria-hidden="true"></canvas>
            <div class="fv-camera-placeholder">Camera is off. Choose Start camera when you are ready.</div>
          </div>
          <p class="fv-status" data-kind="neutral" role="status" aria-live="polite"></p>
          <p class="fv-progress" hidden></p>
          <p class="fv-result" aria-live="polite"></p>
          <label class="fv-consent">
            <input class="fv-consent-check" type="checkbox">
            <span class="fv-consent-copy"></span>
          </label>
          <p class="fv-privacy">Your camera starts only after you choose Start camera. Face templates are securely encrypted and processed locally for instant attendance verification.</p>
          <div class="fv-controls">
            <button class="fv-button fv-start" type="button">Start camera</button>
            <button class="fv-button fv-stop" type="button" disabled>Stop camera</button>
            <button class="fv-button fv-button-primary fv-action" type="button" disabled>Check status</button>
            <button class="fv-button fv-retry" type="button" hidden>Retry</button>
          </div>
        </section>`;

      this.video = this.container.querySelector('.fv-video');
      this.canvas = this.container.querySelector('.fv-overlay');
      this.placeholder = this.container.querySelector('.fv-camera-placeholder');
      this.status = this.container.querySelector('.fv-status');
      this.progress = this.container.querySelector('.fv-progress');
      this.result = this.container.querySelector('.fv-result');
      this.consent = this.container.querySelector('.fv-consent');
      this.consentCheckbox = this.container.querySelector('.fv-consent-check');
      this.consentCopy = this.container.querySelector('.fv-consent-copy');
      this.startButton = this.container.querySelector('.fv-start');
      this.stopButton = this.container.querySelector('.fv-stop');
      this.actionButton = this.container.querySelector('.fv-action');
      this.retryButton = this.container.querySelector('.fv-retry');

      this.consentCopy.textContent = 'Loading your enrollment state before enabling camera access.';
      this.startButton.disabled = true;
      this.setStatus('idle');
    }

    bindEvents() {
      this.handlers = {
        start: () => this.startCamera(),
        stop: () => this.stopCamera(),
        action: () => this.enrolled ? this.verify() : this.enroll(),
        retry: () => this.retry(),
        consentChange: () => {
          if (!this.consentCheckbox.checked && (this.stream || this.cameraStarting)) {
            this.stopCamera(true);
            this.setStatus('idle', 'Consent withdrawn. The camera has been stopped.', 'neutral');
          }
        },
        pagehide: () => this.destroy()
      };
      this.startButton.addEventListener('click', this.handlers.start);
      this.stopButton.addEventListener('click', this.handlers.stop);
      this.actionButton.addEventListener('click', this.handlers.action);
      this.retryButton.addEventListener('click', this.handlers.retry);

      this.consentCheckbox.addEventListener('change', this.handlers.consentChange);
      window.addEventListener('pagehide', this.handlers.pagehide, { signal: this.abortController.signal });
      this.loadEnrollment();
    }

    setStatus(state, detail, kind) {
      const message = detail || stateMessages[state] || 'Face verification status updated.';
      this.status.textContent = message;
      this.status.dataset.kind = kind || (state === 'service' || state === 'network' ? 'error' : 'neutral');
      if (typeof this.options.onStatusChange === 'function') {
        this.options.onStatusChange({ state, message });
      }
    }

    async api(path, options) {
      const token = typeof this.options.getToken === 'function'
        ? this.options.getToken()
        : localStorage.getItem('token');
      const response = await fetch(`/api/face-verification${path}`, {
        ...options,
        headers: {
          ...(options && options.headers),
          Authorization: `Bearer ${token || ''}`
        },
        signal: options && options.signal ? options.signal : this.abortController.signal
      });
      let data;
      try {
        data = await response.json();
      } catch (_error) {
        throw new Error('INVALID_SERVER_RESPONSE');
      }
      if (!response.ok) {
        const error = new Error(data.reasonCode || 'REQUEST_FAILED');
        error.data = data;
        error.status = response.status;
        throw error;
      }
      return data;
    }

    async loadEnrollment() {
      try {
        const data = await this.api('/enrollment');
        this.enrolled = data.enrolled;
        this.enrollmentLoaded = true;
        this.retryButton.hidden = true;
        this.updateEnrollmentControls();
        this.setStatus('idle', this.enrolled
          ? 'Face reference is enrolled. Start the camera to run an identity comparison.'
          : stateMessages.idle);
        if (typeof this.options.onEnrollmentLoaded === 'function') {
          this.options.onEnrollmentLoaded(data);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          this.setStatus('service', error.data ? error.data.message : stateMessages.service, 'error');
          this.retryButton.hidden = false;
        }
      }
    }

    updateEnrollmentControls() {
      this.consentCopy.textContent = this.enrolled
        ? 'I consent to capturing temporary webcam frames for facial identity verification to mark attendance. Images are processed locally and not stored.'
        : 'I consent to capturing temporary webcam frames to create an encrypted biometric template for attendance. Images are processed locally and not stored.';
      this.startButton.disabled =
        !this.enrollmentLoaded || this.busy || this.cameraStarting || Boolean(this.stream);
      this.actionButton.textContent = this.enrolled ? 'Verify identity' : 'Enroll face reference';
      this.actionButton.disabled = !this.stream || this.busy || !this.enrollmentLoaded;
    }

    async startCamera() {
      if (this.destroyed || this.stream || this.cameraStarting) return;
      if (!this.consentCheckbox.checked) {
        this.setStatus('error', 'Please consent to temporary camera-image processing before starting the camera.', 'error');
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.setStatus('unsupported', stateMessages.unsupported, 'error');
        return;
      }

      this.cameraStarting = true;
      this.startButton.disabled = true;
      this.setStatus('starting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });
        if (this.destroyed || !this.consentCheckbox.checked) {
          stream.getTracks().forEach((track) => track.stop());
          this.cameraStarting = false;
          this.startButton.disabled = !this.enrollmentLoaded;
          if (!this.destroyed) {
            this.setStatus('idle', 'Consent withdrawn. The camera was not started.', 'neutral');
          }
          return;
        }
        this.cameraStarting = false;
        this.stream = stream;
        this.stream.getTracks().forEach((track) => {
          const handleEnded = () => {
            if (!this.destroyed && this.stream) {
              this.stopCamera();
              this.setStatus('unavailable', 'The camera disconnected. Reconnect it and start the camera again.', 'error');
            }
          };
          track.addEventListener('ended', handleEnded);
          this.trackEndHandlers.push([track, handleEnded]);
        });
        this.video.srcObject = this.stream;
        await this.video.play();
        this.placeholder.hidden = true;
        this.stopButton.disabled = false;
        this.updateEnrollmentControls();
        this.setStatus('camera');
        this.scheduleDetection();
      } catch (error) {
        if (this.stream) {
          this.trackEndHandlers.forEach(([track, handler]) => {
            track.removeEventListener('ended', handler);
          });
          this.trackEndHandlers = [];
          this.stream.getTracks().forEach((track) => track.stop());
        }
        this.stream = null;
        this.video.srcObject = null;
        this.placeholder.hidden = false;
        this.cameraStarting = false;
        this.startButton.disabled = !this.enrollmentLoaded;
        this.consentCheckbox.checked = false;
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
          this.setStatus('permission', stateMessages.permission, 'error');
        } else if (error.name === 'NotFoundError' || error.name === 'NotReadableError') {
          this.setStatus('unavailable', stateMessages.unavailable, 'error');
        } else {
          this.setStatus('unavailable', 'Camera could not be started. Check browser permissions and retry.', 'error');
        }
      }
    }

    stopCamera(preserveStatus) {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.cameraRequestController) {
        this.cameraRequestController.abort();
        this.cameraRequestController = null;
      }
      if (this.stream) {
        this.trackEndHandlers.forEach(([track, handler]) => {
          track.removeEventListener('ended', handler);
        });
        this.trackEndHandlers = [];
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      this.video.srcObject = null;
      this.placeholder.hidden = false;
      this.consentCheckbox.checked = false;
      this.canvas.getContext('2d').clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.stopButton.disabled = true;
      this.startButton.disabled = this.busy || this.cameraStarting || !this.enrollmentLoaded;
      this.actionButton.disabled = true;
      this.pollingPaused = true;
      if (!this.destroyed && !preserveStatus) this.setStatus('idle');
    }

    captureJpeg() {
      if (!this.video.videoWidth || !this.video.videoHeight) {
        return Promise.reject(new Error('CAMERA_NOT_READY'));
      }
      const scale = Math.min(1, 640 / this.video.videoWidth);
      const capture = document.createElement('canvas');
      capture.width = Math.round(this.video.videoWidth * scale);
      capture.height = Math.round(this.video.videoHeight * scale);
      capture.getContext('2d').drawImage(this.video, 0, 0, capture.width, capture.height);
      return new Promise((resolve, reject) => {
        capture.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('IMAGE_CAPTURE_FAILED'));
        }, 'image/jpeg', 0.82);
      });
    }

    async pollDetection() {
      if (!this.stream || this.busy || this.destroyed) return;
      let requestController = null;
      try {
        const image = await this.captureJpeg();
        const form = new FormData();
        form.append('capture', image, 'capture.jpg');
        form.append('consent', 'true');
        requestController = new AbortController();
        this.cameraRequestController = requestController;
        const data = await this.api('/preview', {
          method: 'POST',
          body: form,
          signal: requestController.signal
        });
        this.retryButton.hidden = true;
        this.drawBounds(data);
        this.lastDetection = data.state;
        if (data.state === 'ready') {
          this.setStatus('ready', `Face detected. Detection took ${data.latencyMs} ms.`);
          this.actionButton.disabled = this.busy || !this.enrollmentLoaded;
        } else {
          this.setStatus(data.state, stateMessages[data.state] || 'Face detection returned an unsupported state.');
          this.actionButton.disabled = true;
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          this.actionButton.disabled = true;
          this.drawBounds(null);
          this.setStatus('service', error.data ? error.data.message : stateMessages.network, 'error');
          this.retryButton.hidden = false;
          this.pollingPaused = true;
        }
      } finally {
        if (this.cameraRequestController === requestController) {
          this.cameraRequestController = null;
        }
        if (this.stream && !this.destroyed && !this.pollingPaused) {
          this.pollTimer = setTimeout(() => this.pollDetection(), 2200);
        }
      }
    }

    scheduleDetection() {
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.pollingPaused = false;
      this.pollTimer = setTimeout(() => this.pollDetection(), 250);
    }

    drawBounds(data) {
      const context = this.canvas.getContext('2d');
      this.canvas.width = this.video.videoWidth || 640;
      this.canvas.height = this.video.videoHeight || 480;
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!data || !data.bounds || !data.image || !data.image.width) return;
      const scaleX = this.canvas.width / data.image.width;
      const scaleY = this.canvas.height / data.image.height;
      context.strokeStyle = '#22c55e';
      context.lineWidth = Math.max(2, this.canvas.width / 240);
      context.strokeRect(
        data.bounds.x * scaleX,
        data.bounds.y * scaleY,
        data.bounds.width * scaleX,
        data.bounds.height * scaleY
      );
    }

    async collectSamples(count) {
      const samples = [];
      for (let index = 0; index < count; index += 1) {
        if (!this.stream || !this.consentCheckbox.checked) {
          const error = new Error('Consent withdrawn during capture.');
          error.name = 'AbortError';
          throw error;
        }
        this.progress.textContent = `Capturing sample ${index + 1} of ${count}...`;
        samples.push(await this.captureJpeg());
        if (index + 1 < count) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return samples;
    }

    async enroll() {
      if (!this.consentCheckbox.checked) {
        this.setStatus('error', 'Please provide consent before creating a face reference.', 'error');
        return;
      }
      if (this.lastDetection !== 'ready') {
        this.setStatus('quality_insufficient', 'Wait until one suitable face is detected before enrolling.', 'error');
        return;
      }

      this.setBusy(true, 'Preparing face-reference samples...');
      try {
        const samples = await this.collectSamples(3);
        const form = new FormData();
        samples.forEach((sample) => form.append('samples', sample, 'sample.jpg'));
        form.append('consent', 'true');
        if (!this.consentCheckbox.checked) return;
        const controller = new AbortController();
        this.cameraRequestController = controller;
        const data = await this.api('/enrollment', {
          method: 'POST',
          body: form,
          signal: controller.signal
        });
        this.enrolled = data.enrolled;
        this.consentCheckbox.checked = false;
        this.updateEnrollmentControls();
        this.result.textContent =
          'Encrypted face reference saved successfully! You can now verify your face to mark attendance.';
        this.setStatus('ready', 'Enrollment complete! Ready for attendance verification.', 'success');
        if (typeof this.options.onEnrolled === 'function') {
          this.options.onEnrolled(data);
        }
      } catch (error) {
        this.showRequestError(error);
      } finally {
        this.setBusy(false);
        this.stopCamera(true);
      }
    }

    async verify() {
      if (!this.consentCheckbox.checked) {
        this.setStatus('error', 'Please provide consent before processing a face comparison.', 'error');
        return;
      }
      if (this.lastDetection !== 'ready') {
        this.setStatus('quality_insufficient', 'Wait until one suitable face is detected before verifying.', 'error');
        return;
      }

      this.setBusy(true, 'Comparing the capture with your enrolled face reference...');
      try {
        const image = await this.captureJpeg();
        if (!this.consentCheckbox.checked) return;
        const form = new FormData();
        form.append('capture', image, 'capture.jpg');
        form.append('consent', 'true');
        if (this.options && this.options.sessionId) {
          form.append('sessionId', this.options.sessionId);
        }
        const controller = new AbortController();
        this.cameraRequestController = controller;
        const data = await this.api('/verify', {
          method: 'POST',
          body: form,
          signal: controller.signal
        });
        this.showVerificationResult(data);
      } catch (error) {
        this.showRequestError(error);
      } finally {
        this.setBusy(false);
        this.stopCamera(true);
      }
    }

    showVerificationResult(data) {
      const isSuccess = data.verificationStatus === 'verified' || data.identityStatus === 'match';
      const isFail = data.verificationStatus === 'not_verified' || data.identityStatus === 'no_match';
      const elapsed = Number.isFinite(data.latencyMs)
        ? ` (${data.latencyMs.toFixed(0)} ms)`
        : '';

      if (isSuccess) {
        this.result.textContent = `✅ Identity verified! Face match confirmed${elapsed}.`;
        this.setStatus('ready', 'Face verified successfully! Marking attendance...', 'success');
        if (typeof this.options.onVerified === 'function') {
          this.options.onVerified(data);
        }
      } else if (isFail) {
        this.result.textContent = '❌ Face comparison did not match your enrolled reference. Please ensure good lighting and face the camera directly.';
        this.setStatus('error', 'Identity verification failed.', 'error');
        if (typeof this.options.onFailed === 'function') {
          this.options.onFailed(data);
        }
      } else {
        this.result.textContent = `Verification inconclusive (${data.reasonCode || 'Unknown reason'}). Please retry.`;
        this.setStatus('ready', 'Verification inconclusive.', 'neutral');
      }
      this.retryButton.hidden = false;
    }

    showRequestError(error) {
      if (error.name === 'AbortError') return;
      this.result.textContent = error.data && error.data.reasonCode
        ? `${error.data.reasonCode}: ${error.data.message || 'Request could not be completed.'}`
        : 'The request could not be completed. Check the camera and verification service, then retry.';
      this.setStatus(
        error.status === 503 ? 'service' : 'error',
        error.data && error.data.message ? error.data.message : stateMessages.network,
        'error'
      );
      this.retryButton.hidden = false;
    }

    setBusy(busy, message) {
      this.busy = busy;
      this.progress.hidden = !busy;
      this.progress.textContent = busy ? message : '';
      this.startButton.disabled =
        busy || this.cameraStarting || !this.enrollmentLoaded || Boolean(this.stream);
      this.stopButton.disabled = busy || !this.stream;
      this.actionButton.disabled = busy || !this.stream;
      if (busy) this.drawBounds(null);
      else if (this.stream) this.scheduleDetection();
    }

    async retry() {
      this.result.textContent = '';
      this.retryButton.hidden = true;
      if (!this.enrollmentLoaded) {
        await this.loadEnrollment();
        return;
      }
      if (!this.stream) {
        await this.startCamera();
        return;
      }
      if (this.pollingPaused || this.lastDetection !== 'ready') {
        this.scheduleDetection();
        return;
      }
      if (this.enrolled) await this.verify();
      else await this.enroll();
    }



    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.stopCamera();
      this.abortController.abort();
      window.removeEventListener('pagehide', this.handlers.pagehide);
      this.startButton.removeEventListener('click', this.handlers.start);
      this.stopButton.removeEventListener('click', this.handlers.stop);
      this.actionButton.removeEventListener('click', this.handlers.action);
      this.retryButton.removeEventListener('click', this.handlers.retry);

      this.consentCheckbox.removeEventListener('change', this.handlers.consentChange);
      this.container.replaceChildren();
      if (activeInstance === this) activeInstance = null;
    }
  }

  let activeInstance = null;
  window.FaceVerification = {
    mount(container, options) {
      if (!(container instanceof Element)) {
        throw new TypeError('FaceVerification.mount requires a container element');
      }
      if (activeInstance) activeInstance.destroy();
      activeInstance = new FaceVerificationComponent(container, options || {});
      return activeInstance;
    },
    destroy() {
      if (activeInstance) activeInstance.destroy();
    }
  };
})();
