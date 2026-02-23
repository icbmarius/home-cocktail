# Cocktail QR Menu

Aplicatie pentru bar acasa:
- panou admin simplificat pentru adaugare cocktail-uri (nume, ingrediente, poza);
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
3. utilizatorul este redirectionat la `wa.me` cu mesajul precompletat;
4. mesajul ajunge la numarul tau dupa ce utilizatorul confirma trimiterea in WhatsApp.

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
