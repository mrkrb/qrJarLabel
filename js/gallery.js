(function () {
    'use strict';

    var galleryTitle = document.getElementById('gallery-title');
    var mainImage = document.getElementById('main-image');
    var mainPlaceholder = document.getElementById('main-placeholder');
    var mainContainer = document.getElementById('main-image-container');
    var extraGrid = document.getElementById('extra-grid');
    var fileInputGallery = document.getElementById('file-input-gallery');
    var fileInputCamera = document.getElementById('file-input-camera');
    var modalSource = document.getElementById('modal-source');
    var btnSourceGallery = document.getElementById('btn-source-gallery');
    var btnSourceCamera = document.getElementById('btn-source-camera');
    var btnSourceCancel = document.getElementById('btn-source-cancel');
    var modalFullscreen = document.getElementById('modal-fullscreen');
    var fullscreenImage = document.getElementById('fullscreen-image');
    var btnCloseFullscreen = document.getElementById('btn-close-fullscreen');

    // Leggi qrId dal parametro URL
    var params = new URLSearchParams(window.location.search);
    var qrId = params.get('qr');

    if (!qrId) {
        galleryTitle.textContent = 'Errore';
        document.getElementById('gallery-content').innerHTML =
            '<p style="text-align:center;padding:40px;color:#fca5a5;">Nessun QR code specificato.</p>';
        return;
    }

    galleryTitle.textContent = qrId;

    // Stato upload
    var uploadTarget = null; // 'main' o 'extra'

    // =========================================================================
    // FULLSCREEN CON PINCH-TO-ZOOM E PAN
    // =========================================================================

    var fsScale = 1;
    var fsPanX = 0;
    var fsPanY = 0;
    var fsLastDist = 0;
    var fsPanning = false;
    var fsPanStart = null;

    function applyFsTransform() {
        fullscreenImage.style.transform =
            'translate(' + fsPanX + 'px, ' + fsPanY + 'px) scale(' + fsScale + ')';
    }

    function resetFsTransform() {
        fsScale = 1;
        fsPanX = 0;
        fsPanY = 0;
        fullscreenImage.style.transform = '';
    }

    function showFullscreen(url) {
        fullscreenImage.src = url;
        modalFullscreen.classList.remove('hidden');
        resetFsTransform();
    }

    function hideFullscreen() {
        modalFullscreen.classList.add('hidden');
        fullscreenImage.src = '';
        resetFsTransform();
    }

    btnCloseFullscreen.addEventListener('click', function (e) {
        e.stopPropagation();
        hideFullscreen();
    });

    // Tap su sfondo chiude (solo se non zoomato e non appena usciti da pinch)
    modalFullscreen.addEventListener('click', function (e) {
        if (wasPinching) return;
        if (e.target === modalFullscreen && fsScale <= 1.05) {
            hideFullscreen();
        }
    });

    // Pinch-to-zoom + pan
    var wasPinching = false;

    modalFullscreen.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) {
            // Inizio pinch
            wasPinching = true;
            var dx = e.touches[1].clientX - e.touches[0].clientX;
            var dy = e.touches[1].clientY - e.touches[0].clientY;
            fsLastDist = Math.sqrt(dx * dx + dy * dy);
            fsPanning = false;
            fsPanStart = null;
        } else if (e.touches.length === 1 && fsScale > 1.05 && !wasPinching) {
            // Inizio pan (solo se zoomato e non appena usciti da un pinch)
            fsPanning = true;
            fsPanStart = { x: e.touches[0].clientX - fsPanX, y: e.touches[0].clientY - fsPanY };
        }
    }, { passive: true });

    modalFullscreen.addEventListener('touchmove', function (e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            var dx = e.touches[1].clientX - e.touches[0].clientX;
            var dy = e.touches[1].clientY - e.touches[0].clientY;
            var dist = Math.sqrt(dx * dx + dy * dy);

            if (fsLastDist > 0) {
                var delta = dist / fsLastDist;
                fsScale = Math.max(1, Math.min(5, fsScale * delta));
                applyFsTransform();
            }
            fsLastDist = dist;
        } else if (e.touches.length === 1 && fsPanning && fsPanStart) {
            e.preventDefault();
            fsPanX = e.touches[0].clientX - fsPanStart.x;
            fsPanY = e.touches[0].clientY - fsPanStart.y;
            applyFsTransform();
        }
    }, { passive: false });

    modalFullscreen.addEventListener('touchend', function (e) {
        if (e.touches.length < 2) {
            fsLastDist = 0;
        }
        if (e.touches.length === 0) {
            fsPanning = false;
            fsPanStart = null;
            // Reset wasPinching dopo un breve delay (permette il prossimo
            // touchstart singolo di iniziare il pan)
            setTimeout(function () { wasPinching = false; }, 100);
        }
    }, { passive: true });

    // Double-tap per toggle zoom (non scatta se appena usciti da un pinch)
    var lastTapTime = 0;
    fullscreenImage.addEventListener('click', function () {
        if (wasPinching) return;
        var now = Date.now();
        if (now - lastTapTime < 300) {
            // Double tap: toggle zoom
            if (fsScale > 1.05) {
                resetFsTransform();
            } else {
                fsScale = 2.5;
                applyFsTransform();
            }
            lastTapTime = 0;
        } else {
            lastTapTime = now;
        }
    });

    // =========================================================================
    // RESIZE IMMAGINE
    // =========================================================================

    function resizeImage(file, maxSize) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                var w = img.naturalWidth;
                var h = img.naturalHeight;
                if (w > maxSize || h > maxSize) {
                    if (w >= h) {
                        h = Math.round(h * (maxSize / w));
                        w = maxSize;
                    } else {
                        w = Math.round(w * (maxSize / h));
                        h = maxSize;
                    }
                }
                var canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                var c = canvas.getContext('2d');
                c.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(url);
                canvas.toBlob(function (blob) {
                    if (blob) resolve(blob);
                    else reject(new Error('Errore conversione'));
                }, 'image/jpeg', 0.85);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('Errore caricamento immagine'));
            };
            img.src = url;
        });
    }

    // =========================================================================
    // RENDER GALLERIA
    // =========================================================================

    async function loadGallery() {
        var assoc = await JarDB.get(qrId);

        // Immagine principale
        if (assoc && assoc.imageBlob) {
            var mainUrl = URL.createObjectURL(assoc.imageBlob);
            mainImage.src = mainUrl;
            mainImage.classList.remove('hidden');
            mainPlaceholder.classList.add('hidden');

            mainImage.onclick = function () { showFullscreen(mainUrl); };

            // Long-press per sostituire l'immagine principale
            var longPressTimer = null;
            mainContainer.addEventListener('touchstart', function (e) {
                longPressTimer = setTimeout(function () {
                    uploadTarget = 'main';
                    showSourceModal();
                }, 600);
            }, { passive: true });
            mainContainer.addEventListener('touchend', function () {
                clearTimeout(longPressTimer);
            });
            mainContainer.addEventListener('touchmove', function () {
                clearTimeout(longPressTimer);
            });
        } else {
            // Nessuna immagine principale: mostra placeholder
            mainImage.classList.add('hidden');
            mainPlaceholder.classList.remove('hidden');

            mainPlaceholder.addEventListener('click', function () {
                uploadTarget = 'main';
                showSourceModal();
            });
        }

        // Immagini secondarie
        renderExtraGrid(assoc);
    }

    function renderExtraGrid(assoc) {
        extraGrid.innerHTML = '';

        var extras = (assoc && assoc.extraImages) ? assoc.extraImages : [];

        // Mostra le immagini extra esistenti
        for (var i = 0; i < extras.length; i++) {
            var url = URL.createObjectURL(extras[i]);
            var wrapper = document.createElement('div');
            wrapper.className = 'extra-item';

            var img = document.createElement('img');
            img.className = 'extra-thumb';
            img.src = url;
            img.alt = 'Immagine ' + (i + 1);

            // Tocco: fullscreen
            (function (u) {
                img.addEventListener('click', function () { showFullscreen(u); });
            })(url);

            // Pulsante elimina
            var btnDel = document.createElement('button');
            btnDel.className = 'extra-delete';
            btnDel.innerHTML = '&#10005;';
            btnDel.setAttribute('aria-label', 'Rimuovi');
            (function (index) {
                btnDel.addEventListener('click', function (e) {
                    e.stopPropagation();
                    removeExtra(index);
                });
            })(i);

            wrapper.appendChild(img);
            wrapper.appendChild(btnDel);
            extraGrid.appendChild(wrapper);
        }

        // Placeholder "+" per aggiungere una nuova immagine secondaria
        var addPlaceholder = document.createElement('div');
        addPlaceholder.className = 'extra-item extra-add';
        addPlaceholder.innerHTML = '<span>+</span>';
        addPlaceholder.addEventListener('click', function () {
            uploadTarget = 'extra';
            showSourceModal();
        });
        extraGrid.appendChild(addPlaceholder);
    }

    // =========================================================================
    // UPLOAD E ELIMINAZIONE
    // =========================================================================

    // Modale scelta sorgente
    function showSourceModal() {
        modalSource.classList.remove('hidden');
    }

    function hideSourceModal() {
        modalSource.classList.add('hidden');
    }

    btnSourceGallery.addEventListener('click', function () {
        hideSourceModal();
        fileInputGallery.click();
    });

    btnSourceCamera.addEventListener('click', function () {
        hideSourceModal();
        fileInputCamera.click();
    });

    btnSourceCancel.addEventListener('click', hideSourceModal);
    modalSource.addEventListener('click', function (e) {
        if (e.target === modalSource) hideSourceModal();
    });

    // Handler condiviso per entrambi gli input file
    async function handleFileSelected(file) {
        if (!file) return;

        try {
            var blob = await resizeImage(file, 1024);

            if (uploadTarget === 'main') {
                await JarDB.save(qrId, blob);
            } else {
                var existing = await JarDB.get(qrId);
                if (!existing) {
                    await JarDB.save(qrId, blob);
                } else {
                    await JarDB.addExtra(qrId, blob);
                }
            }

            window.location.reload();
        } catch (err) {
            console.error('Errore upload:', err);
            alert('Errore: ' + err.message);
        }
    }

    fileInputGallery.addEventListener('change', function () {
        var file = fileInputGallery.files[0];
        fileInputGallery.value = '';
        handleFileSelected(file);
    });

    fileInputCamera.addEventListener('change', function () {
        var file = fileInputCamera.files[0];
        fileInputCamera.value = '';
        handleFileSelected(file);
    });

    async function removeExtra(index) {
        if (!confirm('Rimuovere questa immagine?')) return;
        try {
            await JarDB.removeExtra(qrId, index);
            window.location.reload();
        } catch (err) {
            alert('Errore: ' + err.message);
        }
    }

    // =========================================================================
    // INIT
    // =========================================================================

    loadGallery();
})();
