FROM node:22-bookworm

# Strumenti base richiesti + utilità per sviluppo
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        curl \
        lsof \
        ca-certificates \
        bash \
        git \
        libnspr4 \
        libnss3 \
        libdbus-1-3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
        libpangocairo-1.0-0 \
        libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# Expo CLI tramite npx; eas-cli opzionale ma utile
RUN npm install -g eas-cli
# necessario se avvieremo in modalità tunnel cosi che lo installiamo una volta e non ce lo chiedera piu
RUN npm install -g @expo/ngrok@^4.1.0

WORKDIR /workspace

EXPOSE 19000 19001 19002 8081

CMD ["bash"]
