# Cocktail QR Menu

Aplicatie pentru bar acasa:
- panou admin simplificat pentru adaugare si editare cocktail-uri (nume, ingrediente, poza);
- meniu public accesat prin QR;
- formular de comanda (nume + bautura) care trimite comanda pe WhatsApp;
- comenzi salvate si in baza de date (vizibile in admin).

## 1. Instalare locala

```bash
npm install
cp .env.example .env
```

Completeaza `.env`:
- `ADMIN_PASSWORD` parola admin;
- `SESSION_SECRET` string lung random;
- `WHATSAPP_NUMBER` numarul tau WhatsApp in format international, doar cifre (ex: `407xxxxxxxx`);
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_TO` pentru trimitere automata (optional);
- `PUBLIC_BASE_URL` optional local (se poate lasa gol).

Pornire:

```bash
npm run dev
```

Pagini:
- Home + QR: `http://localhost:3000`
- Meniu public: `http://localhost:3000/menu`
- Admin: `http://localhost:3000/admin/login`

## 2. Cum functioneaza comanda WhatsApp

Cand un invitat trimite comanda:
1. completeaza nume + bautura;
2. aplicatia salveaza comanda in DB;
3. daca ai configurat `TWILIO_*`, serverul trimite automat mesajul WhatsApp;
4. daca nu ai Twilio dar ai `WHATSAPP_NUMBER`, utilizatorul este redirectionat la `wa.me` cu mesaj precompletat.

### Twilio Sandbox (test)
- `TWILIO_WHATSAPP_FROM`: `whatsapp:+14155238886` (de obicei in sandbox).
- `TWILIO_WHATSAPP_TO`: numarul tau, ex: `whatsapp:+407xxxxxxxx`.
- Trimite mesajul `join <codul_tau>` catre numarul sandbox inainte de test.

## 3. Deploy (recomandat cu volum persistent)

Aplicatia foloseste fisiere locale pentru DB si poze, deci in cloud ai nevoie de storage persistent.

### Variabile pentru storage persistent
- `DATA_DIR` (ex: `/data`)
- `UPLOAD_DIR` (ex: `/data/uploads`)
- `PUBLIC_BASE_URL` (ex: `https://numele-tau.up.railway.app`)

### Pasii generali de deploy
1. Urca proiectul pe GitHub.
2. Creeaza serviciul pe platforma ta cloud.
3. Ataseaza un volum persistent montat la `/data`.
4. Seteaza env vars:
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET`
   - `WHATSAPP_NUMBER`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_WHATSAPP_FROM`
   - `TWILIO_WHATSAPP_TO`
   - `PUBLIC_BASE_URL`
   - `DATA_DIR=/data`
   - `UPLOAD_DIR=/data/uploads`
5. Start command: `npm start`.
6. Foloseste URL-ul public in QR (`/qr.png` se actualizeaza automat pe baza `PUBLIC_BASE_URL`).

## 4. Fisiere importante

- Server: `src/server.js`
- DB setup: `src/db.js`
- UI meniu: `views/menu.ejs`
- UI admin: `views/admin-dashboard.ejs`
