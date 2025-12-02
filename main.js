// Лабораторна робота №6: Створення сервісу інвентаризації
//
// CLI-параметри (обов'язкові):
//   -h, --host   – хост сервера
//   -p, --port   – порт сервера
//   -c, --cache  – директорія для зберігання фото (кеш)
//
// Технології (як в методичці):
//   - node:http як HTTP-сервер
//   - express як роутер/обробник
//   - commander для CLI
//   - multer для multipart/form-data (фото)
//   - swagger-ui-express для /docs

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { Command } = require("commander");
const swaggerUi = require("swagger-ui-express");

// =======================
// 1. CLI через commander
// =======================

const program = new Command();

program
    .name("backend-course-2025-6")
    .description("Inventory service (Lab 6)")
    .requiredOption("-h, --host <host>", "server host")
    .requiredOption("-p, --port <port>", "server port")
    .requiredOption("-c, --cache <dir>", "cache directory for photos");

program.parse(process.argv);
const opts = program.opts();

const HOST = opts.host;
const PORT = Number(opts.port);
const CACHE_DIR = path.resolve(opts.cache);

// =======================
// 2. Папка кешу (фото)
// =======================

fs.mkdirSync(CACHE_DIR, { recursive: true });

// =======================
// 3. Express застосунок
// =======================

const app = express();
const ROOT_DIR = __dirname;

// для JSON та x-www-form-urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// =======================
// 4. multer для фото
// =======================

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CACHE_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || "");
        cb(null, Date.now() + ext);
    },
});

const upload = multer({ storage });

// =======================
// 5. "База даних" в пам'яті
// =======================

const inventory = new Map(); // id -> { id, name, description, photoFileName }
let nextId = 1;

function buildItemDto(item) {
    return {
        id: item.id,
        name: item.name,
        description: item.description,
        photoUrl: item.photoFileName ? `/inventory/${item.id}/photo` : null,
    };
}

// =======================
// 6. 405 Method Not Allowed
// =======================
//
// Цей middleware перевіряє шлях і дозволені методи.
// Якщо метод не входить у дозволені – повертає 405 + Allow.

app.use((req, res, next) => {
    const p = req.path;
    const m = req.method;
    let allowed = null;

    if (p === "/register") allowed = ["POST"];
    else if (p === "/inventory") allowed = ["GET"];
    else if (/^\/inventory\/[^\/]+$/.test(p)) allowed = ["GET", "PUT", "DELETE"];
    else if (/^\/inventory\/[^\/]+\/photo$/.test(p)) allowed = ["GET", "PUT"];
    else if (p === "/RegisterForm.html") allowed = ["GET"];
    else if (p === "/SearchForm.html") allowed = ["GET"];
    else if (p === "/search") allowed = ["POST"];
    else if (p === "/docs") allowed = ["GET"]; // swagger
    else return next(); // не наш маршрут – йдемо далі (до 404)

    if (!allowed.includes(m)) {
        res.set("Allow", allowed.join(", "));
        return res.status(405).send("Method Not Allowed");
    }

    return next();
});

// =======================
// 7. HTML-форми
// =======================

app.get("/RegisterForm.html", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "RegisterForm.html"));
});

app.get("/SearchForm.html", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "SearchForm.html"));
});

// =======================
// 8. POST /register
// =======================
//
// Приймає multipart/form-data:
//   inventory_name (обов'язкове)
//   description
//   photo (файл)

app.post(
    "/register",
    upload.single("photo"),
    (req, res) => {
        const { inventory_name, description } = req.body;

        if (!inventory_name || inventory_name.trim() === "") {
            return res.status(400).send("Bad Request: inventory_name is required");
        }

        const id = nextId++;
        const item = {
            id,
            name: inventory_name.trim(),
            description: (description || "").trim(),
            photoFileName: req.file ? path.basename(req.file.path) : null,
        };

        inventory.set(String(id), item);

        res.status(201).json(buildItemDto(item));
    }
);

// =======================
// 9. GET /inventory – список
// =======================

app.get("/inventory", (req, res) => {
    const items = Array.from(inventory.values()).map(buildItemDto);
    res.status(200).json(items);
});

// =======================
// 10. GET /inventory/:id
// =======================

app.get("/inventory/:id", (req, res) => {
    const id = String(req.params.id);
    const item = inventory.get(id);

    if (!item) {
        return res.status(404).send("Not Found");
    }

    res.status(200).json(buildItemDto(item));
});

// =======================
// 11. PUT /inventory/:id
// =======================
//
// Оновлюємо name/description (JSON)

app.put("/inventory/:id", (req, res) => {
    const id = String(req.params.id);
    const item = inventory.get(id);

    if (!item) {
        return res.status(404).send("Not Found");
    }

    const { name, description } = req.body;

    if (typeof name === "string") {
        item.name = name.trim();
    }
    if (typeof description === "string") {
        item.description = description.trim();
    }

    res.status(200).json(buildItemDto(item));
});

// =======================
// 12. GET /inventory/:id/photo
// =======================

