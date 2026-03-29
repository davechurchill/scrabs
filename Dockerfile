FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
ENV MONGODB_URI=mongodb://mongo:27017/scrabble
ENV MONGODB_DB=scrabble

EXPOSE 3000

CMD ["npm", "start"]
