# PinkPill production image (Koyeb, or any container host).
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