app.get("/inventory/:id/photo", (req, res) => {
    const id = String(req.params.id);
    const item = inventory.get(id);

    if (!item || !item.photoFileName) {
        return res.status(404).send("Not Found");
    }

    const filePath = path.join(CACHE_DIR, item.photoFileName);
    if (!fs.existsSync(filePath)) {
        return res.status(404).send("Not Found");
    }

    res.status(200);
    res.set("Content-Type", "image/jpeg");
    res.sendFile(filePath);
});

// =======================
// 13. PUT /inventory/:id/photo
// =======================
//
// Оновлення фото для існуючого запису

app.put(
    "/inventory/:id/photo",
    upload.single("photo"),
    (req, res) => {
        const id = String(req.params.id);
        const item = inventory.get(id);

        if (!item) {
            return res.status(404).send("Not Found");
        }

        if (!req.file) {
            return res.status(400).send("Bad Request: photo is required");
        }

        // видаляємо старий файл, якщо був
        if (item.photoFileName) {
            const oldPath = path.join(CACHE_DIR, item.photoFileName);
            fs.unlink(oldPath, () => {});
        }

        item.photoFileName = path.basename(req.file.path);

        res.status(200).json(buildItemDto(item));
    }
);

// =======================
// 14. DELETE /inventory/:id
// =======================

app.delete("/inventory/:id", (req, res) => {
    const id = String(req.params.id);
    const item = inventory.get(id);

    if (!item) {
        return res.status(404).send("Not Found");
    }

    if (item.photoFileName) {
        const photoPath = path.join(CACHE_DIR, item.photoFileName);
        fs.unlink(photoPath, () => {});
    }

    inventory.delete(id);

    res.status(200).send("OK");
});

// =======================
// 15. POST /search
// =======================
//
// Приймає x-www-form-urlencoded:
//   id
//   has_photo (on / undefined)
//
// Повертає текстовий опис елемента.

app.post("/search", (req, res) => {
    const { id, has_photo } = req.body;

    const item = inventory.get(String(id));
    if (!item) {
        return res.status(404).send("Not Found");
    }

    let result = `ID: ${item.id}\nName: ${item.name}\nDescription:\n${item.description || ""}`;

    if (has_photo && item.photoFileName) {
        result += `\nPhoto: /inventory/${item.id}/photo`;
    }

    res.status(200).send(result);
});

// =======================
// 16. Swagger /docs
// =======================

const swaggerDocument = {
    openapi: "3.0.0",
    info: {
        title: "Inventory Service API",
        version: "1.0.0",
    },
    paths: {
        "/register": {
            post: {
                summary: "Register new inventory item",
                requestBody: {
                    required: true,
                    content: {
                        "multipart/form-data": {
                            schema: {
                                type: "object",
                                properties: {
                                    inventory_name: { type: "string" },
                                    description: { type: "string" },
                                    photo: { type: "string", format: "binary" },
                                },
                                required: ["inventory_name"],
                            },
                        },
                    },
                },
                responses: {
                    "201": { description: "Created" },
                    "400": { description: "Bad Request" },
                },
            },
        },
        "/inventory": {
            get: {
                summary: "List all inventory items",
                responses: {
                    "200": { description: "OK" },
                },
            },
        },
        "/inventory/{id}": {
            get: {
                summary: "Get inventory item by ID",
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        schema: { type: "string" },
                        required: true,
                    },
                ],
                responses: {
                    "200": { description: "OK" },
                    "404": { description: "Not Found" },
                },
            },
            put: {
                summary: "Update inventory item",
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        schema: { type: "string" },
                        required: true,
                    },
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    name: { type: "string" },
                                    description: { type: "string" },
                                },
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "OK" },
                    "404": { description: "Not Found" },
                },
            },
            delete: {
                summary: "Delete inventory item",
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        schema: { type: "string" },
                        required: true,
                    },
                ],
                responses: {
                    "200": { description: "OK" },
                    "404": { description: "Not Found" },
                },
            },
        },
        "/inventory/{id}/photo": {
            get: {
                summary: "Get inventory item photo",
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        schema: { type: "string" },
                        required: true,
                    },
                ],
                responses: {
                    "200": { description: "OK" },
                    "404": { description: "Not Found" },
                },
            },
            put: {
                summary: "Update inventory item photo",
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        schema: { type: "string" },
                        required: true,
                    },
                ],
                requestBody: {
                    required: true,
                    content: {
                        "multipart/form-data": {
                            schema: {
                                type: "object",
                                properties: {
                                    photo: { type: "string", format: "binary" },
                                },
                                required: ["photo"],
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "OK" },
                    "404": { description: "Not Found" },
                },
            },
        },
        "/search": {
            post: {
                summary: "Search inventory item via form",
                requestBody: {
                    required: true,
                    content: {
                        "application/x-www-form-urlencoded": {
                            schema: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    has_photo: { type: "string" },
                                },
                                required: ["id"],
                            },
                        },
                    },
                },
                responses: {
                    "200": { description: "OK" },
                    "404": { description: "Not Found" },
                },
            },
        },
    },
};

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// =======================
// 17. 404 за замовчуванням
// =======================

app.use((req, res) => {
    res.status(404).send("Not Found");
});

// =======================
// 18. Старт node:http сервера
// =======================

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
    console.log(`Inventory service listening at http://${HOST}:${PORT}`);
    console.log(`Photos cache directory: ${CACHE_DIR}`);
});
