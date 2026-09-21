# Worker de remitos: parte el PDF escaneado, lee el codigo de cada pagina y
# devuelve las paginas. Sin estado, sin credenciales de Google.
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY comun ./comun
COPY worker ./worker

ENV HOST=0.0.0.0 \
    PORT=8787 \
    MAX_MB=50
USER node
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "worker/servidor.mjs"]
