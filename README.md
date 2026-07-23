# Avatar Foundry

Avatar Foundry is a trust-centered prototype workspace for designing, training,
testing, and packaging persistent fictional AI identities.

The interface demonstrates the complete seven-stage product journey:

1. Canon
2. References
3. Dataset
4. Train
5. Create
6. Validate
7. Launch

Mara Vey and Lila Mercer are included as proof cases. Prototype actions are
explicitly labeled; this repository does not yet connect image ingestion,
dataset processing, model training, generation, or export to production
backend services.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

This is a standard Next.js application and can be imported directly into
Vercel. Use the default framework settings; no environment variables are
required for the current prototype.

## Validation

```bash
npm run build
npm run lint
```
