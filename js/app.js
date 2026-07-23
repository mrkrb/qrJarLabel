(function () {
    'use strict';

    const video = document.getElementById('video');
    const overlay = document.getElementById('overlay');
    const ctx = overlay.getContext('2d');
    const statusBar = document.getElementById('status-bar');
    const statusText = document.getElementById('status-text');
    const scaleControl = document.getElementById('scale-control');
    const scaleSlider = document.getElementById('scale-slider');
    const scaleValueLabel = document.getElementById('scale-value');

    let detector = null;
    let animFrameId = null;

    // Scala immagine overlay (controllata dallo slider)
    var imageScale = 1.0;

    // Cache delle immagini caricate da IndexedDB: { qrId: HTMLImageElement }
    var imageCache = {};

    // Aree toccabili: QR con immagine attualmente visibili e i loro corner points
    // [{ qrId, points: [{x,y}...] }] — aggiornato ad ogni frame
    var touchableAreas = [];

    // =========================================================================
    // SMOOTHING TEMPORALE (EMA) — PER-QR
    //
    // Ogni QR code rilevato ha il proprio stato di smoothing, così QR multipli
    // non si interferiscono a vicenda.
    // =========================================================================

    var SMOOTH_ALPHA = 0.35;
    var SMOOTH_TIMEOUT = 200;

    // { qrId: { points: [{x,y},...], lastTime: number } }
    var smoothState = {};

    function smoothCornerPointsForQr(qrId, newPoints) {
        var now = performance.now();
        var state = smoothState[qrId];

        if (!state || (now - state.lastTime) > SMOOTH_TIMEOUT) {
            smoothState[qrId] = {
                points: newPoints.map(function (p) { return { x: p.x, y: p.y }; }),
                lastTime: now
            };
            return smoothState[qrId].points;
        }

        for (var i = 0; i < 4; i++) {
            state.points[i].x = SMOOTH_ALPHA * newPoints[i].x + (1 - SMOOTH_ALPHA) * state.points[i].x;
            state.points[i].y = SMOOTH_ALPHA * newPoints[i].y + (1 - SMOOTH_ALPHA) * state.points[i].y;
        }
        state.lastTime = now;
        return state.points;
    }

    /**
     * Pulisce gli stati di smoothing per QR che non sono più visibili.
     */
    function cleanupSmoothState(activeQrIds) {
        var keys = Object.keys(smoothState);
        for (var i = 0; i < keys.length; i++) {
            if (activeQrIds.indexOf(keys[i]) === -1) {
                delete smoothState[keys[i]];
            }
        }
    }

    // =========================================================================
    // INDEXEDDB: CARICAMENTO E UPLOAD IMMAGINI
    // =========================================================================

    function blobToImage(blob) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(blob);
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('Impossibile caricare immagine dal blob'));
            };
            img.src = url;
        });
    }

    async function loadAllImages() {
        try {
            var associations = await JarDB.getAll();
            for (var i = 0; i < associations.length; i++) {
                var assoc = associations[i];
                if (assoc.imageBlob) {
                    imageCache[assoc.qrId] = await blobToImage(assoc.imageBlob);
                }
            }
            console.log('Caricate', Object.keys(imageCache).length, 'immagini da IndexedDB');
        } catch (err) {
            console.warn('Errore caricamento immagini da DB:', err);
        }
    }

    function getImageForQr(qrId) {
        return imageCache[qrId] || null;
    }

    // =========================================================================
    // DETECTOR E FOTOCAMERA
    // =========================================================================

    async function initDetector() {
        if ('BarcodeDetector' in window) {
            const formats = await BarcodeDetector.getSupportedFormats();
            if (formats.includes('qr_code')) {
                detector = new BarcodeDetector({ formats: ['qr_code'] });
                return true;
            }
        }
        return false;
    }

    async function startCamera() {
        const constraints = {
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        };
        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            await video.play();
            return true;
        } catch (err) {
            console.error('Errore accesso fotocamera:', err);
            setStatus('Errore: impossibile accedere alla fotocamera', 'error');
            return false;
        }
    }

    function setStatus(text, type) {
        statusText.textContent = text;
        statusBar.className = type || '';
    }

    /**
     * Mostra/nasconde lo scale control in base ai QR rilevati.
     */
    function updateUI(barcodes) {
        if (barcodes.length === 0) {
            scaleControl.classList.add('hidden');
            return;
        }
        // Mostra scale control se almeno un QR ha un'immagine associata
        var hasImage = false;
        for (var i = 0; i < barcodes.length; i++) {
            if (imageCache[barcodes[i].rawValue]) {
                hasImage = true;
                break;
            }
        }
        if (hasImage) {
            scaleControl.classList.remove('hidden');
        } else {
            scaleControl.classList.add('hidden');
        }
    }

    // =========================================================================
    // TRASFORMAZIONE PROSPETTICA
    // =========================================================================

    var SUBDIVISIONS = 8;

    function bilerp(u, v, c) {
        return {
            x: (1-u)*(1-v)*c[0].x + u*(1-v)*c[1].x + u*v*c[2].x + (1-u)*v*c[3].x,
            y: (1-u)*(1-v)*c[0].y + u*(1-v)*c[1].y + u*v*c[2].y + (1-u)*v*c[3].y
        };
    }

    function textureTriangle(img, imgW, imgH, s0, s1, s2, d0, d1, d2) {
        var sx0 = s0.x, sy0 = s0.y;
        var sx1 = s1.x, sy1 = s1.y;
        var sx2 = s2.x, sy2 = s2.y;
        var dx0 = d0.x, dy0 = d0.y;
        var dx1 = d1.x, dy1 = d1.y;
        var dx2 = d2.x, dy2 = d2.y;

        var denom = (sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1));
        if (Math.abs(denom) < 0.001) return;
        var invDenom = 1.0 / denom;

        var m11 = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) * invDenom;
        var m12 = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) * invDenom;
        var m13 = (dx0 * (sx1*sy2 - sx2*sy1) + dx1 * (sx2*sy0 - sx0*sy2) + dx2 * (sx0*sy1 - sx1*sy0)) * invDenom;
        var m21 = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) * invDenom;
        var m22 = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) * invDenom;
        var m23 = (dy0 * (sx1*sy2 - sx2*sy1) + dy1 * (sx2*sy0 - sx0*sy2) + dy2 * (sx0*sy1 - sx1*sy0)) * invDenom;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        ctx.moveTo(dx0, dy0);
        ctx.lineTo(dx1, dy1);
        ctx.lineTo(dx2, dy2);
        ctx.closePath();
        ctx.clip();
        ctx.setTransform(m11, m21, m12, m22, m13, m23);
        ctx.drawImage(img, 0, 0, imgW, imgH, 0, 0, imgW, imgH);
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function drawWarpedImage(img, cornerPoints) {
        if (!img || !cornerPoints || cornerPoints.length < 4) return;

        var imgW = img.naturalWidth || img.width;
        var imgH = img.naturalHeight || img.height;
        var n = SUBDIVISIONS;

        var scaleX = overlay.width / video.videoWidth;
        var scaleY = overlay.height / video.videoHeight;

        var corners = [
            { x: cornerPoints[0].x * scaleX, y: cornerPoints[0].y * scaleY },
            { x: cornerPoints[1].x * scaleX, y: cornerPoints[1].y * scaleY },
            { x: cornerPoints[2].x * scaleX, y: cornerPoints[2].y * scaleY },
            { x: cornerPoints[3].x * scaleX, y: cornerPoints[3].y * scaleY }
        ];

        // Aspect ratio cover
        var aspectRatio = imgW / imgH;
        if (aspectRatio !== 1) {
            if (aspectRatio > 1) {
                var padH = (aspectRatio - 1) / 2;
                corners = [
                    bilerp(-padH, 0, corners),
                    bilerp(1 + padH, 0, corners),
                    bilerp(1 + padH, 1, corners),
                    bilerp(-padH, 1, corners)
                ];
            } else {
                var padV = (1 / aspectRatio - 1) / 2;
                corners = [
                    bilerp(0, -padV, corners),
                    bilerp(1, -padV, corners),
                    bilerp(1, 1 + padV, corners),
                    bilerp(0, 1 + padV, corners)
                ];
            }
        }

        // Scala utente
        if (imageScale !== 1.0) {
            var pad = (imageScale - 1) / 2;
            corners = [
                bilerp(-pad, -pad, corners),
                bilerp(1 + pad, -pad, corners),
                bilerp(1 + pad, 1 + pad, corners),
                bilerp(-pad, 1 + pad, corners)
            ];
        }

        for (var row = 0; row < n; row++) {
            for (var col = 0; col < n; col++) {
                var u0 = col / n,       v0 = row / n;
                var u1 = (col+1) / n,   v1 = row / n;
                var u2 = (col+1) / n,   v2 = (row+1) / n;
                var u3 = col / n,       v3 = (row+1) / n;

                var s0 = { x: u0 * imgW, y: v0 * imgH };
                var s1 = { x: u1 * imgW, y: v1 * imgH };
                var s2 = { x: u2 * imgW, y: v2 * imgH };
                var s3 = { x: u3 * imgW, y: v3 * imgH };

                var d0 = bilerp(u0, v0, corners);
                var d1 = bilerp(u1, v1, corners);
                var d2 = bilerp(u2, v2, corners);
                var d3 = bilerp(u3, v3, corners);

                textureTriangle(img, imgW, imgH, s0, s1, s2, d0, d1, d2);
                textureTriangle(img, imgW, imgH, s0, s2, s3, d0, d2, d3);
            }
        }
    }

    // =========================================================================
    // OVERLAY — MULTI QR
    // =========================================================================

    /**
     * Disegna l'overlay per un singolo QR (immagine o poligono debug).
     * Non fa clearRect — viene fatto una volta prima di iterare su tutti i QR.
     */
    function drawSingleOverlay(qrId, cornerPoints) {
        if (!cornerPoints || cornerPoints.length < 4) return;

        var points = smoothCornerPointsForQr(qrId, cornerPoints);
        var img = getImageForQr(qrId);

        if (img) {
            drawWarpedImage(img, points);
        } else {
            // Fallback: poligono debug con rawValue sovrimpresso
            var scaleX = overlay.width / video.videoWidth;
            var scaleY = overlay.height / video.videoHeight;

            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth = 3;
            ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';

            ctx.beginPath();
            ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
            for (var i = 1; i < points.length; i++) {
                ctx.lineTo(points[i].x * scaleX, points[i].y * scaleY);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#6ee7b7';
            for (var j = 0; j < points.length; j++) {
                ctx.beginPath();
                ctx.arc(points[j].x * scaleX, points[j].y * scaleY, 6, 0, Math.PI * 2);
                ctx.fill();
            }

            // Disegna il rawValue al centro del poligono
            var cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4 * scaleX;
            var cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4 * scaleY;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.font = 'bold 14px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // Sfondo testo
            var textWidth = ctx.measureText(qrId).width;
            ctx.fillStyle = 'rgba(26, 26, 46, 0.8)';
            ctx.fillRect(cx - textWidth / 2 - 6, cy - 10, textWidth + 12, 20);
            // Testo
            ctx.fillStyle = '#6ee7b7';
            ctx.fillText(qrId, cx, cy);
            ctx.restore();
        }
    }

    // =========================================================================
    // LOOP DI RILEVAMENTO
    // =========================================================================

    async function detectLoop() {
        if (!detector || video.readyState < 2) {
            animFrameId = requestAnimationFrame(detectLoop);
            return;
        }

        if (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }

        try {
            const barcodes = await detector.detect(video);

            if (barcodes.length > 0) {
                // Pulisci canvas una volta, poi disegna tutti gli overlay
                ctx.clearRect(0, 0, overlay.width, overlay.height);

                var activeIds = [];
                var newTouchable = [];
                for (var i = 0; i < barcodes.length; i++) {
                    var qr = barcodes[i];
                    activeIds.push(qr.rawValue);
                    drawSingleOverlay(qr.rawValue, qr.cornerPoints);

                    // Traccia aree toccabili (solo QR con immagine)
                    if (imageCache[qr.rawValue]) {
                        var scX = overlay.width / video.videoWidth;
                        var scY = overlay.height / video.videoHeight;
                        newTouchable.push({
                            qrId: qr.rawValue,
                            points: qr.cornerPoints.map(function (p) {
                                return { x: p.x * scX, y: p.y * scY };
                            })
                        });
                    }
                }
                touchableAreas = newTouchable;

                // Pulisci smoothing per QR non più visibili
                cleanupSmoothState(activeIds);

                updateUI(barcodes);
                var statusMsg = barcodes.length === 1
                    ? 'QR: ' + barcodes[0].rawValue
                    : barcodes.length + ' QR rilevati';
                setStatus(statusMsg, 'scanning');
            } else {
                ctx.clearRect(0, 0, overlay.width, overlay.height);
                cleanupSmoothState([]);
                setStatus('Inquadra un QR code...', 'scanning');
            }
        } catch (err) {
            console.warn('Errore detection:', err);
        }

        animFrameId = requestAnimationFrame(detectLoop);
    }

    // =========================================================================
    // EVENT HANDLERS
    // =========================================================================

    var sliderActive = false;

    function onScaleChange() {
        imageScale = parseFloat(scaleSlider.value);
        scaleValueLabel.textContent = imageScale.toFixed(1) + 'x';
    }
    scaleSlider.addEventListener('input', onScaleChange);
    scaleSlider.addEventListener('change', onScaleChange);

    scaleControl.addEventListener('touchstart', function (e) {
        e.stopPropagation();
        sliderActive = true;
    });
    scaleControl.addEventListener('touchmove', function (e) {
        e.stopPropagation();
    });
    scaleControl.addEventListener('touchend', function () {
        sliderActive = false;
    });

    // Tocco sull'overlay: se tocca un QR con immagine, apre la galleria
    /**
     * Verifica se un punto (px, py) è dentro un poligono convesso definito
     * dai suoi vertici (algoritmo cross product).
     */
    function isPointInQuad(px, py, points) {
        var n = points.length;
        var sign = 0;
        for (var i = 0; i < n; i++) {
            var x1 = points[i].x, y1 = points[i].y;
            var x2 = points[(i + 1) % n].x, y2 = points[(i + 1) % n].y;
            var cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
            if (cross !== 0) {
                if (sign === 0) sign = cross > 0 ? 1 : -1;
                else if ((cross > 0 ? 1 : -1) !== sign) return false;
            }
        }
        return true;
    }

    // Tocco sull'overlay: rileva tap (non scroll) e apre la galleria
    var touchStartTime = 0;
    var touchStartPos = null;

    overlay.addEventListener('touchstart', function (e) {
        if (touchableAreas.length === 0) return;
        touchStartTime = Date.now();
        touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });

    overlay.addEventListener('touchend', function (e) {
        if (touchableAreas.length === 0 || !touchStartPos) return;

        // Accetta come tap solo se il tocco è durato meno di 300ms
        // e il dito non si è spostato più di 15px
        var elapsed = Date.now() - touchStartTime;
        var touch = e.changedTouches[0];
        var dx = touch.clientX - touchStartPos.x;
        var dy = touch.clientY - touchStartPos.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        touchStartPos = null;
        if (elapsed > 300 || dist > 15) return;

        // Coordinate del tap
        var rect = overlay.getBoundingClientRect();
        var cssX = touch.clientX - rect.left;
        var cssY = touch.clientY - rect.top;

        var canvasX = cssX * (overlay.width / rect.width);
        var canvasY = cssY * (overlay.height / rect.height);

        for (var i = 0; i < touchableAreas.length; i++) {
            var area = touchableAreas[i];
            if (isPointInQuad(canvasX, canvasY, area.points)) {
                window.location.href = 'gallery.html?qr=' + encodeURIComponent(area.qrId);
                return;
            }
        }
    });

    // =========================================================================
    // INIZIALIZZAZIONE
    // =========================================================================

    var initRunning = false;

    async function init() {
        if (initRunning) return;
        initRunning = true;

        // Ferma eventuale loop precedente
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(function (t) { t.stop(); });
            video.srcObject = null;
        }

        setStatus('Avvio...', '');
        try {
            const hasDetector = await initDetector();
            if (!hasDetector) {
                setStatus('BarcodeDetector non supportato su questo browser', 'error');
                return;
            }

            setStatus('Caricamento dati...', '');
            await loadAllImages();

            setStatus('Avvio fotocamera...', '');
            const cameraOk = await startCamera();
            if (!cameraOk) return;

            setStatus('Inquadra un QR code...', 'scanning');
            detectLoop();
        } catch (err) {
            console.error('Errore init:', err);
            setStatus('Errore: ' + err.message, 'error');
        } finally {
            initRunning = false;
        }
    }

    window.addEventListener('resize', function () {
        if (video.videoWidth && video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }
    });

    // Rilascia la camera quando l'utente naviga via (permette alla config
    // di usarla) e ri-inizializza quando torna (bfcache / pageshow)
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            // Pagina nascosta: ferma camera e detection
            if (animFrameId) {
                cancelAnimationFrame(animFrameId);
                animFrameId = null;
            }
            if (video.srcObject) {
                video.srcObject.getTracks().forEach(function (t) { t.stop(); });
                video.srcObject = null;
            }
        } else {
            // Pagina visibile: riavvia
            init();
        }
    });

    window.addEventListener('pageshow', function (event) {
        // Se la pagina viene da bfcache, ri-inizializza
        if (event.persisted) {
            init();
        }
    });

    init();
})();
