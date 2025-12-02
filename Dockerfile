FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p /cache

EXPOSE 3000 9229

CMD ["npm", "run", "dev"]