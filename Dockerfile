# ЛР6: Dockerfile для сервісу інвентаризації

FROM node:20-alpine

# Робоча директорія всередині контейнера
WORKDIR /app

# Спочатку тільки package*.json — для кешу npm install
COPY package*.json ./

# Встановлюємо залежності (без dev-залежностей)
RUN npm ci --omit=dev

# Копіюємо весь код
COPY . .

# Директорія для фото (кеш)
RUN mkdir -p /cache

# Порт, який слухає додаток всередині контейнера
EXPOSE 3000

# Команда за замовчуванням:
#   host = 0.0.0.0 (щоб було доступно ззовні)
#   port = 3000
#   cache = /cache
CMD ["node", "main.js", "-h", "0.0.0.0", "-p", "3000", "-c", "/cache"]
