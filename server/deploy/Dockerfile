# Runs the bundled server (dist/*.mjs, built by ../scripts/build.mjs): nothing to install.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs verifierWorker.mjs ./
USER node
ENV PORT=5181 DATA_FILE=/app/data/inventory.json
EXPOSE 5181
CMD ["node", "server.mjs"]
