FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

RUN mkdir -p /app/data

EXPOSE 41847

CMD ["node", "src/index.js"]
