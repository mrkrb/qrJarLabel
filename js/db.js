/**
 * Modulo IndexedDB per la persistenza delle associazioni QR → immagini.
 *
 * Ogni record ha la forma:
 *   { qrId: string, imageBlob: Blob, extraImages: [Blob], createdAt: number }
 *
 * - imageBlob: immagine principale (usata per l'overlay AR)
 * - extraImages: array di immagini secondarie (consultabili nella galleria)
 *
 * Lo store usa qrId come keyPath (un QR = un set di immagini).
 */
var JarDB = (function () {
    'use strict';

    var DB_NAME = 'qr-jar-label-db';
    var DB_VERSION = 1;
    var STORE_NAME = 'associations';

    var dbPromise = null;

    function open() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise(function (resolve, reject) {
            var request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (event) {
                var db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'qrId' });
                }
            };

            request.onsuccess = function (event) {
                resolve(event.target.result);
            };

            request.onerror = function (event) {
                console.error('Errore apertura IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        });

        return dbPromise;
    }

    /**
     * Salva l'immagine principale per un QR (preserva extraImages se esistenti).
     */
    function saveAssociation(qrId, imageBlob) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);

                // Prima leggi il record esistente per preservare extraImages
                var getReq = store.get(qrId);
                getReq.onsuccess = function () {
                    var existing = getReq.result;
                    var record = {
                        qrId: qrId,
                        imageBlob: imageBlob,
                        extraImages: (existing && existing.extraImages) ? existing.extraImages : [],
                        createdAt: (existing && existing.createdAt) ? existing.createdAt : Date.now()
                    };
                    var putReq = store.put(record);
                    putReq.onsuccess = function () { resolve(); };
                    putReq.onerror = function (e) { reject(e.target.error); };
                };
                getReq.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /**
     * Aggiunge un'immagine secondaria a un QR esistente.
     */
    function addExtraImage(qrId, imageBlob) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);

                var getReq = store.get(qrId);
                getReq.onsuccess = function () {
                    var existing = getReq.result;
                    if (!existing) {
                        reject(new Error('Associazione non trovata: ' + qrId));
                        return;
                    }
                    if (!existing.extraImages) {
                        existing.extraImages = [];
                    }
                    existing.extraImages.push(imageBlob);
                    var putReq = store.put(existing);
                    putReq.onsuccess = function () { resolve(); };
                    putReq.onerror = function (e) { reject(e.target.error); };
                };
                getReq.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /**
     * Rimuove un'immagine secondaria per indice.
     */
    function removeExtraImage(qrId, index) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);

                var getReq = store.get(qrId);
                getReq.onsuccess = function () {
                    var existing = getReq.result;
                    if (!existing || !existing.extraImages) {
                        reject(new Error('Nessuna immagine extra trovata'));
                        return;
                    }
                    existing.extraImages.splice(index, 1);
                    var putReq = store.put(existing);
                    putReq.onsuccess = function () { resolve(); };
                    putReq.onerror = function (e) { reject(e.target.error); };
                };
                getReq.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /**
     * Recupera un'associazione per qrId.
     */
    function getAssociation(qrId) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var request = store.get(qrId);
                request.onsuccess = function () {
                    resolve(request.result || null);
                };
                request.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /**
     * Recupera tutte le associazioni.
     */
    function getAllAssociations() {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var request = store.getAll();
                request.onsuccess = function () {
                    resolve(request.result || []);
                };
                request.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /**
     * Elimina un'associazione.
     */
    function deleteAssociation(qrId) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var request = store.delete(qrId);
                request.onsuccess = function () { resolve(); };
                request.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    return {
        open: open,
        save: saveAssociation,
        get: getAssociation,
        getAll: getAllAssociations,
        delete: deleteAssociation,
        addExtra: addExtraImage,
        removeExtra: removeExtraImage
    };
})();
