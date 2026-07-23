(function () {
    'use strict';

    var galleryTitle = document.getElementById('gallery-title');
    var mainImage = document.getElementById('main-image');
    var mainPlaceholder = document.getElementById('main-placeholder');
    var mainContainer = document.getElementById('main-image-container');
    var extraGrid = document.getElementById('extra-grid');
    var fileInput = document.getElementById('file-input');
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
    var fsLastCenter = null;
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

    // Tap su sfondo chiude (solo se non stava zoomando/pannando)
    var fsTapTime = 0;
    modalFullscreen.addEventListener('click', function (e) {
        if (e.target === modalFullscreen && fsScale <= 1.05) {
            hideFullscreen();
        }
    });

    // Pinch-to-zoom + pan
    modalFullscreen.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) {
            // Inizio pinch
            var dx = e.touches[1].clientX - e.touches[0].clientX;
            var dy = e.touches[1].clientY - e.touches[0].clientY;
            fsLastDist = Math.sqrt(dx * dx + dy * dy);
            fsLastCenter = {
                x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                y: (e.touches[0].clientY + e.touches[1].clientY) / 2
            };
            fsPanning = false;
        } else if (e.touches.length === 1 && fsScale > 1.05) {
            // Inizio pan (solo se zoomato)
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
            fsLastCenter = null;
        }
        if (e.touches.length === 0) {
            fsPanning = false;
            fsPanStart = null;
            // Se scala torna a ~1, resetta pan
            if (fsScale <= 1.05) {
                fsScale = 1;
                fsPanX = 0;
                fsPanY = 0;
                applyFsTransform();
            }
        }
    }, { passive: true });

    // Double-tap per reset zoom
    var lastTapTime = 0;
    fullscreenImage.addEventListener('touchend', function (e) {
        var now = Date.now();
        if (now - lastTapTime < 300) {
            // Double tap
            if (fsScale > 1.05) {
                resetFsTransform();
                applyFsTransform();
            } else {
                fsScale = 2.5;
                applyFsTransform();
            }
        }
        lastTapTime = now;
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
                    fileInput.click();
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
                fileInput.click();
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
            fileInput.click();
        });
        extraGrid.appendChild(addPlaceholder);
    }

    // =========================================================================
    // UPLOAD E ELIMINAZIONE
    // =========================================================================

    fileInput.addEventListener('change', async function () {
        var file = fileInput.files[0];
        if (!file) return;
        fileInput.value = '';

        try {
            var blob = await resizeImage(file, 1024);

            if (uploadTarget === 'main') {
                await JarDB.save(qrId, blob);
            } else {
                // Se non esiste ancora l'associazione, creala prima
                var existing = await JarDB.get(qrId);
                if (!existing) {
                    await JarDB.save(qrId, blob);
                } else {
                    await JarDB.addExtra(qrId, blob);
                }
            }

            // Ricarica galleria
            window.location.reload();
        } catch (err) {
            console.error('Errore upload:', err);
            alert('Errore: ' + err.message);
        }
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
