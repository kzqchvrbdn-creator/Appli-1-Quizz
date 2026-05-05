# Duo Quiz

Application de quiz en duo avec interface admin, scores visibles en direct, questions texte ou photo floutee, malus et elimination automatique a 2 malus.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir ensuite `http://localhost:5173`.

Pour lancer l'API, il faut une base PostgreSQL. Cree une base PostgreSQL, puis renseigne `DATABASE_URL` dans `.env`.

## Deploiement Railway

1. Pousser le projet sur GitHub.
2. Creer un nouveau projet Railway depuis le repo GitHub.
3. Ajouter un service PostgreSQL.
4. Ajouter les variables :
   - `DATABASE_URL`, fournie par Railway PostgreSQL
   - `ADMIN_PASSWORD=lisaa`
5. Railway lance `npm start` apres le build.

## Pages

- `/` : vue publique pour les joueurs et le public.
- `/screen` : vue grand ecran pour afficher question et classement.
- `/admin` : controle de la partie.

Le mot de passe admin par defaut est `lisaa`.
