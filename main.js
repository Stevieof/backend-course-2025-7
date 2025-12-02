require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const { Command } = require("commander");
const swaggerUi = require("swagger-ui-express");
const { Pool } = require("pg");
const program = new Command();
const defaultHost = process.env.HOST || "0.0.0.0";
const defaultPort = process.env.PORT || "3000";
const defaultCacheDir =
    process.env.CACHE_DIR || path.resolve(__dirname, "cache");

program
    .name("backend-course-2025-7")
    .description("Inventory service (Lab 7: Docker + DB)")
    .option("-h, --host <host>", "server host", defaultHost)
    .option("-p, --port <port>", "server port", defaultPort)
    .option(
        "-c, --cache <dir>",
        "cache directory for photos",
        defaultCacheDir
    );

program.parse(process.argv);
const opts = program.opts();

const HOST = opts.host;
const PORT = Number(opts.port);
const CACHE_DIR = path.resolve(opts.cache);

#dbshka
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = Number(process.env.DB_PORT || 5432);
const DB_USER = process.env.DB_USER || "postgres";
const DB_PASSWORD = process.env.DB_PASSWORD || "postgres";
const DB_NAME = process.env.DB_NAME || "inventorydb";

const pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
});

fs.mkdirSync(CACHE_DIR, { recursive: true });

const app = express();
const ROOT_DIR = __dirname;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, CACHE_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || "");
        cb(null, Date.now() + ext);
    },
});

const upload = multer({ storage });

function buildItemDtoFromRow(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        photoUrl: row.photo_file_name ? `/inventory/${row.id}/photo` : null,
    };
}

async function getItemById(id) {
    const result = await pool.query(
        "SELECT id, name, description, photo_file_name FROM items WHERE id = $1",
        [id]
    );
    return result.rows[0] || null;
}


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

app.get("/RegisterForm.html", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "RegisterForm.html"));
});

app.get("/SearchForm.html", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "SearchForm.html"));
});

app.post(
    "/register",
    upload.single("photo"),
    async (req, res, next) => {
        try {
            const { inventory_name, description } = req.body;

            if (!inventory_name || inventory_name.trim() === "") {
                return res
                    .status(400)
                    .send("Bad Request: inventory_name is required");
            }

            const photoFileName = req.file ? path.basename(req.file.path) : null;

            const result = await pool.query(
                `
                INSERT INTO items (name, description, photo_file_name)
                VALUES ($1, $2, $3)
                RETURNING id, name, description, photo_file_name
            `,
                [inventory_name.trim(), (description || "").trim(), photoFileName]
            );

            const row = result.rows[0];
            res.status(201).json(buildItemDtoFromRow(row));
        } catch (err) {
            console.error(err);
            next(err);
        }
    }
);

app.get("/inventory", async (req, res, next) => {
    try {
        const result = await pool.query(
            "SELECT id, name, description, photo_file_name FROM items ORDER BY id ASC"
        );
        const items = result.rows.map(buildItemDtoFromRow);
        res.status(200).json(items);
    } catch (err) {
        console.error(err);
        next(err);
    }
});

app.get("/inventory/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).send("Bad Request: invalid id");
        }

        const item = await getItemById(id);

        if (!item) {
            return res.status(404).send("Not Found");
        }

        res.status(200).json(buildItemDtoFromRow(item));
    } catch (err) {
        console.error(err);
        next(err);
    }
});

app.put("/inventory/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).send("Bad Request: invalid id");
        }

        const existing = await getItemById(id);
        if (!existing) {
            return res.status(404).send("Not Found");
        }

        const { name, description } = req.body;

        const newName =
            typeof name === "string" && name.trim() !== ""
                ? name.trim()
                : existing.name;
        const newDescription =
            typeof description === "string"
                ? description.trim()
                : existing.description;

        const result = await pool.query(
            `
            UPDATE items
            SET name = $1,
                description = $2
            WHERE id = $3
            RETURNING id, name, description, photo_file_name
        `,
            [newName, newDescription, id]
        );

        const row = result.rows[0];
        res.status(200).json(buildItemDtoFromRow(row));
    } catch (err) {
        console.error(err);
        next(err);
    }
});

app.get("/inventory/:id/photo", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).send("Bad Request: invalid id");
        }

        const item = await getItemById(id);

        if (!item || !item.photo_file_name) {
            return res.status(404).send("Not Found");
        }

        const filePath = path.join(CACHE_DIR, item.photo_file_name);
        if (!fs.existsSync(filePath)) {
            return res.status(404).send("Not Found");
        }

        res.status(200);
        res.sendFile(filePath);
    } catch (err) {
        console.error(err);
        next(err);
    }
});

app.put(
    "/inventory/:id/photo",
    upload.single("photo"),
    async (req, res, next) => {
        try {
            const id = Number(req.params.id);
            if (Number.isNaN(id)) {
                return res.status(400).send("Bad Request: invalid id");
            }

            const existing = await getItemById(id);
            if (!existing) {
                return res.status(404).send("Not Found");
            }

            if (!req.file) {
                return res.status(400).send("Bad Request: photo is required");
            }

            // видаляємо старий файл, якщо був
            if (existing.photo_file_name) {
                const oldPath = path.join(CACHE_DIR, existing.photo_file_name);
                fs.unlink(oldPath, () => {});
            }

            const newPhotoFileName = path.basename(req.file.path);

            const result = await pool.query(
                `
                UPDATE items
                SET photo_file_name = $1
                WHERE id = $2
                RETURNING id, name, description, photo_file_name
            `,
                [newPhotoFileName, id]
            );

            const row = result.rows[0];
            res.status(200).json(buildItemDtoFromRow(row));
        } catch (err) {
            console.error(err);
            next(err);
        }
    }
);

app.delete("/inventory/:id", async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).send("Bad Request: invalid id");
        }

        const existing = await getItemById(id);
        if (!existing) {
            return res.status(404).send("Not Found");
        }

        if (existing.photo_file_name) {
            const photoPath = path.join(CACHE_DIR, existing.photo_file_name);
            fs.unlink(photoPath, () => {});
        }

        await pool.query("DELETE FROM items WHERE id = $1", [id]);

        res.status(200).send("OK");
    } catch (err) {
        console.error(err);
        next(err);
    }
});

app.post("/search", async (req, res, next) => {
    try {
        const { id, has_photo } = req.body;
        const numericId = Number(id);

        if (Number.isNaN(numericId)) {
            return res.status(400).send("Bad Request: invalid id");
        }

        const item = await getItemById(numericId);
        if (!item) {
            return res.status(404).send("Not Found");
        }

        let result = `ID: ${item.id}\nName: ${item.name}\nDescription:\n${
            item.description || ""
        }`;

        if (has_photo && item.photo_file_name) {
            result += `\nPhoto: /inventory/${item.id}/photo`;
        }

        res.status(200).send(result);
    } catch (err) {
        console.error(err);
        next(err);
    }
});

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
                        schema: { type: "integer" },
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
                        schema: { type: "integer" },
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
                        schema: { type: "integer" },
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
                        schema: { type: "integer" },
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
                        schema: { type: "integer" },
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

app.use((err, req, res, next) => {
    console.error("Unhandled error:", err);
    if (res.headersSent) {
        return next(err);
    }
    res.status(500).send("Internal Server Error");
});


app.use((req, res) => {
    res.status(404).send("Not Found");
});

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
    console.log(`Inventory service listening at http://${HOST}:${PORT}`);
    console.log(`Photos cache directory: ${CACHE_DIR}`);
    console.log(
        `DB: postgres://${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`
    );
});