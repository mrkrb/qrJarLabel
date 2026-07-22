(function () {
    'use strict';

    const video = document.getElementById('video');
    const overlay = document.getElementById('overlay');
    const ctx = overlay.getContext('2d');
    const statusBar = document.getElementById('status-bar');
    const statusText = document.getElementById('status-text');
    const qrResult = document.getElementById('qr-result');
    const qrValue = document.getElementById('qr-value');
    const btnUpload = document.getElementById('btn-upload');
    const fileInput = document.getElementById('file-input');
    const scaleControl = document.getElementById('scale-control');
    const scaleSlider = document.getElementById('scale-slider');
    const scaleValueLabel = document.getElementById('scale-value');

    let detector = null;
    let animFrameId = null;
    let lastDetectedValue = '';
    let hideTimeout = null;

    // Scala immagine overlay (controllata dallo slider)
    var imageScale = 1.0;

    // Cache delle immagini caricate da IndexedDB: { qrId: HTMLImageElement }
    var imageCache = {};

    // QR attualmente rilevato (per l'associazione upload)
    var currentQrId = null;

    // =========================================================================
    // SMOOTHING TEMPORALE (EMA)
    // =========================================================================

    var SMOOTH_ALPHA = 0.35;
    var smoothedPoints = null;
    var lastDetectTime = 0;
    var SMOOTH_TIMEOUT = 200;

    function smoothCornerPoints(newPoints) {
        var now = performance.now();
        if (!smoothedPoints || (now - lastDetectTime) > SMOOTH_TIMEOUT) {
            smoothedPoints = newPoints.map(function (p) {
                return { x: p.x, y: p.y };
            });
            lastDetectTime = now;
            return smoothedPoints;
        }
        for (var i = 0; i < 4; i++) {
            smoothedPoints[i].x = SMOOTH_ALPHA * newPoints[i].x + (1 - SMOOTH_ALPHA) * smoothedPoints[i].x;
            smoothedPoints[i].y = SMOOTH_ALPHA * newPoints[i].y + (1 - SMOOTH_ALPHA) * smoothedPoints[i].y;
        }
        lastDetectTime = now;
        return smoothedPoints;
    }

    // =========================================================================
    // INDEXEDDB: CARICAMENTO E UPLOAD IMMAGINI
    // =========================================================================

    /**
     * Carica un'immagine dal Blob in cache come HTMLImageElement.
     */
    function blobToImage(blob) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(blob);
            var img = new Image();
            img.onload = function () {
                // Non revocare subito l'URL — serve per drawImage
                resolve(img);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('Impossibile caricare immagine dal blob'));
            };
            img.src = url;
        });
    }

    /**
     * Carica tutte le associazioni da IndexedDB nella cache immagini.
     */
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

    /**
     * Restituisce l'immagine associata a un qrId dalla cache, o null.
     */
    function getImageForQr(qrId) {
        return imageCache[qrId] || null;
    }

    /**
     * Gestisce l'upload di un file immagine: lo salva in IndexedDB
     * associato al QR corrente e lo mette in cache.
     */
    async function handleFileUpload(file) {
        if (!currentQrId) return;

        try {
            await JarDB.save(currentQrId, file);
            imageCache[currentQrId] = await blobToImage(file);
            setStatus('Immagine salvata per: ' + currentQrId, 'scanning');
            console.log('Salvata associazione:', currentQrId);
        } catch (err) {
            console.error('Errore salvataggio:', err);
            setStatus('Errore salvataggio immagine', 'error');
        }
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

    function showQrResult(value) {
        qrValue.textContent = value;
        qrResult.classList.remove('hidden');
        currentQrId = value;
        lastDetectedValue = value;

        // Mostra il pulsante upload solo se non c'è già un'immagine associata
        if (!imageCache[value]) {
            btnUpload.classList.remove('hidden');
            scaleControl.classList.add('hidden');
        } else {
            btnUpload.classList.add('hidden');
            scaleControl.classList.remove('hidden');
        }

        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(function () {
            if (lastDetectedValue === value && !sliderActive) {
                qrResult.classList.add('hidden');
                lastDetectedValue = '';
                btnUpload.classList.add('hidden');
                scaleControl.classList.add('hidden');
            }
        }, 3000);
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

        // Adatta i corner points per mantenere l'aspect ratio dell'immagine.
        // Approccio "cover": l'immagine riempie il quadrilatero del QR (che è
        // circa quadrato) mantenendo l'aspect ratio e sbordando dove necessario.
        // Se l'immagine è landscape, espandiamo il quadrilatero in larghezza.
        // Se è portrait, espandiamo in altezza.
        var aspectRatio = imgW / imgH;

        if (aspectRatio !== 1) {
            // TL=0, TR=1, BR=2, BL=3
            if (aspectRatio > 1) {
                // Landscape: espandi orizzontalmente (allarga left/right)
                var expand = aspectRatio; // > 1
                var padH = (expand - 1) / 2;
                corners = [
                    bilerp(-padH, 0, corners),
                    bilerp(1 + padH, 0, corners),
                    bilerp(1 + padH, 1, corners),
                    bilerp(-padH, 1, corners)
                ];
            } else {
                // Portrait: espandi verticalmente (allarga top/bottom)
                var expand = 1 / aspectRatio; // > 1
                var padV = (expand - 1) / 2;
                corners = [
                    bilerp(0, -padV, corners),
                    bilerp(1, -padV, corners),
                    bilerp(1, 1 + padV, corners),
                    bilerp(0, 1 + padV, corners)
                ];
            }
        }

        // Applica la scala utente (espande/contrae dal centro del quadrilatero)
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
    // OVERLAY
    // =========================================================================

    function drawOverlay(qrId, cornerPoints) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        if (!cornerPoints || cornerPoints.length < 4) return;

        var points = smoothCornerPoints(cornerPoints);

        // Cerca immagine associata a questo QR in IndexedDB (cache)
        var img = getImageForQr(qrId);

        if (img) {
            drawWarpedImage(img, points);
        } else {
            // Fallback: poligono debug
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
                const qr = barcodes[0];
                showQrResult(qr.rawValue);
                drawOverlay(qr.rawValue, qr.cornerPoints);
                setStatus('QR rilevato', 'scanning');
            } else {
                ctx.clearRect(0, 0, overlay.width, overlay.height);
                smoothedPoints = null;
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

    // Pulsante upload: apre il file picker
    btnUpload.addEventListener('click', function (e) {
        e.stopPropagation();
        fileInput.click();
    });

    // File selezionato: salva in IndexedDB
    fileInput.addEventListener('change', function () {
        var file = fileInput.files[0];
        if (file) {
            handleFileUpload(file);
            fileInput.value = ''; // Reset per permettere ri-selezione stesso file
        }
    });

    // Slider scala: aggiorna il valore in tempo reale
    var sliderActive = false;

    function onScaleChange() {
        imageScale = parseFloat(scaleSlider.value);
        scaleValueLabel.textContent = imageScale.toFixed(1) + 'x';
    }
    scaleSlider.addEventListener('input', onScaleChange);
    scaleSlider.addEventListener('change', onScaleChange);

    // Impedisci che il tocco sullo slider propaghi e causi problemi
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

    // =========================================================================
    // INIZIALIZZAZIONE
    // =========================================================================

    async function init() {
        setStatus('Avvio...', '');

        try {
            const hasDetector = await initDetector();
            if (!hasDetector) {
                setStatus('BarcodeDetector non supportato su questo browser', 'error');
                return;
            }

            setStatus('Caricamento dati...', '');

            // Carica le immagini già salvate in IndexedDB
            await loadAllImages();

            setStatus('Avvio fotocamera...', '');

            const cameraOk = await startCamera();
            if (!cameraOk) return;

            setStatus('Inquadra un QR code...', 'scanning');
            detectLoop();
        } catch (err) {
            console.error('Errore init:', err);
            setStatus('Errore: ' + err.message, 'error');
        }
    }

    window.addEventListener('resize', function () {
        if (video.videoWidth && video.videoHeight) {
            overlay.width = video.videoWidth;
            overlay.height = video.videoHeight;
        }
    });

    init();
})();
