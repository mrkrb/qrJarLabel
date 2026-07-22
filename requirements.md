# Progetto: AR Etichette Barattoli

## 1. Obiettivo

Realizzare una Progressive Web App (PWA) per Android che, inquadrando con la
fotocamera il coperchio di un barattolo su cui è stampato un QR code, mostri
in tempo reale un'immagine sovrapposta (etichetta) al posto del QR code
stesso, seguendone posizione, rotazione e inclinazione nel frame video.

## 2. Vincoli di progetto

- Nessun devkit nativo Android (no Android Studio, no ARCore SDK, no build
  nativa Kotlin/Java).
- Deve girare come webapp installabile (PWA) su Chrome per Android.
- Hosting statico su GitHub Pages (HTTPS incluso, requisito per l'accesso
  alla fotocamera).
- Nessun accesso richiesto a servizi esterni/backend: tutta la logica gira
  client-side nel browser.

## 3. Requisiti funzionali

### 3.1 Generazione QR code

- Ogni barattolo ha un QR code univoco stampato sul coperchio.
- Il QR code codifica un identificativo semplice (es. `jar:001`), non un URL
  completo.
- Error correction level: M o Q (tolleranza a sporco/riflessi/piccole
  imperfezioni di stampa).

### 3.2 Rilevamento in tempo reale

- Accesso alla fotocamera posteriore del dispositivo (`getUserMedia`,
  `facingMode: "environment"`).
- Rilevamento del QR code ad ogni frame (o a frequenza ottimizzata) usando
  l'API nativa `BarcodeDetector` di Chrome (formato `qr_code`).
- Estrazione per ogni QR rilevato di: valore decodificato (`rawValue`) e
  coordinate dei 4 angoli (`cornerPoints`).
- Fallback opzionale con libreria `jsQR` per browser privi di
  `BarcodeDetector` nativo (non prioritario, target primario è Chrome
  Android).

### 3.3 Overlay dell'immagine

- Per ogni QR rilevato, disegnare sopra il feed video l'immagine
  corrispondente, deformata (trasformazione prospettica/omografia) in modo
  da combaciare con i 4 angoli del QR rilevato.
- L'overlay deve aggiornarsi in tempo reale seguendo i micro-movimenti della
  camera/barattolo (no immagine statica fissa a schermo).
- Se il QR esce dal campo visivo, l'overlay relativo scompare.
- Supporto a rilevamento multiplo: più barattoli/QR inquadrati
  contemporaneamente devono mostrare ciascuno la propria immagine.

### 3.4 Schermata di configurazione (gestione associazioni QR → immagine)

- Schermata dedicata, separata dalla schermata di scansione/overlay
  principale, raggiungibile ad es. tramite un pulsante/menu.
- **Vista elenco**: mostra tutte le associazioni già create, ciascuna con
  anteprima dell'immagine e identificativo del QR code associato.
- **Aggiunta nuova associazione** tramite pulsante "Aggiungi codice":
  1. Step 1: attiva la fotocamera per scansionare il QR code da associare
     (riusa lo stesso rilevamento QR della schermata principale).
  2. Step 2: dopo la scansione, permette l'upload/selezione di un'immagine
     dal dispositivo da associare a quel codice.
  3. Al termine, la nuova associazione compare nella vista elenco.
- **Modifica** di un'associazione esistente: dalla vista elenco,
  selezionando un'associazione è possibile sostituirne l'immagine (senza
  dover rifare la scansione del QR).
- **Eliminazione** di un'associazione esistente dalla vista elenco.
- **Persistenza**: le associazioni (id QR + immagine) devono essere salvate
  localmente sul dispositivo in modo permanente tra un utilizzo e l'altro
  della webapp, tramite IndexedDB (necessario per gestire in locale i file
  immagine caricati dall'utente, non semplici stringhe).

### 3.5 Installabilità

- `manifest.json` con icone, nome, display `standalone` o `fullscreen`.
- Service worker per caching degli asset base (funzionamento anche offline
  per la UI, non necessariamente per contenuti non ancora scaricati).
- Installabile su Android tramite "Aggiungi a schermata Home" da Chrome.

## 4. Requisiti non funzionali

- **Performance**: overlay fluido, senza percepibili lag tra movimento del
  barattolo e aggiornamento dell'immagine.
- **Compatibilità**: target primario Chrome su Android (versione recente).
- **Privacy**: nessuna raccolta dati personale; tutto il processing e lo
  storage avvengono sul dispositivo, nessun invio di frame video o immagini
  a server esterni.
- **Hosting**: build statica compatibile con GitHub Pages (nessun bisogno
  di server backend/API).

## 5. Fuori scopo (per questa fase)

- Pubblicazione su Play Store.
- Packaging come TWA (Trusted Web Activity) / `.apk` installabile.
- Supporto iOS/Safari.
- Editor grafico in-app per creare le immagini delle etichette (le immagini
  vengono preparate esternamente e caricate dall'utente).
- Export/import di backup delle associazioni (valutabile in futuro).

## 6. Stack tecnico di riferimento

- HTML/CSS/JavaScript vanilla (nessun framework obbligatorio).
- Web API: `getUserMedia`, `BarcodeDetector`, Canvas 2D (o CSS `matrix3d`)
  per il warp prospettico.
- Storage locale: IndexedDB (eventualmente tramite libreria wrapper leggera
  tipo `idb`) per la persistenza delle associazioni QR → immagine, incluse
  le immagini caricate come `Blob`.
- Hosting: GitHub Pages.

## 7. Milestone di sviluppo suggerite

1. MVP: pagina che mostra il video live e stampa a schermo il valore
   decodificato del QR rilevato.
2. Disegno di debug dei 4 punti rilevati sovrapposti al video.
3. Sostituzione dei punti di debug con l'immagine warpata via
   trasformazione prospettica (usando per ora un'unica immagine di test
   hardcoded).
4. Implementazione dello storage IndexedDB per le associazioni QR →
   immagine.
5. Realizzazione della schermata di configurazione: vista elenco,
   aggiunta (scansione + upload), modifica, eliminazione.
6. Collegamento della schermata principale allo storage IndexedDB, in modo
   che l'overlay usi le immagini effettivamente associate dall'utente.
7. Ottimizzazione (risoluzione video, frequenza di detection, gestione
   uscita del QR dal campo visivo, gestione rilevamento multiplo).
8. Conversione in PWA installabile (manifest + service worker).
9. Deploy su GitHub Pages.