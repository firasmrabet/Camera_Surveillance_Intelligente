# Utilisation d'une image de base officielle Node.js avec Debian Bullseye pour compatibilité Python/FFmpeg
FROM node:18-bullseye

# Installation de Python, pip, et FFmpeg (requis par OpenCV et le streaming)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Définition du répertoire de travail principal
WORKDIR /app

# Copie des dépendances Node.js du backend
COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm install --production

# Installation des dépendances Python (optionnel : via requirements.txt s'il existe)
# Sinon on installe les librairies de base requises par l'IA YOLOv8
RUN pip3 install --no-cache-dir \
    ultralytics \
    opencv-python-headless \
    numpy \
    torch \
    torchvision \
    insightface \
    onnxruntime \
    deep-sort-realtime

# Copie du reste du backend
COPY server/ ./

# Copie du dossier d'Intelligence Artificielle à la racine de l'application
# car le serveur (aiBridge.js) remonte de 3 dossiers pour trouver ./ai/ai_engine.py
WORKDIR /app
COPY ai/ ./ai/

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=5000
ENV SENTINEL_AI_ENGINE=auto

# Exposer le port de l'application Node.js
EXPOSE 5000

# Lancer le serveur
WORKDIR /app/server
CMD ["npm", "start"]
